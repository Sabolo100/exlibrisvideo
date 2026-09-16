/**
 * Vision step (SPEC §4.3): consecutive key frames in overlapping batches → spine observations →
 * `detections` rows.
 *
 * - batches of VISION_BATCH_SIZE frames overlapping by 1 frame, VISION_CONCURRENCY in parallel
 * - a failed batch is retried twice, then skipped with a warning
 * - the step succeeds when ≥ 50 % of the batches succeeded, otherwise PipelineError('ai_failed')
 * - videos.frames_analyzed / progress are updated after every batch; a vanished video row aborts the run
 */
import fs from 'node:fs/promises';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { detections, frames as framesTable, videos, type FrameRow, type VideoRow } from '@/db/schema';
import { getVisionProvider } from '@/lib/ai';
import type { AiUsage, SpineObservation, VisionFrame, VisionProvider } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import { env } from '@/lib/env';
import { PipelineError, VideoGoneError, describeError } from '@/lib/jobs/errors';
import { abs } from '@/lib/storage';
import type { BBox, Locale } from '@/lib/types';

export interface RunVisionContext {
  /** sha1 hex of the first 4 MiB of the source (computed once by the caller) */
  sourceSha1: string | null;
  locale: Locale;
  /** defaults: env VISION_BATCH_SIZE / VISION_CONCURRENCY */
  batchSize?: number;
  concurrency?: number;
  /** videos.progress range covered by this step (default 20..85) */
  progressFrom?: number;
  progressTo?: number;
  /** stops scheduling new batches */
  signal?: AbortSignal;
  /** retries per batch after the first attempt (default 2) */
  retries?: number;
  /** delay before retry k (1-based), default 2 s × 3^(k-1) */
  retryDelayMs?: (retry: number) => number;
}

export interface RunVisionResult {
  batches: number;
  succeededBatches: number;
  failedBatches: number;
  detections: number;
  framesAnalyzed: number;
}

type NewDetection = typeof detections.$inferInsert;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit tested)                                          */
/* ------------------------------------------------------------------ */

/**
 * Splits `count` consecutive frames into batches of `size` that overlap by `overlap` frames.
 * Returns 0-based frame indices per batch. A trailing batch is never a pure subset of the previous one.
 */
export function planBatches(count: number, size: number, overlap = 1): number[][] {
  const n = Math.max(0, Math.floor(count));
  const s = Math.max(1, Math.floor(size));
  const o = Math.min(Math.max(0, Math.floor(overlap)), s - 1);
  const out: number[][] = [];
  if (n === 0) return out;
  let start = 0;
  for (;;) {
    const end = Math.min(start + s, n);
    const batch: number[] = [];
    for (let i = start; i < end; i++) batch.push(i);
    out.push(batch);
    if (end >= n) break;
    start = end - o;
  }
  return out;
}

const finiteOr = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/**
 * Clamps a model-provided box to the frame and normalises it (x0 < x1, y0 < y1, integer pixels).
 * Boxes given in normalised 0..1 coordinates are scaled to pixels. Degenerate / invalid boxes → null.
 */
export function clampBbox(bbox: BBox | null | undefined, width: number, height: number): BBox | null {
  if (!bbox || width <= 0 || height <= 0) return null;
  let x0 = Number(bbox.x0);
  let y0 = Number(bbox.y0);
  let x1 = Number(bbox.x1);
  let y1 = Number(bbox.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const maxCoord = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1));
  if (maxCoord <= 1 && width > 2 && height > 2 && (x0 !== x1 || y0 !== y1)) {
    // normalised coordinates
    x0 *= width;
    x1 *= width;
    y0 *= height;
    y1 *= height;
  }
  const left = Math.max(0, Math.min(width, Math.min(x0, x1)));
  const right = Math.max(0, Math.min(width, Math.max(x0, x1)));
  const top = Math.max(0, Math.min(height, Math.min(y0, y1)));
  const bottom = Math.max(0, Math.min(height, Math.max(y0, y1)));
  const box = { x0: Math.floor(left), y0: Math.floor(top), x1: Math.ceil(right), y1: Math.ceil(bottom) };
  box.x1 = Math.min(width, box.x1);
  box.y1 = Math.min(height, box.y1);
  if (box.x1 - box.x0 < 1 || box.y1 - box.y0 < 1) return null;
  return box;
}

export function clampConfidence(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : finiteOr(v, Number.NaN);
  if (!Number.isFinite(n)) return 0;
  // some models answer in percent ("85"); values just above 1 are over-confident, not percentages
  const scaled = n >= 2 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

function cleanText(v: unknown, maxLength: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || /^(null|none|n\/a|unknown|-+)$/i.test(t)) return null;
  return t.length > maxLength ? t.slice(0, maxLength) : t;
}

export interface CanonicalHint {
  canonicalAuthor: string | null;
  canonicalTitle: string | null;
}

export interface MappedObservation {
  row: NewDetection;
  hint: CanonicalHint;
}

/** Maps provider observations of one batch to detection rows (frame ids by 1-based batch index). */
export function observationsToDetections(
  observations: SpineObservation[],
  batchFrames: Pick<FrameRow, 'id' | 'width' | 'height'>[],
  meta: { collectionId: string; videoId: string; provider: string; model: string },
): MappedObservation[] {
  const out: MappedObservation[] = [];
  const perFrameCount = new Map<number, number>();
  for (const obs of observations) {
    const frameNo = Math.round(finiteOr(obs?.frame, Number.NaN));
    if (!Number.isFinite(frameNo) || frameNo < 1 || frameNo > batchFrames.length) continue;
    const frame = batchFrames[frameNo - 1];
    const title = cleanText(obs.title, 500);
    if (!title) continue;
    const seen = (perFrameCount.get(frameNo) ?? 0) + 1;
    perFrameCount.set(frameNo, seen);
    const rawOrder = finiteOr(obs.order, Number.NaN);
    const order = Number.isFinite(rawOrder) && rawOrder >= 1 ? Math.round(rawOrder) : seen;
    out.push({
      row: {
        collectionId: meta.collectionId,
        videoId: meta.videoId,
        frameId: frame.id,
        rawAuthor: cleanText(obs.author, 300),
        rawTitle: title,
        publisher: cleanText(obs.publisher, 200),
        confidence: clampConfidence(obs.confidence),
        bbox: clampBbox(obs.bbox, frame.width, frame.height),
        orderInFrame: order,
        provider: meta.provider.slice(0, 16),
        model: meta.model || 'unknown',
      },
      hint: {
        canonicalAuthor: cleanText(obs.canonicalAuthor, 300),
        canonicalTitle: cleanText(obs.canonicalTitle, 500),
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Canonical hints (the detections table has no canonical_* columns)   */
/* ------------------------------------------------------------------ */

const canonicalHints = new Map<string, Map<string, CanonicalHint>>();

/**
 * canonical_author / canonical_title proposed by the vision model per detection id, for the video that
 * is being processed in this worker process (kept until clearCanonicalHints). Detections without a hint
 * are absent.
 */
export function getCanonicalHints(videoId: string): ReadonlyMap<string, CanonicalHint> {
  return canonicalHints.get(videoId) ?? new Map();
}

export function clearCanonicalHints(videoId: string): void {
  canonicalHints.delete(videoId);
}

/* ------------------------------------------------------------------ */
/* runVision                                                           */
/* ------------------------------------------------------------------ */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** AI errors carry a `retryable` flag (src/lib/ai/errors.ts). */
function isNonRetryable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { retryable?: unknown }).retryable === false;
}

function isForeignKeyViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if ((cur as { code?: string }).code === '23503') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

async function loadBatchFrames(batch: FrameRow[]): Promise<VisionFrame[]> {
  return Promise.all(
    batch.map(async (f, i) => ({
      index: i + 1,
      frameId: f.id,
      jpeg: await fs.readFile(abs(f.storagePath)),
      width: f.width,
      height: f.height,
      timeSec: f.timeSec,
    })),
  );
}

/** Defaults for batch retries (mutable so integration tests can shorten the delays). */
export const visionRetryDefaults = {
  retries: 2,
  retryDelayMs: (retry: number): number => 2000 * 3 ** (retry - 1),
};

export async function runVision(video: VideoRow, frameRows: FrameRow[], ctx: RunVisionContext): Promise<RunVisionResult> {
  const e = env();
  const ordered = [...frameRows].sort((a, b) => a.idx - b.idx);
  const batchSize = Math.max(1, Math.floor(ctx.batchSize ?? e.VISION_BATCH_SIZE ?? 4));
  const concurrency = Math.max(1, Math.floor(ctx.concurrency ?? e.VISION_CONCURRENCY ?? 2));
  const retries = Math.max(0, Math.floor(ctx.retries ?? visionRetryDefaults.retries));
  const retryDelay = ctx.retryDelayMs ?? visionRetryDefaults.retryDelayMs;
  const progressFrom = ctx.progressFrom ?? 20;
  const progressTo = ctx.progressTo ?? 85;
  const plan = planBatches(ordered.length, batchSize, 1);

  const result: RunVisionResult = {
    batches: plan.length,
    succeededBatches: 0,
    failedBatches: 0,
    detections: 0,
    framesAnalyzed: 0,
  };
  if (plan.length === 0) return result;

  let provider: VisionProvider;
  try {
    provider = getVisionProvider();
  } catch (err) {
    // misconfiguration (AiConfigError, retryable === false) will not heal by itself
    throw new PipelineError('ai_failed', `vision provider unavailable: ${describeError(err, 300)}`, {
      cause: err,
      retryable: !isNonRetryable(err),
    });
  }

  const hints = new Map<string, CanonicalHint>();
  canonicalHints.set(video.id, hints);

  const analyzedFrameIds = new Set<string>();
  let completed = 0;
  let gone = false;
  let fatal: unknown = null;
  let progressChain: Promise<void> = Promise.resolve();

  const reportProgress = () => {
    const framesAnalyzed = analyzedFrameIds.size;
    const progress = Math.round(progressFrom + ((progressTo - progressFrom) * completed) / plan.length);
    progressChain = progressChain.then(async () => {
      if (gone) return;
      const res = await db()
        .update(videos)
        .set({ framesAnalyzed, progress })
        .where(eq(videos.id, video.id))
        .returning({ id: videos.id });
      if (res.length === 0) gone = true;
    });
    return progressChain;
  };

  const runBatch = async (batchIndex: number): Promise<void> => {
    const batch = plan[batchIndex].map((i) => ordered[i]);
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (gone || fatal || ctx.signal?.aborted) return;
      if (attempt > 0) await sleep(retryDelay(attempt), ctx.signal);
      if (gone || fatal || ctx.signal?.aborted) return;
      try {
        const visionFrames = await loadBatchFrames(batch);
        const { observations, usage } = await provider.readSpines(visionFrames, {
          collectionId: video.collectionId,
          videoId: video.id,
          originalFilename: video.originalFilename,
          sourceSha1: ctx.sourceSha1,
          batchIndex,
          totalBatches: plan.length,
          locale: ctx.locale,
        });
        await recordUsageSafe(video.collectionId, usage);
        const mapped = observationsToDetections(Array.isArray(observations) ? observations : [], batch, {
          collectionId: video.collectionId,
          videoId: video.id,
          provider: usage?.provider ?? provider.name,
          model: usage?.model || provider.model,
        });
        // detections + analyzed flags atomically, so a retry never duplicates rows
        const inserted = await db().transaction(async (tx) => {
          const rows =
            mapped.length > 0
              ? await tx
                  .insert(detections)
                  .values(mapped.map((m) => m.row))
                  .returning({ id: detections.id })
              : [];
          await tx
            .update(framesTable)
            .set({ analyzed: true })
            .where(inArray(framesTable.id, batch.map((f) => f.id)));
          return rows;
        });
        inserted.forEach((row, i) => {
          const h = mapped[i].hint;
          if (h.canonicalAuthor || h.canonicalTitle) hints.set(row.id, h);
        });
        result.succeededBatches++;
        result.detections += mapped.length;
        for (const f of batch) analyzedFrameIds.add(f.id);
        return;
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          gone = true;
          return;
        }
        lastError = err;
        console.warn('[pipeline] vision batch failed', {
          videoId: video.id,
          batch: batchIndex + 1,
          of: plan.length,
          attempt: attempt + 1,
          error: describeError(err, 300),
        });
        if (err instanceof Error && err.name === 'AiConfigError') {
          // every other batch would fail the same way: stop the step now
          fatal = new PipelineError('ai_failed', describeError(err, 300), { cause: err, retryable: false });
          return;
        }
        if (isNonRetryable(err)) break; // e.g. the provider rejected this request – skip the batch
      }
    }
    if (gone || fatal || ctx.signal?.aborted) return;
    result.failedBatches++;
    console.warn('[pipeline] vision batch skipped after retries', {
      videoId: video.id,
      batch: batchIndex + 1,
      of: plan.length,
      error: describeError(lastError, 300),
    });
  };

  let next = 0;
  const lane = async () => {
    while (!gone && !fatal && !ctx.signal?.aborted) {
      const batchIndex = next++;
      if (batchIndex >= plan.length) return;
      try {
        await runBatch(batchIndex);
        completed++;
        await reportProgress();
      } catch (err) {
        fatal = err;
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length) }, () => lane()));
  await progressChain.catch((err: unknown) => {
    fatal = fatal ?? err;
  });

  if (gone) throw new VideoGoneError(video.id);
  if (fatal) throw fatal;
  if (ctx.signal?.aborted) {
    const abortErr = new Error('vision step aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  result.framesAnalyzed = analyzedFrameIds.size;
  if (result.succeededBatches * 2 < plan.length) {
    throw new PipelineError(
      'ai_failed',
      `only ${result.succeededBatches}/${plan.length} vision batches succeeded`,
    );
  }
  return result;
}

async function recordUsageSafe(collectionId: string, usage: AiUsage | undefined): Promise<void> {
  if (!usage) return;
  try {
    await recordUsage(collectionId, usage);
  } catch (err) {
    console.warn('[pipeline] recordUsage failed', { collectionId, error: describeError(err, 200) });
  }
}

/** Number of detections stored for a video (used to decide `no_books`). */
export async function countVideoDetections(videoId: string): Promise<number> {
  const res = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(detections)
    .where(eq(detections.videoId, videoId));
  return Number(res[0]?.n ?? 0);
}

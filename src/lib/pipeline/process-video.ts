/**
 * Per-source processing flow (SPEC §4.1–4.5), run by the `process_video` job.
 *
 *   probe 0–5 → frames 5–20 → vision 20–85 → merge 85–92 → crops 92–100 → stage done
 *
 * - videos.error stores a code (too_long, unreadable, no_frames, no_books, ai_failed, internal); the UI
 *   localises it.
 * - Re-runs are idempotent: frames, detections and frame files of a previous run of this source are
 *   removed first (books whose only evidence was this source are deleted, like the API does).
 * - The video row may disappear mid-run (the owner removed the source): the run stops quietly.
 * - Non-retryable failures mark the source `error` here; retryable ones are thrown to the worker, which
 *   re-queues the job and calls markVideoFailed() after the last attempt.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { books, collections, detections, frames, unreadSpines, videos, type FrameRow, type VideoRow } from '@/db/schema';
import { env } from '@/lib/env';
import {
  PipelineError,
  VideoGoneError,
  describeError,
  type VideoErrorCode,
} from '@/lib/jobs/errors';
import { mergeVideoDetections } from '@/lib/pipeline/merge';
import { abs, rel, removeCollectionFiles } from '@/lib/storage';
import type { Locale, VideoStage } from '@/lib/types';
import { cropSpines } from './crops';
import { scheduleCollectionCompletion } from './finalize';
import { selectKeyFrames } from './frames';
import { probeMedia } from './probe';
import { recognizeSpines } from './spines/recognize';
import { clearCanonicalHints, countVideoDetections, runVision } from './vision-step';

export const SHA1_PREFIX_BYTES = 4 * 1024 * 1024;

export const STAGE_PROGRESS: Record<'probe' | 'frames' | 'vision' | 'merge' | 'crops', [number, number]> = {
  probe: [0, 5],
  frames: [5, 20],
  vision: [20, 85],
  merge: [85, 92],
  crops: [92, 100],
};

export interface ProcessVideoResult {
  status: 'done' | 'error' | 'gone' | 'skipped';
  errorCode?: VideoErrorCode;
  framesTotal?: number;
  detections?: number;
  newBooks?: number;
  updatedBooks?: number;
}

export interface ProcessVideoOptions {
  /** aborts ffmpeg / vision scheduling (worker shutdown) */
  signal?: AbortSignal;
  /**
   * Recognise the books again (owner "reanalyse"): when the source file was already removed, the stored key
   * frames are read again instead of extracting new ones.
   */
  fromFrames?: boolean;
}

/** relative directory holding the key frames of a source */
export function frameDirRel(collectionId: string, videoId: string): string {
  return `frames/${collectionId}/${videoId}`;
}

/** sha1 hex of the first 4 MiB of a file */
export async function sha1OfPrefix(filePath: string, bytes: number = SHA1_PREFIX_BYTES): Promise<string> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    let offset = 0;
    while (offset < bytes) {
      const { bytesRead } = await fh.read(buf, offset, bytes - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return createHash('sha1').update(buf.subarray(0, offset)).digest('hex');
  } finally {
    await fh.close();
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Updates the video row; throws VideoGoneError when the row no longer exists. */
async function updateVideo(videoId: string, values: Partial<typeof videos.$inferInsert>): Promise<void> {
  const res = await db().update(videos).set(values).where(eq(videos.id, videoId)).returning({ id: videos.id });
  if (res.length === 0) throw new VideoGoneError(videoId);
}

async function videoExists(videoId: string): Promise<boolean> {
  const rows = await db().select({ id: videos.id }).from(videos).where(eq(videos.id, videoId));
  return rows.length > 0;
}

/**
 * Files a run may have written after the API removed the source / collection. When the whole collection
 * is gone every directory of it is removed; otherwise only this source's frame dir.
 */
async function removeRunLeftovers(collectionId: string, videoId: string): Promise<void> {
  try {
    const [col] = await db().select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId));
    if (!col) {
      await removeCollectionFiles(collectionId);
      return;
    }
  } catch {
    /* DB unavailable – fall back to the frame dir only */
  }
  const dir = abs(frameDirRel(collectionId, videoId));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.rmdir(path.dirname(dir)).catch(() => {}); // frames/<cid> only when empty
}

/** Throttled progress writer (≥ 1 point change and ≥ 700 ms apart, or forced). */
function progressWriter(videoId: string) {
  let lastValue = -1;
  let lastAt = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    set(value: number, force = false): Promise<void> {
      const v = Math.max(0, Math.min(100, Math.round(value)));
      const now = Date.now();
      if (!force && (v === lastValue || now - lastAt < 700)) return chain;
      lastValue = v;
      lastAt = now;
      chain = chain.then(() => updateVideo(videoId, { progress: v }));
      return chain;
    },
  };
}

/**
 * Removes the results of a previous run of this source: detections, frames (rows + files, unless
 * `keepFrames`) and books whose only evidence was this source (manual and reviewed books are kept; the
 * others get their detection count and evidence references re-derived).
 */
export async function resetVideoResults(
  video: Pick<VideoRow, 'id' | 'collectionId'>,
  opts: { keepFrames?: boolean } = {},
): Promise<{ deletedBooks: number }> {
  const deleted = await db().transaction(async (tx) => {
    const affected = await tx.execute<{
      id: string;
      source: string;
      reviewed: boolean;
      spine_path: string | null;
      cover_path: string | null;
      has_other: boolean;
    }>(sql`
      SELECT b.id, b.source, b.reviewed, b.spine_path, b.cover_path,
             EXISTS (SELECT 1 FROM detections d2 WHERE d2.book_id = b.id AND d2.video_id <> ${video.id}) AS has_other
        FROM books b
       WHERE b.collection_id = ${video.collectionId}
         AND b.id IN (SELECT d.book_id FROM detections d WHERE d.video_id = ${video.id} AND d.book_id IS NOT NULL)
    `);
    const rows = affected.rows;
    const toDelete = rows.filter((r) => !r.has_other && r.source !== 'manual' && !r.reviewed);
    const toKeep = rows.filter((r) => !toDelete.includes(r)).map((r) => r.id);
    if (toDelete.length > 0) {
      await tx.delete(books).where(inArray(books.id, toDelete.map((r) => r.id)));
    }
    if (toKeep.length > 0) {
      await tx.execute(sql`
        UPDATE books b
           SET detection_count = GREATEST(1, (SELECT count(*) FROM detections d WHERE d.book_id = b.id AND d.video_id <> ${video.id}))
         WHERE b.id IN ${toKeep}
      `);
      await tx.execute(sql`
        UPDATE books SET best_frame_id = NULL, best_bbox = NULL
         WHERE id IN ${toKeep} AND best_frame_id IN (SELECT f.id FROM frames f WHERE f.video_id = ${video.id})
      `);
    }
    await tx.delete(detections).where(eq(detections.videoId, video.id));
    const unread = await tx.delete(unreadSpines).where(eq(unreadSpines.videoId, video.id)).returning({ spinePath: unreadSpines.spinePath });
    if (opts.keepFrames) await tx.update(frames).set({ analyzed: false }).where(eq(frames.videoId, video.id));
    else await tx.delete(frames).where(eq(frames.videoId, video.id));
    return { toDelete, unreadPaths: unread.map((u) => u.spinePath) };
  });
  if (!opts.keepFrames) await fs.rm(abs(frameDirRel(video.collectionId, video.id)), { recursive: true, force: true });
  await Promise.all(
    [...deleted.toDelete.flatMap((r) => [r.spine_path, r.cover_path]), ...deleted.unreadPaths]
      .filter((p): p is string => Boolean(p))
      .map((p) => fs.rm(abs(p), { force: true }).catch(() => {})),
  );
  return { deletedBooks: deleted.toDelete.length };
}

/**
 * Marks a source as failed with an error code and lets the collection move on (enrichment / finalize
 * when nothing else is pending). Safe to call when the row is gone.
 */
export async function markVideoFailed(videoId: string, code: VideoErrorCode, detail?: string): Promise<void> {
  const res = await db()
    .update(videos)
    .set({ status: 'error', error: code, processedAt: new Date() })
    .where(eq(videos.id, videoId))
    .returning({ collectionId: videos.collectionId });
  if (res.length === 0) return;
  console.warn('[pipeline] source failed', { videoId, code, detail: detail?.slice(0, 300) });
  clearCanonicalHints(videoId);
  await scheduleCollectionCompletion(res[0].collectionId);
}

/** A retryable failure: the source goes back to `queued` until the job runs again. */
export async function markVideoRetrying(videoId: string): Promise<void> {
  await db()
    .update(videos)
    .set({ status: 'queued', stage: null, progress: 0 })
    .where(and(eq(videos.id, videoId), inArray(videos.status, ['processing', 'queued'])));
}

export async function processVideo(videoId: string, opts: ProcessVideoOptions = {}): Promise<ProcessVideoResult> {
  const startedAt = Date.now();
  const [video] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!video) {
    console.info('[pipeline] process_video: source no longer exists', { videoId });
    return { status: 'gone' };
  }
  const useStoredFrames = opts.fromFrames === true && !video.storagePath;
  if (video.status === 'done' && !video.storagePath && !useStoredFrames) {
    console.info('[pipeline] process_video: source already processed', { videoId });
    return { status: 'skipped' };
  }
  if (video.uploadStatus !== 'uploaded') {
    console.warn('[pipeline] process_video: upload not complete, skipping', { videoId, uploadStatus: video.uploadStatus });
    return { status: 'skipped' };
  }
  const [collection] = await db()
    .select({ id: collections.id, locale: collections.locale, status: collections.status })
    .from(collections)
    .where(eq(collections.id, video.collectionId));
  if (!collection) return { status: 'gone' };
  const locale: Locale = collection.locale === 'en' ? 'en' : 'hu';
  const e = env();

  const stage = async (s: VideoStage, progress: number, extra: Partial<typeof videos.$inferInsert> = {}) => {
    await updateVideo(videoId, { stage: s, progress, ...extra });
  };

  try {
    await updateVideo(videoId, {
      status: 'processing',
      stage: useStoredFrames ? 'vision' : 'probe',
      progress: useStoredFrames ? STAGE_PROGRESS.vision[0] : 0,
      error: null,
      processedAt: null,
      ...(useStoredFrames ? {} : { framesTotal: 0 }),
      framesAnalyzed: 0,
      booksFound: 0,
    });
    if (collection.status !== 'processing') {
      await db()
        .update(collections)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(collections.id, collection.id));
    }
    await resetVideoResults(video, { keepFrames: useStoredFrames });
    const progress = progressWriter(videoId);
    let frameRows: FrameRow[];
    let sourceSha1: string | null = null;
    let kind: string = video.kind;

    if (useStoredFrames) {
      frameRows = await db().select().from(frames).where(eq(frames.videoId, videoId)).orderBy(frames.idx);
      if (frameRows.length === 0) throw new PipelineError('no_frames', 'no stored key frames to analyse again');
      console.info('[pipeline] analysing the stored key frames again', { videoId, frames: frameRows.length });
    } else {
      /* ---------------- probe 0–5 ---------------- */
      if (!video.storagePath) throw new PipelineError('unreadable', 'source file was already removed');
      const sourceAbs = abs(video.storagePath);
      try {
        await fs.access(sourceAbs);
      } catch (err) {
        throw new PipelineError('unreadable', 'source file is missing', { cause: err });
      }
      const probe = await probeMedia(sourceAbs, { signal: opts.signal });
      if (probe.kind === 'video' && probe.durationSec !== null && probe.durationSec > e.MAX_VIDEO_SECONDS + 0.5) {
        throw new PipelineError('too_long', `video is ${Math.round(probe.durationSec)} s (max ${e.MAX_VIDEO_SECONDS} s)`);
      }
      sourceSha1 = await sha1OfPrefix(sourceAbs);
      kind = probe.kind;
      await updateVideo(videoId, {
        kind: probe.kind,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        progress: STAGE_PROGRESS.probe[1],
      });

      /* ---------------- frames 5–20 ---------------- */
      await stage('frames', STAGE_PROGRESS.frames[0]);
      const [fFrom, fTo] = STAGE_PROGRESS.frames;
      const selection = await selectKeyFrames(sourceAbs, abs(frameDirRel(video.collectionId, videoId)), {
        probe,
        signal: opts.signal,
        onProgress: (f) => progress.set(fFrom + (fTo - fFrom) * f),
      });
      if (selection.frames.length === 0) throw new PipelineError('no_frames', 'no key frames selected');
      if (probe.kind === 'video' && selection.durationSec > e.MAX_VIDEO_SECONDS + 0.5) {
        throw new PipelineError('too_long', `video is ${Math.round(selection.durationSec)} s (max ${e.MAX_VIDEO_SECONDS} s)`);
      }
      frameRows = await db()
        .insert(frames)
        .values(
          selection.frames.map((f) => ({
            videoId,
            collectionId: video.collectionId,
            idx: f.idx,
            timeSec: f.timeSec,
            sharpness: Number.isFinite(f.sharpness) ? f.sharpness : null,
            storagePath: rel.frame(video.collectionId, videoId, f.idx),
            thumbPath: rel.frameThumb(video.collectionId, videoId, f.idx),
            width: f.width,
            height: f.height,
          })),
        )
        .returning();
      await updateVideo(videoId, {
        framesTotal: frameRows.length,
        durationSec: probe.durationSec ?? selection.durationSec,
        progress: fTo,
      });
      console.info('[pipeline] frames selected', {
        videoId,
        ...selection.stats,
        durationSec: Math.round(selection.durationSec * 10) / 10,
      });
    }

    /* ---------------- vision 20–85 ---------------- */
    await stage('vision', STAGE_PROGRESS.vision[0]);
    const visionCtx = {
      sourceSha1,
      locale,
      signal: opts.signal,
      progressFrom: STAGE_PROGRESS.vision[0],
      progressTo: STAGE_PROGRESS.vision[1],
    };
    // every spine cut out and read on its own; whole frames when no spine was found (or switched off)
    const spines = e.SPINE_RECOGNITION.toLowerCase() === 'off' ? null : await recognizeSpines(video, frameRows, visionCtx);
    const vision = spines
      ? { batches: spines.batches, failedBatches: spines.failedBatches, framesAnalyzed: spines.framesAnalyzed }
      : await runVision(video, frameRows, visionCtx);
    if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const detectionCount = await countVideoDetections(videoId);
    if (detectionCount === 0) throw new PipelineError('no_books', 'no legible spines were found');

    /* ---------------- merge 85–92 ---------------- */
    await stage('merge', STAGE_PROGRESS.merge[0], { framesAnalyzed: vision.framesAnalyzed });
    const merged = await mergeVideoDetections(videoId, spines ? { canonicalHints: spines.hints } : {});
    clearCanonicalHints(videoId);
    if (!(await videoExists(videoId))) throw new VideoGoneError(videoId);
    const bookIds = [...new Set([...merged.newBookIds, ...merged.updatedBookIds])];
    if (bookIds.length === 0) throw new PipelineError('no_books', 'merge produced no books');

    /* ---------------- crops 92–100 ---------------- */
    await stage('crops', STAGE_PROGRESS.crops[0]);
    const [cFrom, cTo] = STAGE_PROGRESS.crops;
    const crops = await cropSpines(bookIds, (f) => progress.set(cFrom + (cTo - cFrom) * f));

    await updateVideo(videoId, {
      status: 'done',
      stage: 'done',
      progress: 100,
      error: null,
      processedAt: new Date(),
    });
    console.info('[pipeline] source processed', {
      videoId,
      collectionId: video.collectionId,
      kind,
      frames: frameRows.length,
      fromStoredFrames: useStoredFrames,
      recognition: spines ? 'spines' : 'frames',
      batches: vision.batches,
      failedBatches: vision.failedBatches,
      detections: detectionCount,
      newBooks: merged.newBookIds.length,
      updatedBooks: merged.updatedBookIds.length,
      crops: crops.cropped,
      ms: Date.now() - startedAt,
    });
    await scheduleCollectionCompletion(video.collectionId);
    return {
      status: 'done',
      framesTotal: frameRows.length,
      detections: detectionCount,
      newBooks: merged.newBookIds.length,
      updatedBooks: merged.updatedBookIds.length,
    };
  } catch (err) {
    clearCanonicalHints(videoId);
    const gone = err instanceof VideoGoneError || !(await videoExists(videoId).catch(() => true));
    if (gone) {
      // The owner removed the source (or the whole collection) mid-run: drop whatever this run wrote
      // after the API cleaned up, and stop quietly – no retry, no error marker.
      await removeRunLeftovers(video.collectionId, videoId);
      console.info('[pipeline] process_video: source removed during processing', {
        videoId,
        collectionId: video.collectionId,
        stoppedBy: err instanceof VideoGoneError ? 'row_gone' : describeError(err, 120),
      });
      return { status: 'gone' };
    }
    if (isAbortError(err)) throw err;
    if (err instanceof PipelineError && !err.retryable) {
      await markVideoFailed(videoId, err.code, describeError(err, 300));
      return { status: 'error', errorCode: err.code };
    }
    throw err;
  }
}

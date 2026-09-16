/**
 * Spine recognition step (replaces the whole-frame vision step when the geometry finds spines):
 *
 *   geometry (bands, boundaries, motion, tracks) → spine candidates → best 1–2 views per spine, cut out
 *   upright → reading pictures in batches → one reading per physical spine → detections for EVERY frame
 *   that shows the spine (exact tilted rectangles), ready for the regular merge.
 *
 * Each physical spine is read once from its sharpest views, so a book can no longer turn into several
 * books because different frames were read differently, and an author can no longer slip over from the
 * neighbouring spine. Returns null when the geometry finds no spine or the provider cannot read cut-out
 * spines – the caller then runs the whole-frame vision step.
 */
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '@/db';
import { detections, frames as framesTable, videos, type FrameRow, type VideoRow } from '@/db/schema';
import { getVisionProvider } from '@/lib/ai';
import type { AiUsage, SpineReading, SpineToRead, SpineViewImage, VisionContext, VisionProvider } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import { env } from '@/lib/env';
import { PipelineError, VideoGoneError, describeError } from '@/lib/jobs/errors';
import { abs } from '@/lib/storage';
import type { Locale } from '@/lib/types';
import { authorsCompatible, normalizeTitle, titleContainment, titleNumbersConflict, titleSimilarityNormalized } from '../text';
import type { CanonicalHint } from '../vision-step';
import { analyzeVideoGeometry, type VideoGeometry } from './geometry';
import { cutUpright, readingImage, rectBoundingBox, spineRect, splitPositions, stripSharpness } from './strips';
import type { SpineCandidate, SpineView } from './tracking';

/** views cut per spine to find the sharpest */
const VIEW_CANDIDATES = 3;
/** views sent for reading per spine */
const VIEWS_PER_SPINE = 2;
/** detections of views that were not read get this share of the reading's confidence */
const UNREAD_VIEW_CONFIDENCE = 0.97;
const CUT_CONCURRENCY = 4;

export interface ChosenView {
  view: SpineView;
  upright: Buffer;
  reading: SpineViewImage;
  sharpness: number;
}

export interface ChosenCandidate {
  candidate: SpineCandidate;
  /** the views sent for reading, best first */
  read: ChosenView[];
  /** much wider than the other spines of its shelf: probably several books whose gaps were missed */
  wide: boolean;
  /** several books in one spine: where each stands, as fractions of the spine width (left to right) */
  spans?: [number, number][];
}

/** a spine this many times wider than the median spine of its shelf is labelled wide */
const WIDE_FACTOR = 1.8;

/** Median spine width (px, in its most central view) per shelf chain. */
function medianWidths(candidates: readonly SpineCandidate[]): Map<number, number> {
  const byChain = new Map<number, number[]>();
  for (const c of candidates) {
    const v = [...c.views].sort((a, b) => b.centrality - a.centrality)[0];
    if (!v) continue;
    const list = byChain.get(c.chain) ?? [];
    list.push(v.right.xc - v.left.xc);
    byChain.set(c.chain, list);
  }
  return new Map([...byChain].map(([chain, widths]) => {
    const sorted = widths.sort((a, b) => a - b);
    return [chain, sorted[sorted.length >> 1]];
  }));
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
  return out;
}

/**
 * Picks the views to read: the most central views of sharp frames are cut out, the sharpest one wins, the
 * second view comes from a different moment of the pan when possible (other glare, other angle).
 * `exclude` skips frames already read (second chance for spines that stayed illegible).
 */
export async function chooseViews(
  geometry: VideoGeometry,
  inputs: readonly (string | Buffer)[],
  frameSharpness: readonly (number | null)[],
  opts: {
    candidates?: readonly SpineCandidate[];
    exclude?: ReadonlyMap<SpineCandidate, ReadonlySet<number>>;
    /** label unusually wide spines as probably several books (off for joined slices of one spine) */
    labelWide?: boolean;
  } = {},
): Promise<ChosenCandidate[]> {
  const medians = medianWidths(geometry.candidates);
  const maxSharp = Math.max(1e-9, ...frameSharpness.map((s) => (typeof s === 'number' && Number.isFinite(s) ? s : 0)));
  const rank = (view: SpineView): number => {
    const s = frameSharpness[view.frame];
    const sharp = typeof s === 'number' && Number.isFinite(s) ? s / maxSharp : 0.5;
    return 0.65 * view.centrality + 0.35 * sharp;
  };
  const chosen = await mapLimit(opts.candidates ?? geometry.candidates, CUT_CONCURRENCY, async (candidate) => {
    const skip = opts.exclude?.get(candidate);
    const ranked = candidate.views.filter((v) => !skip?.has(v.frame)).sort((a, b) => rank(b) - rank(a));
    if (ranked.length === 0) return null;
    // for a second chance, spread the tries over the whole pan: the spine may be hidden in one part of it
    const pool = skip ? spreadOut(ranked, VIEW_CANDIDATES) : ranked.slice(0, VIEW_CANDIDATES);
    const cut = await Promise.all(
      pool.map(async (view) => {
        const frame = geometry.frames[view.frame];
        const upright = await cutUpright(inputs[view.frame], spineRect(view, frame.height));
        return { view, upright, sharpness: await stripSharpness(upright) };
      }),
    );
    cut.sort((a, b) => b.sharpness - a.sharpness);
    const picked = [cut[0]];
    if (VIEWS_PER_SPINE > 1 && cut.length > 1) {
      const apart = cut.slice(1).find((c) => Math.abs(c.view.frame - cut[0].view.frame) >= 2);
      picked.push(apart ?? cut[1]);
    }
    const median = medians.get(candidate.chain);
    const bestWidth = picked[0].view.right.xc - picked[0].view.left.xc;
    const unusuallyWide = median !== undefined && median > 0 && bestWidth >= WIDE_FACTOR * median;
    const wide = unusuallyWide && opts.labelWide !== false;
    const read = await Promise.all(picked.map(async (p) => ({ ...p, reading: await readingImage(p.upright, { withUpright: unusuallyWide }) })));
    return { candidate, read, wide };
  });
  return chosen.filter((c): c is ChosenCandidate => c !== null);
}

/** Up to `n` views spread evenly over the frame order (best-ranked first within each part). */
function spreadOut(ranked: readonly SpineView[], n: number): SpineView[] {
  if (ranked.length <= n) return [...ranked];
  const byFrame = [...ranked].sort((a, b) => a.frame - b.frame);
  const out: SpineView[] = [];
  for (let k = 0; k < n; k++) {
    const part = byFrame.slice(Math.floor((k * byFrame.length) / n), Math.floor(((k + 1) * byFrame.length) / n));
    const best = part.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b))[0];
    if (best) out.push(best);
  }
  return out;
}

/** A spine is read again from other frames when nothing (or only a guess) came back for it. */
export function needsSecondChance(readings: readonly SpineReading[] | undefined): boolean {
  if (!readings || readings.length === 0) return true;
  if (readings.some((r) => r.status === 'not_book')) return false;
  const books = readings.filter((r) => r.status === 'book' && (r.title || r.canonicalTitle));
  return books.length === 0 || books.every((r) => r.confidence < 0.6);
}

/** The better of two reading lists of the same spine (a legible book beats illegible, then confidence). */
export function betterReadings(a: readonly SpineReading[] | undefined, b: readonly SpineReading[] | undefined): SpineReading[] {
  const score = (list: readonly SpineReading[] | undefined) => {
    const books = (list ?? []).filter((r) => r.status === 'book' && (r.title || r.canonicalTitle));
    return books.length ? 1 + Math.max(...books.map((r) => r.confidence)) : (list ?? []).some((r) => r.status === 'illegible') ? 0.5 : 0;
  };
  return [...(score(b) > score(a) ? (b ?? []) : (a ?? []))];
}

export interface ReadCandidatesOptions {
  /** images per request (default env SPINE_BATCH_IMAGES) */
  batchImages?: number;
  concurrency?: number;
  retries?: number;
  retryDelayMs?: (retry: number) => number;
  signal?: AbortSignal;
  /** after every finished batch (successful or skipped) */
  onBatch?: (done: number, total: number) => void | Promise<void>;
}

/** Splits candidates into batches of at most `maxImages` pictures (a spine is never split). */
export function planSpineBatches(chosen: readonly Pick<ChosenCandidate, 'read'>[], maxImages: number): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let images = 0;
  chosen.forEach((c, i) => {
    const n = c.read.length;
    if (current.length && images + n > maxImages) {
      batches.push(current);
      current = [];
      images = 0;
    }
    current.push(i);
    images += n;
  });
  if (current.length) batches.push(current);
  return batches;
}

function isNonRetryable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { retryable?: unknown }).retryable === false;
}

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

/** Reads the chosen candidates; readings are keyed by the candidate's index in `chosen`. */
export async function readCandidates(
  chosen: readonly ChosenCandidate[],
  provider: VisionProvider,
  ctx: Omit<VisionContext, 'batchIndex' | 'totalBatches'>,
  opts: ReadCandidatesOptions = {},
): Promise<{ readings: Map<number, SpineReading[]>; usage: AiUsage; batches: number; failedBatches: number; usages: AiUsage[] }> {
  if (!provider.readSpineImages) throw new Error(`${provider.name} cannot read cut-out spines`);
  const plan = planSpineBatches(chosen, Math.max(1, opts.batchImages ?? env().SPINE_BATCH_IMAGES));
  const concurrency = Math.max(1, opts.concurrency ?? env().VISION_CONCURRENCY);
  const retries = Math.max(0, opts.retries ?? 2);
  const retryDelay = opts.retryDelayMs ?? ((r: number) => 2000 * 3 ** (r - 1));
  const readings = new Map<number, SpineReading[]>();
  const usages: AiUsage[] = [];
  let failedBatches = 0;
  let done = 0;
  let fatal: unknown = null;

  const runBatch = async (batchIndex: number) => {
    const members = plan[batchIndex];
    const spines: SpineToRead[] = members.map((m, j) => ({ id: j + 1, views: chosen[m].read.map((v) => v.reading), wide: chosen[m].wide }));
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (fatal || opts.signal?.aborted) return;
      if (attempt > 0) await sleep(retryDelay(attempt), opts.signal);
      try {
        const res = await provider.readSpineImages!(spines, { ...ctx, batchIndex, totalBatches: plan.length });
        usages.push(res.usage);
        for (const r of res.readings) {
          const member = members[r.id - 1];
          if (member === undefined) continue;
          const list = readings.get(member) ?? [];
          list.push(r);
          readings.set(member, list);
        }
        return;
      } catch (err) {
        lastError = err;
        console.warn('[spines] reading batch failed', {
          videoId: ctx.videoId,
          batch: batchIndex + 1,
          of: plan.length,
          attempt: attempt + 1,
          error: describeError(err, 300),
        });
        if (err instanceof Error && err.name === 'AiConfigError') {
          fatal = new PipelineError('ai_failed', describeError(err, 300), { cause: err, retryable: false });
          return;
        }
        if (isNonRetryable(err)) break;
      }
    }
    if (fatal || opts.signal?.aborted) return;
    failedBatches++;
    console.warn('[spines] reading batch skipped after retries', { videoId: ctx.videoId, batch: batchIndex + 1, error: describeError(lastError, 300) });
  };

  let next = 0;
  const lane = async () => {
    while (!fatal && !opts.signal?.aborted) {
      const i = next++;
      if (i >= plan.length) return;
      await runBatch(i);
      done++;
      await opts.onBatch?.(done, plan.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length) }, () => lane()));
  if (fatal) throw fatal;

  const usage: AiUsage = usages.reduce<AiUsage>(
    (acc, u) => ({
      provider: u.provider,
      model: u.model || acc.model,
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      estCostUsd: acc.estCostUsd + u.estCostUsd,
    }),
    { provider: provider.name, model: provider.model, inputTokens: 0, outputTokens: 0, estCostUsd: 0 },
  );
  return { readings, usage, batches: plan.length, failedBatches, usages };
}

export interface SpineReadOutcome {
  /** the candidates with the views their final readings came from */
  chosen: ChosenCandidate[];
  readings: Map<number, SpineReading[]>;
  /** candidates that turned out to be slices of a neighbour's spine (no readings, no detections) */
  absorbed: Set<number>;
  usages: AiUsage[];
  usage: AiUsage;
  batches: number;
  failedBatches: number;
  secondChance: number;
  /** runs of illegible slices that were read as one spine */
  joinedRuns: number;
  /** pictures of several books that were cut at their gaps and read piece by piece */
  splitSpines: number;
  verification: VerificationStats;
}

/** a joined run of slices may cover at most this share of the frame width */
const MAX_JOINED_WIDTH = 0.8;

/**
 * Runs of ≥ 2 neighbouring candidates of one chain that all came back illegible (indices into `chosen`,
 * left to right). Big letters of a close-up or a stripe on a spine can cut one spine into such slices.
 */
export function illegibleRuns(
  candidates: readonly Pick<SpineCandidate, 'chain' | 'position'>[],
  readings: ReadonlyMap<number, readonly SpineReading[]>,
): number[][] {
  const illegible = (i: number) => {
    const list = readings.get(i);
    return !!list && list.length > 0 && list.every((r) => r.status === 'illegible');
  };
  const order = candidates.map((c, i) => ({ c, i })).sort((x, y) => x.c.chain - y.c.chain || x.c.position - y.c.position);
  const runs: number[][] = [];
  let run: number[] = [];
  let prev: Pick<SpineCandidate, 'chain' | 'position'> | null = null;
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (const { c, i } of order) {
    const adjacent = !!prev && c.chain === prev.chain && c.position === prev.position + 1;
    if (!illegible(i)) flush();
    else if (run.length && adjacent) run.push(i);
    else {
      flush();
      run = [i];
    }
    prev = c;
  }
  flush();
  return runs;
}

/** One candidate spanning a run of slices: the frames that show the whole run. */
export function joinCandidates(
  run: readonly SpineCandidate[],
  frameWidths: readonly number[],
  maxWidthShare = MAX_JOINED_WIDTH,
): SpineCandidate | null {
  const first = run[0];
  const last = run[run.length - 1];
  const views: SpineView[] = [];
  for (const v of first.views) {
    const w = last.views.find((x) => x.frame === v.frame);
    if (!w) continue;
    const width = frameWidths[v.frame];
    if (w.right.xc - v.left.xc > maxWidthShare * width) continue;
    const centre = (v.left.xc + w.right.xc) / 2;
    views.push({ frame: v.frame, band: v.band, left: v.left, right: w.right, centrality: Math.max(0, 1 - Math.abs(centre - width / 2) / (width / 2)) });
  }
  return views.length ? { chain: first.chain, position: first.position, views } : null;
}

export interface VerificationStats {
  checked: number;
  confirmed: number;
  /** kept, but with a confidence low enough to be reviewed */
  disputed: number;
  /** dropped: only a guess, and the independent reading saw no such book */
  dropped: number;
}

/** a single uncertain reading is read once more, independently, below this confidence */
export const VERIFY_BELOW = 0.8;
/** an unconfirmed reading below this confidence was a guess and is dropped */
export const DROP_UNCONFIRMED_BELOW = 0.6;
/** a disputed reading keeps at most this confidence, which puts the book into the review queue */
export const DISPUTED_CONFIDENCE = 0.5;

/** Two readings name the same book (partial titles allowed). */
export function readingsAgree(a: SpineReading, b: SpineReading): boolean {
  const ta = normalizeTitle(titleOf(a));
  const tb = normalizeTitle(titleOf(b));
  if (!ta || !tb || titleNumbersConflict(titleOf(a), titleOf(b))) return false;
  // a partial reading of the same title counts ("The Hundred-Year-Old Man" of a longer title)
  if (titleSimilarityNormalized(ta, tb) < 0.75 && titleContainment(ta, tb) < 0.3) return false;
  return authorsCompatible(a.author ?? a.canonicalAuthor, b.author ?? b.canonicalAuthor);
}

/**
 * Settles an uncertain reading with an independent second reading of the same spine: a confirmation
 * raises the confidence, a contradiction keeps the likelier reading for review, and a guess that the
 * second reading could not see at all is dropped (hallucinated famous titles on blurred spines).
 */
export function settleReading(first: SpineReading, second: readonly SpineReading[] | undefined): { reading: SpineReading | null; outcome: 'confirmed' | 'disputed' | 'dropped' } {
  const other = (second ?? []).filter((r) => r.status === 'book' && (r.title || r.canonicalTitle));
  const agreeing = other.find((r) => readingsAgree(first, r));
  if (agreeing) {
    const best = agreeing.confidence > first.confidence ? agreeing : first;
    return { reading: { ...best, confidence: Math.min(0.95, Math.max(first.confidence, agreeing.confidence) + 0.1) }, outcome: 'confirmed' };
  }
  if (other.length === 0) {
    if (first.confidence < DROP_UNCONFIRMED_BELOW) return { reading: null, outcome: 'dropped' };
    return { reading: { ...first, confidence: Math.min(first.confidence, DISPUTED_CONFIDENCE) }, outcome: 'disputed' };
  }
  const likelier = [first, ...other].sort((a, b) => b.confidence - a.confidence)[0];
  return { reading: { ...likelier, confidence: Math.min(likelier.confidence, DISPUTED_CONFIDENCE) }, outcome: 'disputed' };
}

/**
 * Chooses views, reads every candidate, and reads the spines that stayed illegible once more from other
 * frames (a hand, glare, a torn cover or motion blur often hides a spine only in part of the pan).
 */
export async function readSpineCandidates(
  geometry: VideoGeometry,
  inputs: readonly (string | Buffer)[],
  frameSharpness: readonly (number | null)[],
  provider: VisionProvider,
  ctx: Omit<VisionContext, 'batchIndex' | 'totalBatches'>,
  opts: ReadCandidatesOptions & { onViewsChosen?: () => void | Promise<void> } = {},
): Promise<SpineReadOutcome> {
  const chosen = await chooseViews(geometry, inputs, frameSharpness);
  await opts.onViewsChosen?.();
  const first = await readCandidates(chosen, provider, ctx, opts);
  const readings = first.readings;
  const usages = [...first.usages];
  let batches = first.batches;
  let failedBatches = first.failedBatches;

  const retry = chosen.filter((c, i) => c.candidate.views.length > c.read.length && needsSecondChance(readings.get(i)));
  let secondChance = 0;
  if (retry.length && !opts.signal?.aborted) {
    const exclude = new Map(retry.map((c) => [c.candidate, new Set(c.read.map((v) => v.view.frame))]));
    const again = await chooseViews(geometry, inputs, frameSharpness, { candidates: retry.map((c) => c.candidate), exclude });
    const second = await readCandidates(again, provider, ctx, { ...opts, onBatch: undefined });
    usages.push(...second.usages);
    batches += second.batches;
    failedBatches += second.failedBatches;
    again.forEach((a, j) => {
      const i = chosen.findIndex((c) => c.candidate === a.candidate);
      if (i < 0) return;
      const before = readings.get(i);
      const better = betterReadings(before, second.readings.get(j));
      if (better.length && (!before || better[0] !== before[0])) {
        readings.set(i, better);
        chosen[i] = a;
        secondChance++;
      }
    });
  }

  // several books in one picture: cut it at the gaps and read the pieces one by one, left to right
  let splitSpines = 0;
  const multi = chosen.map((c, i) => ({ c, i, books: bookReadings(readings.get(i)) })).filter((x) => x.books.length >= 2);
  if (multi.length && !opts.signal?.aborted) {
    const pieces: { owner: number; span: [number, number]; chosen: ChosenCandidate }[] = [];
    for (const x of multi) {
      const best = x.c.read[0];
      const cuts = await splitPositions(best.upright, x.books.length);
      if (cuts.length !== x.books.length - 1) continue;
      const meta = await sharp(best.upright).metadata();
      const width = meta.width ?? 1;
      const height = meta.height ?? 1;
      const bounds = [0, ...cuts, 1];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const left = Math.round(bounds[k] * width);
        const pieceWidth = Math.max(1, Math.round(bounds[k + 1] * width) - left);
        const upright = await sharp(best.upright).extract({ left, top: 0, width: Math.min(pieceWidth, width - left), height }).jpeg({ quality: 90 }).toBuffer();
        pieces.push({
          owner: x.i,
          span: [bounds[k], bounds[k + 1]],
          chosen: { candidate: x.c.candidate, read: [{ ...best, upright, reading: await readingImage(upright) }], wide: false },
        });
      }
    }
    if (pieces.length) {
      const pieceRead = await readCandidates(
        pieces.map((piece) => piece.chosen),
        provider,
        ctx,
        { ...opts, onBatch: undefined },
      );
      usages.push(...pieceRead.usages);
      batches += pieceRead.batches;
      failedBatches += pieceRead.failedBatches;
      for (const owner of new Set(pieces.map((piece) => piece.owner))) {
        const found = pieces
          .map((piece, k) => ({ piece, book: bookReadings(pieceRead.readings.get(k))[0] }))
          .filter((x) => x.piece.owner === owner && x.book);
        if (found.length === 0) continue;
        readings.set(owner, found.map((x, k) => ({ ...x.book!, part: k + 1 })));
        chosen[owner] = { ...chosen[owner], spans: found.map((x) => x.piece.span) };
        splitSpines++;
      }
    }
  }

  // slices that all stayed illegible: read each run once more as one spine
  const absorbed = new Set<number>();
  let joinedRuns = 0;
  const runs = illegibleRuns(
    chosen.map((c) => c.candidate),
    readings,
  );
  if (runs.length && !opts.signal?.aborted) {
    const widths = geometry.frames.map((f) => f.width);
    const joined = runs
      .map((run) => ({ run, candidate: joinCandidates(run.map((i) => chosen[i].candidate), widths) }))
      .filter((x): x is { run: number[]; candidate: SpineCandidate } => x.candidate !== null);
    if (joined.length) {
      const joinedChosen = await chooseViews(geometry, inputs, frameSharpness, { candidates: joined.map((x) => x.candidate), labelWide: false });
      const read = await readCandidates(joinedChosen, provider, ctx, { ...opts, onBatch: undefined });
      usages.push(...read.usages);
      batches += read.batches;
      failedBatches += read.failedBatches;
      joinedChosen.forEach((jc, j) => {
        const entry = joined.find((x) => x.candidate === jc.candidate);
        const list = read.readings.get(j);
        if (!entry || bookReadings(list).length === 0) return;
        const [head, ...rest] = entry.run;
        chosen[head] = jc;
        readings.set(head, list!);
        for (const i of rest) {
          absorbed.add(i);
          readings.delete(i);
        }
        joinedRuns++;
      });
    }
  }

  // independent second reading of uncertain single books
  const verification: VerificationStats = { checked: 0, confirmed: 0, disputed: 0, dropped: 0 };
  const uncertain = chosen
    .map((c, i) => ({ c, i, books: bookReadings(readings.get(i)) }))
    .filter((x) => x.books.length === 1 && x.books[0].confidence < VERIFY_BELOW);
  if (uncertain.length && !opts.signal?.aborted) {
    const exclude = new Map(uncertain.map((x) => [x.c.candidate, new Set(x.c.read.map((v) => v.view.frame))]));
    const fresh = await chooseViews(geometry, inputs, frameSharpness, { candidates: uncertain.map((x) => x.c.candidate), exclude });
    // spines without other frames are shown again with their views in the other order
    const verifyChosen = uncertain.map((x) => fresh.find((f) => f.candidate === x.c.candidate) ?? { ...x.c, read: [...x.c.read].reverse() });
    const check = await readCandidates(verifyChosen, provider, ctx, { ...opts, onBatch: undefined });
    usages.push(...check.usages);
    batches += check.batches;
    failedBatches += check.failedBatches;
    uncertain.forEach((x, j) => {
      if (check.readings.get(j) === undefined && check.failedBatches > 0) return; // not checked: keep as it is
      verification.checked++;
      const { reading, outcome } = settleReading(x.books[0], check.readings.get(j));
      verification[outcome]++;
      readings.set(x.i, reading ? [reading] : [{ ...x.books[0], status: 'illegible', title: '', canonicalTitle: null, canonicalAuthor: null }]);
    });
  }
  const usage: AiUsage = usages.reduce<AiUsage>(
    (acc, u) => ({
      provider: u.provider,
      model: u.model || acc.model,
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      estCostUsd: acc.estCostUsd + u.estCostUsd,
    }),
    { provider: provider.name, model: provider.model, inputTokens: 0, outputTokens: 0, estCostUsd: 0 },
  );
  return { chosen, readings, absorbed, usages, usage, batches, failedBatches, secondChance, joinedRuns, splitSpines, verification };
}

/** Readings that describe a book with a usable title, in part order. */
function bookReadings(list: readonly SpineReading[] | undefined): SpineReading[] {
  return (list ?? []).filter((r) => r.status === 'book' && (r.title || r.canonicalTitle)).sort((a, b) => a.part - b.part);
}

function titleOf(r: SpineReading): string {
  return r.title || r.canonicalTitle || '';
}

/** Two readings of neighbouring candidates that are one book cut in two by a false boundary. */
export function sameBookReading(a: SpineReading, b: SpineReading): boolean {
  const ta = normalizeTitle(titleOf(a));
  const tb = normalizeTitle(titleOf(b));
  if (!ta || !tb || titleNumbersConflict(titleOf(a), titleOf(b))) return false;
  if (titleSimilarityNormalized(ta, tb) < 0.85 && titleContainment(ta, tb) < 0.5) return false;
  return authorsCompatible(a.author ?? a.canonicalAuthor, b.author ?? b.canonicalAuthor);
}

/**
 * Indices of candidates whose single reading repeats the reading of the neighbouring candidate on the
 * same shelf chain (the weaker one of each pair is dropped).
 */
export function duplicateNeighbours(candidates: readonly SpineCandidate[], readings: ReadonlyMap<number, SpineReading[]>): Set<number> {
  const drop = new Set<number>();
  const order = candidates.map((c, i) => ({ c, i })).sort((x, y) => x.c.chain - y.c.chain || x.c.position - y.c.position);
  for (let k = 0; k + 1 < order.length; k++) {
    const x = order[k];
    const y = order[k + 1];
    if (x.c.chain !== y.c.chain || y.c.position !== x.c.position + 1 || drop.has(x.i)) continue;
    const rx = bookReadings(readings.get(x.i));
    const ry = bookReadings(readings.get(y.i));
    if (rx.length !== 1 || ry.length !== 1 || !sameBookReading(rx[0], ry[0])) continue;
    drop.add(rx[0].confidence >= ry[0].confidence ? y.i : x.i);
  }
  return drop;
}

export interface RecognizeSpinesContext {
  sourceSha1: string | null;
  locale: Locale;
  signal?: AbortSignal;
  /** videos.progress range covered by this step (default 20..85) */
  progressFrom?: number;
  progressTo?: number;
  /** injectable for tests (default getVisionProvider()) */
  provider?: VisionProvider;
}

export interface RecognizeSpinesResult {
  candidates: number;
  books: number;
  illegible: number;
  notBooks: number;
  unread: number;
  batches: number;
  failedBatches: number;
  detections: number;
  framesAnalyzed: number;
  /** canonical_author / canonical_title per detection id, for the merge */
  hints: Map<string, CanonicalHint>;
}

type NewDetection = typeof detections.$inferInsert;

function isForeignKeyViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if ((cur as { code?: string }).code === '23503') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export async function recognizeSpines(video: VideoRow, frameRows: FrameRow[], ctx: RecognizeSpinesContext): Promise<RecognizeSpinesResult | null> {
  const provider = ctx.provider ?? getVisionProvider();
  if (!provider.readSpineImages) return null;
  const ordered = [...frameRows].sort((a, b) => a.idx - b.idx);
  if (ordered.length === 0) return null;
  const from = ctx.progressFrom ?? 20;
  const to = ctx.progressTo ?? 85;
  const geometryEnd = from + (to - from) * 0.25;
  const cutEnd = from + (to - from) * 0.35;

  let lastWrite = 0;
  const setProgress = async (value: number, framesAnalyzed?: number) => {
    const now = Date.now();
    if (now - lastWrite < 700 && framesAnalyzed === undefined) return;
    lastWrite = now;
    const res = await db()
      .update(videos)
      .set({ progress: Math.round(value), ...(framesAnalyzed !== undefined ? { framesAnalyzed } : {}) })
      .where(eq(videos.id, video.id))
      .returning({ id: videos.id });
    if (res.length === 0) throw new VideoGoneError(video.id);
  };

  const inputs = ordered.map((f) => abs(f.storagePath));
  const started = Date.now();
  const geometry = await analyzeVideoGeometry(inputs, {
    signal: ctx.signal,
    onProgress: (f) => setProgress(from + (geometryEnd - from) * f),
  });
  if (geometry.candidates.length === 0) {
    console.info('[spines] no spine candidates – falling back to whole frames', { videoId: video.id, frames: ordered.length });
    return null;
  }

  const geometryMs = Date.now() - started;
  const read = await readSpineCandidates(
    geometry,
    inputs,
    ordered.map((f) => f.sharpness),
    provider,
    {
      collectionId: video.collectionId,
      videoId: video.id,
      originalFilename: video.originalFilename,
      sourceSha1: ctx.sourceSha1,
      locale: ctx.locale,
    },
    {
      signal: ctx.signal,
      onViewsChosen: () => setProgress(cutEnd),
      onBatch: (done, total) => setProgress(cutEnd + ((to - cutEnd) * done) / total),
    },
  );
  const chosen = read.chosen;
  for (const u of read.usages) {
    try {
      await recordUsage(video.collectionId, u);
    } catch (err) {
      console.warn('[spines] recordUsage failed', { collectionId: video.collectionId, error: describeError(err, 200) });
    }
  }
  if (ctx.signal?.aborted) throw Object.assign(new Error('spine recognition aborted'), { name: 'AbortError' });
  if (read.batches > 0 && (read.batches - read.failedBatches) * 2 < read.batches) {
    throw new PipelineError('ai_failed', `only ${read.batches - read.failedBatches}/${read.batches} spine reading batches succeeded`);
  }

  const dropped = duplicateNeighbours(
    chosen.map((c) => c.candidate),
    read.readings,
  );

  const drafts: { frame: number; x: number; row: NewDetection; hint: CanonicalHint }[] = [];
  let books = 0;
  let illegible = 0;
  let notBooks = 0;
  let unread = 0;
  chosen.forEach((c, i) => {
    if (read.absorbed.has(i)) return;
    const all = read.readings.get(i);
    if (!all || all.length === 0) {
      unread++;
      return;
    }
    const list = bookReadings(all);
    if (list.length === 0) {
      if (all.some((r) => r.status === 'not_book')) notBooks++;
      else illegible++;
      return;
    }
    if (dropped.has(i)) return;
    books += list.length;
    const readFrames = new Set(c.read.map((v) => v.view.frame));
    for (const view of c.candidate.views) {
      const frame = geometry.frames[view.frame];
      list.forEach((reading, j) => {
        const rect = spineRect(view, frame.height, c.spans?.[j] ?? [j / list.length, (j + 1) / list.length]);
        const confidence = readFrames.has(view.frame) ? reading.confidence : Math.round(reading.confidence * UNREAD_VIEW_CONFIDENCE * 1000) / 1000;
        drafts.push({
          frame: view.frame,
          x: rect.cx,
          row: {
            collectionId: video.collectionId,
            videoId: video.id,
            frameId: ordered[view.frame].id,
            rawAuthor: reading.author,
            rawTitle: titleOf(reading).slice(0, 500),
            publisher: reading.publisher,
            confidence,
            bbox: rectBoundingBox(rect, frame.width, frame.height),
            orderInFrame: 0,
            provider: read.usage.provider.slice(0, 16),
            model: read.usage.model || provider.model || 'unknown',
          },
          hint: { canonicalAuthor: reading.canonicalAuthor, canonicalTitle: reading.canonicalTitle },
        });
      });
    }
  });

  // left→right order inside every frame
  const byFrame = new Map<number, typeof drafts>();
  for (const d of drafts) {
    const list = byFrame.get(d.frame) ?? [];
    list.push(d);
    byFrame.set(d.frame, list);
  }
  for (const list of byFrame.values()) {
    list.sort((a, b) => a.x - b.x);
    list.forEach((d, k) => {
      d.row.orderInFrame = k + 1;
    });
  }

  const hints = new Map<string, CanonicalHint>();
  try {
    await db().transaction(async (tx) => {
      for (let start = 0; start < drafts.length; start += 500) {
        const part = drafts.slice(start, start + 500);
        const rows = await tx.insert(detections).values(part.map((d) => d.row)).returning({ id: detections.id });
        rows.forEach((row, k) => {
          const h = part[k].hint;
          if (h.canonicalAuthor || h.canonicalTitle) hints.set(row.id, h);
        });
      }
      await tx
        .update(framesTable)
        .set({ analyzed: true })
        .where(inArray(framesTable.id, ordered.map((f) => f.id)));
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new VideoGoneError(video.id);
    throw err;
  }
  await setProgress(to, ordered.length);

  const result: RecognizeSpinesResult = {
    candidates: chosen.length,
    books,
    illegible,
    notBooks,
    unread,
    batches: read.batches,
    failedBatches: read.failedBatches,
    detections: drafts.length,
    framesAnalyzed: ordered.length,
    hints,
  };
  console.info('[spines] spines read', {
    videoId: video.id,
    frames: ordered.length,
    candidates: result.candidates,
    books,
    illegible,
    notBooks,
    unread,
    droppedDuplicates: dropped.size,
    secondChance: read.secondChance,
    joinedRuns: read.joinedRuns,
    splitSpines: read.splitSpines,
    verification: read.verification,
    batches: read.batches,
    failedBatches: read.failedBatches,
    detections: drafts.length,
    geometryMs,
    ms: Date.now() - started,
    inputTokens: read.usage.inputTokens,
    outputTokens: read.usage.outputTokens,
  });
  return result;
}

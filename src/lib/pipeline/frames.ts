/**
 * Key-frame selection (SPEC §4.2). Pure filesystem function – no DB access – so scripts
 * (eval-recognition, tuning) can call it directly.
 *
 *  1. ffmpeg decodes the clip at `sampleFps` (auto-rotated, long edge ≤ maxEdge) and streams MJPEG
 *     candidates through a pipe (bounded memory, no giant temp folder for long clips).
 *  2. every candidate gets a Laplacian-variance sharpness score + a tiny greyscale signature.
 *  3. candidates are grouped into windows of W = max(1, round(sampleFps × KEYFRAME_WINDOW_SEC)); the
 *     sharpest of each window is written to a temp dir (motion-blurred frames are discarded).
 *  4. redundancy filter: drop a frame whose signature barely differs from the previously kept frame
 *     (camera not moving) – but never leave a gap longer than maxGapSec (0.75 s, ≤ SPEC's 2 s).
 *  5. more than maxFrames left → uniform sampling (first and last kept).
 *  Outputs `<idx 4-digit>.jpg` + `<idx>_t.jpg` (thumbnail) into outDir; the temp dir is always removed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { env } from '@/lib/env';
import { PipelineError } from '@/lib/jobs/errors';
import { probeMedia, type MediaProbe } from './probe';
import { analyzeFrame, meanAbsDiff, type GreySignature } from './sharpness';

export interface SelectKeyFramesOptions {
  /** candidate sampling rate (default env FRAME_SAMPLE_FPS = 8) */
  sampleFps?: number;
  /** window length in seconds; the sharpest candidate per window is kept (default env KEYFRAME_WINDOW_SEC = 0.33) */
  windowSec?: number;
  /** cap of kept frames (default env MAX_FRAMES_PER_VIDEO = 120) */
  maxFrames?: number;
  /** long edge of the analysed frames (default env FRAME_MAX_EDGE = 1920) */
  maxEdge?: number;
  /** long edge of thumbnails (default 480) */
  thumbEdge?: number;
  /** mean-absolute-difference (0..255) below which a frame counts as "camera did not move" */
  redundancyThreshold?: number;
  /** longest allowed gap between kept frames in seconds (default 0.75; SPEC upper bound 2) */
  maxGapSec?: number;
  /** re-use an existing probe result */
  probe?: MediaProbe;
  /** 0..1 progress callback (candidate extraction dominates the run time) */
  onProgress?: (fraction: number) => void | Promise<void>;
  /** kills ffmpeg and rejects with an AbortError */
  signal?: AbortSignal;
  /** abort when ffmpeg produces no output for this long (default 180 s) */
  stallTimeoutMs?: number;
  /** collect per-candidate diagnostics (tuning scripts) */
  collectDiagnostics?: boolean;
  /** parent directory of the temporary candidate dir (default os.tmpdir()); created when missing */
  tempRoot?: string;
}

export interface KeyFrame {
  idx: number;
  timeSec: number;
  path: string;
  thumbPath: string;
  width: number;
  height: number;
  sharpness: number;
}

export interface CandidateDiagnostics {
  n: number;
  timeSec: number;
  sharpness: number;
  window: number;
  windowBest: boolean;
  /** MAD to the previously kept frame (only for window bests) */
  diffToPrevKept: number | null;
  kept: boolean;
}

export interface SelectKeyFramesResult {
  durationSec: number;
  width: number;
  height: number;
  frames: KeyFrame[];
  stats: { candidates: number; windowBest: number; afterRedundancy: number; kept: number };
  diagnostics?: CandidateDiagnostics[];
}

export const DEFAULT_THUMB_EDGE = 480;
/**
 * Tuned on the 5 sample clips against fixtures/sample-shelf/ground-truth.json (8 fps, 0.33 s windows).
 * 9×16 signature MAD between consecutive window bests: holding still / hand shake 0.5–4.7, slow dark
 * pans 4.2–5.9, normal pans 8–62. Coverage metric = kept frames within ±0.6 s of each book's best
 * 2 fps frame:
 *   no filter            158/158 books in ≥ 2 key frames, 120 frames
 *   thr 5, gap 2 s       136/158 (86 %), 109 frames – drops still starts/ends and slow dark pans
 *   thr 3, gap 0.75 s    158/158 (100 %), 117 frames  ← defaults
 * A completely static stretch still shrinks to one frame per 0.75 s (≈ ½ of the window bests).
 */
export const DEFAULT_REDUNDANCY_THRESHOLD = 3;
/**
 * Longest gap between kept frames. SPEC §4.2.4 requires a frame at least every 2 s; 0.75 s keeps every
 * spine of a still (or very slowly drifting) camera in ≥ 2 key frames.
 */
export const DEFAULT_MAX_GAP_SEC = 0.75;
/** name prefix of the per-run candidate temp dir (cleanup purges leftovers of killed workers) */
export const FRAME_TEMP_PREFIX = 'exlibris-frames-';
const FRAME_JPEG_QUALITY = 90;
const THUMB_JPEG_QUALITY = 78;
const ANALYZE_CONCURRENCY = 3;

/* ------------------------------------------------------------------ */
/* Pure selection logic (unit tested)                                  */
/* ------------------------------------------------------------------ */

/** W = max(1, round(sampleFps × windowSec)) consecutive candidates per window (SPEC §4.2.3). */
export function windowSize(sampleFps: number, windowSec: number): number {
  const w = Math.round(sampleFps * windowSec);
  return Number.isFinite(w) ? Math.max(1, w) : 1;
}

export interface ScoredCandidate {
  /** 0-based candidate number (decode order) */
  n: number;
  timeSec: number;
  sharpness: number;
}

/** Keeps the sharpest candidate of each window of W consecutive candidates (ties → earliest). */
export function pickWindowBest<T extends ScoredCandidate>(candidates: T[], w: number): T[] {
  const size = Math.max(1, Math.floor(w));
  const out: T[] = [];
  for (let i = 0; i < candidates.length; i += size) {
    let best = candidates[i];
    for (let j = i + 1; j < Math.min(i + size, candidates.length); j++) {
      if (candidates[j].sharpness > best.sharpness) best = candidates[j];
    }
    out.push(best);
  }
  return out;
}

export interface SignedCandidate {
  timeSec: number;
  signature: GreySignature;
}

/**
 * Redundancy filter. The first and the last frame are always kept (the ends of a pan show books that
 * no other frame shows; a 9-column signature under-reports the slow final drift). A frame in between is
 * kept when it differs enough from the previously KEPT frame (so slow drifts accumulate), or when skipping
 * it would leave a gap longer than `maxGapSec` before the next available frame.
 */
export function filterRedundant<T extends SignedCandidate>(
  frames: T[],
  threshold: number,
  maxGapSec: number = DEFAULT_MAX_GAP_SEC,
  onDecision?: (frame: T, diff: number | null, kept: boolean) => void,
): T[] {
  if (frames.length === 0) return [];
  const kept: T[] = [frames[0]];
  onDecision?.(frames[0], null, true);
  for (let i = 1; i < frames.length; i++) {
    const cur = frames[i];
    const last = kept[kept.length - 1];
    const diff = meanAbsDiff(cur.signature, last.signature);
    const next = frames[i + 1];
    const isLast = next === undefined;
    const gapForcesKeep = !isLast && next.timeSec - last.timeSec > maxGapSec + 1e-6;
    const isKept = isLast || diff >= threshold || gapForcesKeep;
    if (isKept) kept.push(cur);
    onDecision?.(cur, diff, isKept);
  }
  return kept;
}

/** Uniformly samples `max` items, always keeping the first and the last. */
export function sampleUniform<T>(items: T[], max: number): T[] {
  const limit = Math.floor(max);
  if (limit <= 0) return [];
  if (items.length <= limit) return items.slice();
  if (limit === 1) return [items[0]];
  const out: T[] = [];
  let prev = -1;
  for (let i = 0; i < limit; i++) {
    let idx = Math.round((i * (items.length - 1)) / (limit - 1));
    if (idx <= prev) idx = prev + 1;
    out.push(items[idx]);
    prev = idx;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* MJPEG pipe splitter (unit tested)                                   */
/* ------------------------------------------------------------------ */

/**
 * Splits a concatenated JPEG byte stream (ffmpeg `-f image2pipe -c:v mjpeg`) into images by walking
 * the marker segments (lengths) and the entropy-coded scans (0xFF is byte-stuffed there), so bytes that
 * merely look like an EOI inside a table cannot cut an image short.
 */
export class JpegStreamSplitter {
  private buf: Buffer = Buffer.alloc(0);
  private pos = 0;
  private started = false;
  private inScan = false;

  constructor(private readonly maxImageBytes = 64 * 1024 * 1024) {}

  /** bytes buffered for an incomplete image */
  get pending(): number {
    return this.buf.length;
  }

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const images: Buffer[] = [];
    for (;;) {
      if (!this.started) {
        const soi = findSoi(this.buf);
        if (soi < 0) {
          // keep a trailing 0xFF – it may be the first half of the next SOI
          this.buf = this.buf.length > 0 && this.buf[this.buf.length - 1] === 0xff ? this.buf.subarray(this.buf.length - 1) : Buffer.alloc(0);
          return images;
        }
        this.buf = this.buf.subarray(soi);
        this.pos = 2;
        this.inScan = false;
        this.started = true;
      }
      const end = this.parse();
      if (end < 0) {
        if (this.buf.length > this.maxImageBytes) {
          throw new Error(`JPEG frame exceeds ${this.maxImageBytes} bytes – corrupt stream`);
        }
        return images;
      }
      images.push(Buffer.from(this.buf.subarray(0, end)));
      this.buf = this.buf.subarray(end);
      this.started = false;
      this.pos = 0;
    }
  }

  /** returns the byte offset just after EOI, or -1 when more data is needed */
  private parse(): number {
    const b = this.buf;
    let p = this.pos;
    for (;;) {
      if (this.inScan) {
        let found = false;
        while (p + 1 < b.length) {
          if (b[p] !== 0xff) {
            p++;
            continue;
          }
          const m = b[p + 1];
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) {
            p += 2;
            continue;
          }
          if (m === 0xff) {
            p += 1;
            continue;
          }
          found = true;
          break;
        }
        if (!found) {
          this.pos = p;
          return -1;
        }
        this.inScan = false;
      }
      if (p + 1 >= b.length) {
        this.pos = p;
        return -1;
      }
      if (b[p] !== 0xff) {
        p++; // corrupt padding – resynchronise on the next marker
        continue;
      }
      const m = b[p + 1];
      if (m === 0xff) {
        p++;
        continue;
      }
      if (m === 0xd9) return p + 2;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        p += 2;
        continue;
      }
      if (p + 3 >= b.length) {
        this.pos = p;
        return -1;
      }
      const len = b.readUInt16BE(p + 2);
      if (len < 2) {
        p += 2;
        continue;
      }
      if (p + 2 + len > b.length) {
        this.pos = p;
        return -1;
      }
      p += 2 + len;
      if (m === 0xda) this.inScan = true;
    }
  }
}

function findSoi(b: Buffer): number {
  for (let i = 0; i + 1 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xd8) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/* ffmpeg                                                              */
/* ------------------------------------------------------------------ */

/** Scale expression: long edge ≤ maxEdge, even dimensions, aspect preserved (input is auto-rotated). */
export function scaleFilter(maxEdge: number): string {
  const m = Math.max(16, Math.floor(maxEdge));
  return (
    `scale=w='if(gte(iw,ih),2*trunc(min(${m},iw)/2),-2)'` +
    `:h='if(gte(iw,ih),-2,2*trunc(min(${m},ih)/2))':flags=lanczos`
  );
}

export function buildCandidateArgs(
  inputPath: string,
  opts: { sampleFps: number; maxEdge: number; sampleAspectRatio?: number; firstFrameOnly?: boolean },
): string[] {
  const filters: string[] = [];
  if (!opts.firstFrameOnly) filters.push(`fps=${opts.sampleFps}`);
  const sar = opts.sampleAspectRatio ?? 1;
  if (Number.isFinite(sar) && sar > 0 && Math.abs(sar - 1) > 0.01) {
    filters.push(`scale=w='2*trunc(iw*sar/2)':h=ih`, 'setsar=1');
  }
  filters.push(scaleFilter(opts.maxEdge));
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-i',
    inputPath,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    ...(opts.firstFrameOnly ? ['-frames:v', '1'] : []),
    '-vf',
    filters.join(','),
    '-pix_fmt',
    'yuvj420p',
    '-c:v',
    'mjpeg',
    '-q:v',
    '2',
    '-f',
    'image2pipe',
    'pipe:1',
  ];
}

function abortError(): Error {
  const e = new Error('key-frame extraction aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Runs ffmpeg and hands every decoded JPEG (in order) to `onImage`, awaiting it before reading more
 * (back-pressure keeps memory flat). Resolves with the exit status.
 */
async function streamCandidates(
  args: string[],
  onImage: (jpeg: Buffer) => Promise<void>,
  opts: { signal?: AbortSignal; stallTimeoutMs: number },
): Promise<{ code: number | null; stderr: string }> {
  const bin = env().FFMPEG_PATH;
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    if (stderr.length < 16_000) stderr += d.toString('utf8');
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  exited.catch(() => {}); // observed below

  let stalled = false;
  let aborted = false;
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  let stallTimer: NodeJS.Timeout | undefined;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      kill();
    }, opts.stallTimeoutMs);
  };
  const onAbort = () => {
    aborted = true;
    kill();
  };
  if (opts.signal?.aborted) onAbort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const splitter = new JpegStreamSplitter();
  try {
    armStall();
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        armStall();
        for (const jpeg of splitter.push(chunk)) {
          if (aborted) break;
          await onImage(jpeg);
          armStall();
        }
        if (aborted) break;
      }
    } catch (e) {
      kill();
      if (aborted) throw abortError();
      throw e;
    }
    if (aborted) {
      kill();
      throw abortError();
    }
    let status: { code: number | null; signal: NodeJS.Signals | null };
    try {
      status = await exited;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new PipelineError('internal', code === 'ENOENT' ? `ffmpeg binary not found (${bin})` : 'ffmpeg could not be started', {
        cause: e,
      });
    }
    if (aborted) throw abortError();
    if (stalled) throw new PipelineError('unreadable', `ffmpeg produced no output for ${Math.round(opts.stallTimeoutMs / 1000)} s`);
    return { code: status.code, stderr: stderr.trim() };
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    opts.signal?.removeEventListener('abort', onAbort);
    kill();
  }
}

/* ------------------------------------------------------------------ */
/* selectKeyFrames                                                     */
/* ------------------------------------------------------------------ */

interface WindowBest {
  n: number;
  timeSec: number;
  sharpness: number;
  signature: GreySignature;
  tmpPath: string;
}

function positiveInt(v: number | undefined, def: number): number {
  return v !== undefined && Number.isFinite(v) && v >= 1 ? Math.floor(v) : def;
}

async function clearOldFrameFiles(outDir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(outDir);
  } catch {
    return;
  }
  await Promise.all(
    names.filter((n) => /^\d{4,}(_t)?\.jpg$/.test(n)).map((n) => fs.rm(path.join(outDir, n), { force: true })),
  );
}

async function writeThumb(input: Buffer | string, thumbPath: string, thumbEdge: number): Promise<void> {
  await sharp(input)
    .resize({ width: thumbEdge, height: thumbEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
    .toFile(thumbPath);
}

async function selectFromImage(
  inputPath: string,
  outDir: string,
  o: { maxEdge: number; thumbEdge: number },
): Promise<SelectKeyFramesResult> {
  let jpeg: Buffer;
  let info: OutputInfo;
  try {
    const res = await sharp(inputPath, { failOn: 'error' })
      .rotate()
      .resize({ width: o.maxEdge, height: o.maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: FRAME_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    jpeg = res.data;
    info = res.info;
  } catch (e) {
    throw new PipelineError('unreadable', 'image could not be decoded', { cause: e });
  }
  const { sharpness } = await analyzeFrame(jpeg);
  const framePath = path.join(outDir, `${String(0).padStart(4, '0')}.jpg`);
  const thumbPath = path.join(outDir, `${String(0).padStart(4, '0')}_t.jpg`);
  await fs.writeFile(framePath, jpeg);
  await writeThumb(jpeg, thumbPath, o.thumbEdge);
  return {
    durationSec: 0,
    width: info.width,
    height: info.height,
    frames: [{ idx: 0, timeSec: 0, path: framePath, thumbPath, width: info.width, height: info.height, sharpness }],
    stats: { candidates: 1, windowBest: 1, afterRedundancy: 1, kept: 1 },
  };
}

export async function selectKeyFrames(
  inputPath: string,
  outDir: string,
  opts: SelectKeyFramesOptions = {},
): Promise<SelectKeyFramesResult> {
  const e = env();
  const sampleFps = opts.sampleFps !== undefined && opts.sampleFps > 0 ? opts.sampleFps : e.FRAME_SAMPLE_FPS > 0 ? e.FRAME_SAMPLE_FPS : 8;
  const windowSec =
    opts.windowSec !== undefined && opts.windowSec > 0 ? opts.windowSec : e.KEYFRAME_WINDOW_SEC > 0 ? e.KEYFRAME_WINDOW_SEC : 0.33;
  const maxFrames = positiveInt(opts.maxFrames, positiveInt(e.MAX_FRAMES_PER_VIDEO, 120));
  const maxEdge = positiveInt(opts.maxEdge, positiveInt(e.FRAME_MAX_EDGE, 1920));
  const thumbEdge = positiveInt(opts.thumbEdge, DEFAULT_THUMB_EDGE);
  const threshold = opts.redundancyThreshold ?? DEFAULT_REDUNDANCY_THRESHOLD;
  const maxGapSec = opts.maxGapSec ?? DEFAULT_MAX_GAP_SEC;
  const stallTimeoutMs = opts.stallTimeoutMs ?? 180_000;

  const probe = opts.probe ?? (await probeMedia(inputPath, { signal: opts.signal }));
  await fs.mkdir(outDir, { recursive: true });
  await clearOldFrameFiles(outDir);

  if (probe.kind === 'image') {
    const res = await selectFromImage(inputPath, outDir, { maxEdge, thumbEdge });
    await opts.onProgress?.(1);
    return res;
  }

  const tempRoot = opts.tempRoot ?? os.tmpdir();
  await fs.mkdir(tempRoot, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(tempRoot, FRAME_TEMP_PREFIX));
  try {
    const w = windowSize(sampleFps, windowSec);
    const diagnostics: CandidateDiagnostics[] | undefined = opts.collectDiagnostics ? [] : undefined;
    const windowBests: WindowBest[] = [];
    const expectedCandidates = probe.durationSec ? Math.max(1, probe.durationSec * sampleFps) : null;
    let candidates = 0;
    let lastProgressAt = 0;

    // window currently being filled
    let windowIdx = -1;
    let windowBest: { n: number; timeSec: number; sharpness: number; signature: GreySignature; jpeg: Buffer } | null = null;

    const flushWindow = async () => {
      if (!windowBest) return;
      const tmpPath = path.join(tmpDir, `${String(windowBest.n).padStart(6, '0')}.jpg`);
      await fs.writeFile(tmpPath, windowBest.jpeg);
      windowBests.push({
        n: windowBest.n,
        timeSec: windowBest.timeSec,
        sharpness: windowBest.sharpness,
        signature: windowBest.signature,
        tmpPath,
      });
      windowBest = null;
    };

    const consume = async (n: number, jpeg: Buffer, quality: { sharpness: number; signature: GreySignature }) => {
      const timeSec = n / sampleFps;
      const win = Math.floor(n / w);
      if (win !== windowIdx) {
        await flushWindow();
        windowIdx = win;
      }
      diagnostics?.push({ n, timeSec, sharpness: quality.sharpness, window: win, windowBest: false, diffToPrevKept: null, kept: false });
      if (!windowBest || quality.sharpness > windowBest.sharpness) {
        windowBest = { n, timeSec, sharpness: quality.sharpness, signature: quality.signature, jpeg };
      }
      if (opts.onProgress && expectedCandidates) {
        const now = Date.now();
        if (now - lastProgressAt > 750) {
          lastProgressAt = now;
          await opts.onProgress(Math.min(0.95, (n + 1) / expectedCandidates));
        }
      }
    };

    // analyse up to ANALYZE_CONCURRENCY candidates in parallel, consume strictly in order
    const inflight: { n: number; jpeg: Buffer; result: Promise<{ sharpness: number; signature: GreySignature }> }[] = [];
    const drainOne = async () => {
      const item = inflight.shift();
      if (!item) return;
      let quality: { sharpness: number; signature: GreySignature };
      try {
        quality = await item.result;
      } catch (err) {
        console.warn('[pipeline] frames: undecodable candidate skipped', { n: item.n, error: (err as Error).message });
        return;
      }
      await consume(item.n, item.jpeg, quality);
    };

    const runExtraction = async (firstFrameOnly: boolean) => {
      const args = buildCandidateArgs(inputPath, {
        sampleFps,
        maxEdge,
        sampleAspectRatio: probe.sampleAspectRatio,
        firstFrameOnly,
      });
      return streamCandidates(
        args,
        async (jpeg) => {
          const n = candidates++;
          const result = analyzeFrame(jpeg);
          result.catch(() => {}); // handled in drainOne
          inflight.push({ n, jpeg, result });
          if (inflight.length >= ANALYZE_CONCURRENCY) await drainOne();
        },
        { signal: opts.signal, stallTimeoutMs },
      );
    };

    let status = await runExtraction(false);
    while (inflight.length > 0) await drainOne();
    await flushWindow();

    if (windowBests.length === 0) {
      // Very short / single-frame clips can yield nothing through the fps filter: grab the first frame.
      candidates = 0;
      windowIdx = -1;
      const fallback = await runExtraction(true);
      while (inflight.length > 0) await drainOne();
      await flushWindow();
      if (windowBests.length === 0) {
        const detail = (fallback.stderr || status.stderr).slice(0, 300);
        if ((fallback.code ?? 1) !== 0 || (status.code ?? 1) !== 0) {
          throw new PipelineError('unreadable', `ffmpeg could not decode the video: ${detail}`);
        }
        throw new PipelineError('no_frames', 'no frames could be extracted');
      }
      status = fallback;
    } else if (status.code !== 0) {
      console.warn('[pipeline] frames: ffmpeg exited with errors, using the frames decoded so far', {
        code: status.code,
        candidates,
        stderr: status.stderr.slice(0, 300),
      });
    }

    const diagByN = diagnostics ? new Map(diagnostics.map((d) => [d.n, d])) : undefined;
    for (const wb of windowBests) {
      const d = diagByN?.get(wb.n);
      if (d) d.windowBest = true;
    }
    const afterRedundancy = filterRedundant(windowBests, threshold, maxGapSec, (frame, diff) => {
      const d = diagByN?.get(frame.n);
      if (d) d.diffToPrevKept = diff;
    });
    const selected = sampleUniform(afterRedundancy, maxFrames);
    for (const s of selected) {
      const d = diagByN?.get(s.n);
      if (d) d.kept = true;
    }

    const lastCandidateTime = windowBests.length ? (Math.max(...windowBests.map((b) => b.n)) + 1) / sampleFps : 0;
    const durationSec = probe.durationSec && probe.durationSec > 0 ? probe.durationSec : lastCandidateTime;

    const frames: KeyFrame[] = [];
    for (let idx = 0; idx < selected.length; idx++) {
      if (opts.signal?.aborted) throw abortError();
      const s = selected[idx];
      const framePath = path.join(outDir, `${String(idx).padStart(4, '0')}.jpg`);
      const thumbPath = path.join(outDir, `${String(idx).padStart(4, '0')}_t.jpg`);
      await fs.copyFile(s.tmpPath, framePath);
      const meta = await sharp(framePath).metadata();
      await writeThumb(framePath, thumbPath, thumbEdge);
      frames.push({
        idx,
        timeSec: Math.round(s.timeSec * 1000) / 1000,
        path: framePath,
        thumbPath,
        width: meta.width,
        height: meta.height,
        sharpness: s.sharpness,
      });
    }
    await opts.onProgress?.(1);

    const first = frames[0];
    return {
      durationSec,
      width: first?.width ?? probe.width,
      height: first?.height ?? probe.height,
      frames,
      stats: {
        candidates: diagnostics ? diagnostics.length : Math.max(candidates, windowBests.length),
        windowBest: windowBests.length,
        afterRedundancy: afterRedundancy.length,
        kept: frames.length,
      },
      ...(diagnostics ? { diagnostics } : {}),
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((err: unknown) => {
      console.warn('[pipeline] frames: temp dir cleanup failed', { tmpDir, error: (err as Error).message });
    });
  }
}

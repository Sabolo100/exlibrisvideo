/**
 * Media probing (SPEC §4.1).
 *
 * Videos: `ffprobe -v error -print_format json -show_format -show_streams`, dimensions reported in
 * DISPLAY orientation (side_data_list[].rotation or tags.rotate ±90 → swap width/height).
 * Images (JPEG / PNG / WebP / …): sharp metadata, EXIF orientation 5–8 swaps width/height.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import sharp, { type Metadata } from 'sharp';
import { env } from '@/lib/env';
import { PipelineError } from '@/lib/jobs/errors';
import type { SourceKind } from '@/lib/types';

export interface MediaProbe {
  kind: SourceKind;
  /** seconds; 0 for still images; null when the container does not report a duration */
  durationSec: number | null;
  /** display width (after rotation) */
  width: number;
  /** display height (after rotation) */
  height: number;
  /** average frame rate (frames per second); null for images or when unknown */
  fps: number | null;
  /** codec name, e.g. h264, hevc, jpeg, png */
  codec: string;
  /** clockwise display rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** sample aspect ratio (1 for square pixels) */
  sampleAspectRatio: number;
}

/* ------------------------------------------------------------------ */
/* ffprobe JSON parsing (pure – unit tested)                           */
/* ------------------------------------------------------------------ */

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  nb_frames?: string;
  sample_aspect_ratio?: string;
  tags?: Record<string, string | undefined>;
  side_data_list?: { side_data_type?: string; rotation?: number | string }[];
  disposition?: { attached_pic?: number };
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string; tags?: Record<string, string | undefined> };
}

/** "30000/1001" → 29.97; "0/0" or garbage → null */
export function parseRational(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:[/:]\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(v);
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const r = num / den;
  return Number.isFinite(r) && r > 0 ? r : null;
}

function parseSeconds(v: string | undefined | null): number | null {
  if (v === undefined || v === null || v === '' || v === 'N/A') return null;
  // Matroska style "00:01:02.345000000"
  const hms = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Normalises any rotation value to 0 / 90 / 180 / 270 (clockwise display rotation). */
export function normalizeRotation(value: number | string | undefined | null): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (n === undefined || n === null || !Number.isFinite(n)) return 0;
  const quarter = Math.round(n / 90) * 90;
  return ((quarter % 360) + 360) % 360;
}

/**
 * Clockwise display rotation of a stream. The display-matrix side data reports the angle
 * counter-clockwise (phones: -90), the legacy `rotate` tag clockwise (phones: 90).
 */
export function streamRotation(stream: FfprobeStream): number {
  for (const sd of stream.side_data_list ?? []) {
    if (sd.rotation !== undefined && sd.rotation !== null && `${sd.rotation}` !== '') {
      const ccw = typeof sd.rotation === 'string' ? Number.parseFloat(sd.rotation) : sd.rotation;
      if (Number.isFinite(ccw)) return normalizeRotation(-ccw);
    }
  }
  return normalizeRotation(stream.tags?.rotate);
}

const IMAGE_CODECS = new Set(['mjpeg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'jpegls', 'jpeg2000']);

/** Interprets ffprobe JSON. Throws PipelineError('unreadable') when there is no usable video stream. */
export function interpretFfprobe(out: FfprobeOutput): MediaProbe {
  const streams = out.streams ?? [];
  const video =
    streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic && (s.width ?? 0) > 0) ??
    streams.find((s) => s.codec_type === 'video' && (s.width ?? 0) > 0);
  if (!video || !video.width || !video.height) {
    throw new PipelineError('unreadable', 'no decodable video stream');
  }
  const rotation = streamRotation(video);
  const swap = rotation === 90 || rotation === 270;
  const sar = parseRational(video.sample_aspect_ratio) ?? 1;
  const codec = video.codec_name ?? 'unknown';
  const formatName = out.format?.format_name ?? '';
  const isImage =
    IMAGE_CODECS.has(codec) && (/image2|_pipe$|^png$|^webp$/.test(formatName) || Number(video.nb_frames ?? 0) <= 1);

  const fps = isImage ? null : (parseRational(video.avg_frame_rate) ?? parseRational(video.r_frame_rate));
  let durationSec: number | null = isImage ? 0 : null;
  if (!isImage) {
    durationSec =
      parseSeconds(out.format?.duration) ??
      parseSeconds(video.duration) ??
      parseSeconds(video.tags?.DURATION) ??
      parseSeconds(out.format?.tags?.DURATION);
    if (durationSec === null && fps && video.nb_frames && Number(video.nb_frames) > 0) {
      durationSec = Number(video.nb_frames) / fps;
    }
  }

  const storedW = Math.max(1, Math.round(video.width * (sar > 0 ? sar : 1)));
  const storedH = video.height;
  return {
    kind: isImage ? 'image' : 'video',
    durationSec,
    width: swap ? storedH : storedW,
    height: swap ? storedW : storedH,
    fps,
    codec,
    rotation,
    sampleAspectRatio: sar,
  };
}

/* ------------------------------------------------------------------ */
/* Process helpers                                                     */
/* ------------------------------------------------------------------ */

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
}

/** spawn(bin, args) with captured output, a hard timeout and optional abort signal. No shell. */
export function runProcess(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal; maxStdoutBytes?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = '';
    let settled = false;
    const maxOut = opts.maxStdoutBytes ?? 64 * 1024 * 1024;
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined;
    const onAbort = () => kill();
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => {
      outBytes += d.length;
      if (outBytes > maxOut) {
        kill();
        return;
      }
      out.push(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 64_000) err += d.toString('utf8');
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code, signal) =>
      finish(() => resolve({ code, signal, stdout: Buffer.concat(out), stderr: err.trim() })),
    );
  });
}

/* ------------------------------------------------------------------ */
/* probeMedia                                                          */
/* ------------------------------------------------------------------ */

type Sniffed = 'jpeg' | 'png' | 'webp' | 'gif' | 'other';

export function sniffImageType(head: Uint8Array): Sniffed {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  )
    return 'png';
  if (
    head.length >= 12 &&
    String.fromCharCode(head[0], head[1], head[2], head[3]) === 'RIFF' &&
    String.fromCharCode(head[8], head[9], head[10], head[11]) === 'WEBP'
  )
    return 'webp';
  if (head.length >= 6 && String.fromCharCode(head[0], head[1], head[2], head[3]) === 'GIF8') return 'gif';
  return 'other';
}

async function readHead(filePath: string, bytes: number): Promise<Uint8Array> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function probeImage(filePath: string): Promise<MediaProbe> {
  let meta: Metadata;
  try {
    meta = await sharp(filePath).metadata();
  } catch (e) {
    throw new PipelineError('unreadable', 'image metadata could not be read', { cause: e });
  }
  if (!meta.width || !meta.height) throw new PipelineError('unreadable', 'image has no dimensions');
  const orientation = meta.orientation ?? 1;
  const swap = orientation >= 5 && orientation <= 8;
  const rotation = orientation === 6 || orientation === 5 ? 90 : orientation === 8 || orientation === 7 ? 270 : orientation === 3 || orientation === 4 ? 180 : 0;
  return {
    kind: 'image',
    durationSec: 0,
    width: swap ? meta.height : meta.width,
    height: swap ? meta.width : meta.height,
    fps: null,
    codec: meta.format ?? 'unknown',
    rotation,
    sampleAspectRatio: 1,
  };
}

export async function probeVideo(filePath: string, opts: { signal?: AbortSignal } = {}): Promise<MediaProbe> {
  let result: RunResult;
  try {
    result = await runProcess(
      env().FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeoutMs: 60_000, signal: opts.signal, maxStdoutBytes: 8 * 1024 * 1024 },
    );
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new PipelineError('internal', `ffprobe binary not found (${env().FFPROBE_PATH})`, { cause: e });
    throw new PipelineError('internal', 'ffprobe could not be started', { cause: e });
  }
  if (result.code !== 0) {
    throw new PipelineError('unreadable', `ffprobe failed (exit ${result.code ?? result.signal}): ${result.stderr.slice(0, 300)}`);
  }
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(result.stdout.toString('utf8')) as FfprobeOutput;
  } catch (e) {
    throw new PipelineError('unreadable', 'ffprobe returned invalid JSON', { cause: e });
  }
  return interpretFfprobe(parsed);
}

/** Probes a stored source file (video or still image). */
export async function probeMedia(filePath: string, opts: { signal?: AbortSignal } = {}): Promise<MediaProbe> {
  let head: Uint8Array;
  try {
    head = await readHead(filePath, 32);
  } catch (e) {
    throw new PipelineError('unreadable', 'source file cannot be opened', { cause: e });
  }
  if (head.length === 0) throw new PipelineError('unreadable', 'source file is empty');
  const sniffed = sniffImageType(head);
  if (sniffed === 'jpeg' || sniffed === 'png' || sniffed === 'webp') {
    return probeImage(filePath);
  }
  return probeVideo(filePath, opts);
}

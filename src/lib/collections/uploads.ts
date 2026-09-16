/**
 * Chunked, resumable uploads of shelf videos / photos (SPEC §3). Owner: api. Server-only.
 *
 *   init      → videos row (uploadStatus 'uploading') + empty file uploads/<cid>/<videoId><ext>
 *   PUT chunk → append-only write at `offset === bytesReceived` (callers hold the per-video lock)
 *   complete  → size + magic-byte check, enqueue process_video, collection → processing
 *
 * Ownership is checked by the route handlers before calling these functions.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { and, count, eq, max, ne } from 'drizzle-orm';
import { db } from '@/db';
import { collections, frames, videos, type VideoRow } from '@/db/schema';
import { env } from '@/lib/env';
import { HttpError } from '@/lib/http';
import { translate } from '@/i18n/index';
import { enqueueJob } from '@/lib/jobs/queue';
import { abs, ensureDirFor, rel } from '@/lib/storage';
import type { Locale } from '@/lib/types';
import { SNIFF_BYTES, sniffMedia } from './sniff';

const MiB = 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/3gpp': '.3gp',
  'video/x-m4v': '.m4v',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Types browsers report when they do not know the file type. */
const UNKNOWN_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Video containers that can never pass the magic-byte check at completion (only ISO-BMFF and Matroska are
 * accepted) – refused at init so users do not upload a large file in vain.
 */
const UNSNIFFABLE_VIDEO_MIME_TYPES = new Set([
  'video/x-msvideo',
  'video/avi',
  'video/msvideo',
  'video/x-ms-wmv',
  'video/x-ms-asf',
  'video/x-flv',
  'video/mpeg',
  'video/mp2t',
  'video/ogg',
]);

/** "Video/MP4; codecs=…" → "video/mp4" */
export function normalizeMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

/** Declared MIME type, or – when the browser sent none / octet-stream – the type implied by the extension. */
export function resolveUploadMime(mime: string | null | undefined, filename: string): string {
  const m = normalizeMime(mime ?? '');
  if (!UNKNOWN_MIME_TYPES.has(m)) return m;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename.trim())?.[1]?.toLowerCase();
  return (ext && Object.hasOwn(MIME_BY_EXT, ext) ? MIME_BY_EXT[ext] : m) || 'application/octet-stream';
}

export function isAllowedUploadMime(mime: string): boolean {
  const m = normalizeMime(mime);
  if (/^video\/[a-z0-9.+-]+$/.test(m)) return !UNSNIFFABLE_VIDEO_MIME_TYPES.has(m);
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(m);
}

/** Display name only: no directories, no control characters, ≤ 255 chars. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 255);
  return cleaned || 'upload';
}

export function extensionFor(mime: string, filename: string): string {
  const m = normalizeMime(mime);
  if (Object.hasOwn(EXT_BY_MIME, m)) return EXT_BY_MIME[m];
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]?.toLowerCase();
  return ext ? `.${ext}` : '.bin';
}

export function maxUploadBytes(): number {
  return env().MAX_UPLOAD_MB * MiB;
}

export function chunkSizeBytes(): number {
  return env().UPLOAD_CHUNK_MB * MiB;
}

/** A single PUT may carry at most UPLOAD_CHUNK_MB + 1 MiB. */
export function maxChunkBytes(): number {
  return (env().UPLOAD_CHUNK_MB + 1) * MiB;
}

/* ------------------------------------------------------------------ */
/* init                                                                 */
/* ------------------------------------------------------------------ */

export async function initUpload(
  collectionId: string,
  input: { filename: string; size: number; mimeType: string },
): Promise<VideoRow> {
  const e = env();
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new HttpError(400, 'invalid', { issues: [{ path: 'size', code: 'too_small', message: 'Size must be positive' }] });
  }
  if (input.size > maxUploadBytes()) throw new HttpError(413, 'too_large', { maxBytes: maxUploadBytes() });
  const originalFilename = sanitizeFilename(input.filename);
  const mimeType = resolveUploadMime(input.mimeType, originalFilename);
  if (!isAllowedUploadMime(mimeType)) throw new HttpError(415, 'unsupported');

  const videoId = randomUUID();
  const storagePath = rel.upload(collectionId, videoId, extensionFor(mimeType, originalFilename));

  const row = await db().transaction(async (tx) => {
    const [col] = await tx.select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId)).for('update');
    if (!col) throw new HttpError(404, 'not_found');
    const [stats] = await tx
      .select({ n: count() })
      .from(videos)
      .where(and(eq(videos.collectionId, collectionId), ne(videos.uploadStatus, 'failed')));
    if (Number(stats?.n ?? 0) >= e.MAX_SOURCES_PER_COLLECTION) {
      throw new HttpError(400, 'too_many_sources', { max: e.MAX_SOURCES_PER_COLLECTION });
    }
    // sortOrder follows every source ever added (failed ones included) so shelf order stays monotonic.
    const [all] = await tx.select({ maxOrder: max(videos.sortOrder) }).from(videos).where(eq(videos.collectionId, collectionId));
    const sortOrder = all?.maxOrder === null || all?.maxOrder === undefined ? 0 : Number(all.maxOrder) + 1;
    const [inserted] = await tx
      .insert(videos)
      .values({
        id: videoId,
        collectionId,
        kind: mimeType.startsWith('image/') ? 'image' : 'video',
        sortOrder,
        originalFilename,
        mimeType,
        sizeBytes: input.size,
        bytesReceived: 0,
        uploadStatus: 'uploading',
        storagePath,
        status: 'pending',
      })
      .returning();
    return inserted;
  });

  try {
    const file = await ensureDirFor(storagePath);
    await fsp.writeFile(file, new Uint8Array(0));
  } catch (err) {
    await db().delete(videos).where(eq(videos.id, videoId)).catch(() => {});
    throw err;
  }
  console.info('[api] upload initialised', { collectionId, videoId, sizeBytes: input.size, mimeType });
  return row;
}

/* ------------------------------------------------------------------ */
/* chunks                                                               */
/* ------------------------------------------------------------------ */

class ChunkTooLargeError extends Error {
  constructor() {
    super('chunk too large');
  }
}

const FATAL_FS_CODES = new Set(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EMFILE', 'EDQUOT']);

async function fileSize(file: string): Promise<number | null> {
  try {
    return (await fsp.stat(file)).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function loadVideo(videoId: string): Promise<VideoRow> {
  const [video] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new HttpError(404, 'not_found');
  return video;
}

/**
 * Appends one chunk. MUST be called while holding `withLock(uploadLockKey(videoId))`.
 * Returns the new `bytesReceived`.
 */
export async function writeChunk(
  videoId: string,
  offset: number,
  body: ReadableStream<Uint8Array> | null,
  contentLength: number | null,
): Promise<number> {
  const video = await loadVideo(videoId);
  const prev = Number(video.bytesReceived);
  const size = Number(video.sizeBytes);

  if (video.uploadStatus !== 'uploading' || !video.storagePath) {
    throw new HttpError(409, 'upload_closed', { bytesReceived: prev, uploadStatus: video.uploadStatus });
  }
  if (offset !== prev) throw new HttpError(409, 'conflict', { bytesReceived: prev });

  const limitPerChunk = maxChunkBytes();
  const remaining = size - prev;
  if (contentLength !== null && (contentLength > limitPerChunk || contentLength > remaining)) {
    throw new HttpError(413, 'too_large', { bytesReceived: prev, maxChunkBytes: limitPerChunk, remainingBytes: remaining });
  }

  const file = abs(video.storagePath);
  await ensureDirFor(video.storagePath);

  // Reconcile the file with the database (a crash between write and UPDATE leaves extra bytes).
  const onDisk = await fileSize(file);
  if (onDisk === null) {
    if (prev > 0) {
      await db().update(videos).set({ bytesReceived: 0 }).where(eq(videos.id, videoId));
      throw new HttpError(409, 'conflict', { bytesReceived: 0 });
    }
    await fsp.writeFile(file, new Uint8Array(0));
  } else if (onDisk > prev) {
    await fsp.truncate(file, prev);
  } else if (onDisk < prev) {
    await db().update(videos).set({ bytesReceived: onDisk }).where(eq(videos.id, videoId));
    throw new HttpError(409, 'conflict', { bytesReceived: onDisk });
  }

  if (!body) return prev;

  const limit = Math.min(limitPerChunk, remaining);
  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
      written += chunk.length;
      if (written > limit) cb(new ChunkTooLargeError());
      else cb(null, chunk);
    },
  });
  const out = fs.createWriteStream(file, { flags: 'a' });

  try {
    await pipeline(Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>), counter, out);
  } catch (err) {
    // Wait until the descriptor is closed so no pending write lands after the truncate.
    if (!out.closed) await once(out, 'close').catch(() => {});
    await fsp.truncate(file, prev).catch((truncErr: unknown) => {
      console.error('[api] could not truncate upload after failed chunk', {
        videoId,
        error: truncErr instanceof Error ? truncErr.message : String(truncErr),
      });
    });
    if (err instanceof ChunkTooLargeError) {
      throw new HttpError(413, 'too_large', { bytesReceived: prev, maxChunkBytes: limitPerChunk, remainingBytes: remaining });
    }
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code && FATAL_FS_CODES.has(code)) throw err;
    // Client aborted / network error: the client re-syncs with GET and retries.
    throw new HttpError(400, 'invalid', { bytesReceived: prev });
  }

  const next = prev + written;
  const actual = await fileSize(file);
  if (actual !== next) {
    await fsp.truncate(file, prev).catch(() => {});
    throw new Error(`upload size mismatch after write (expected ${next}, got ${actual})`);
  }
  const updated = await db()
    .update(videos)
    .set({ bytesReceived: next })
    .where(and(eq(videos.id, videoId), eq(videos.bytesReceived, prev), eq(videos.uploadStatus, 'uploading')))
    .returning({ bytesReceived: videos.bytesReceived });
  if (updated.length === 0) {
    await fsp.truncate(file, prev).catch(() => {});
    const fresh = await loadVideo(videoId);
    throw new HttpError(409, 'conflict', { bytesReceived: Number(fresh.bytesReceived) });
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* complete                                                             */
/* ------------------------------------------------------------------ */

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Finishes an upload. MUST be called while holding `withLock(uploadLockKey(videoId))`.
 * Idempotent for already completed uploads (re-enqueues the job with its dedupe key while still queued).
 */
export async function completeUpload(videoId: string): Promise<VideoRow> {
  const video = await loadVideo(videoId);

  if (video.uploadStatus === 'uploaded') {
    if (video.status === 'queued') {
      await enqueueJob('process_video', { videoId }, { dedupeKey: videoId });
    }
    return video;
  }
  if (video.uploadStatus === 'failed' || !video.storagePath) {
    throw new HttpError(409, 'upload_closed', { uploadStatus: video.uploadStatus });
  }

  const size = Number(video.sizeBytes);
  const received = Number(video.bytesReceived);
  if (received !== size) {
    throw new HttpError(409, 'upload_incomplete', { bytesReceived: received, sizeBytes: size });
  }

  const file = abs(video.storagePath);
  const onDisk = await fileSize(file);
  if (onDisk === null || onDisk < size) {
    const actual = onDisk ?? 0;
    await db().update(videos).set({ bytesReceived: actual }).where(eq(videos.id, videoId));
    throw new HttpError(409, 'upload_incomplete', { bytesReceived: actual, sizeBytes: size });
  }
  if (onDisk > size) await fsp.truncate(file, size);

  const sniffed = sniffMedia(await readHead(file, SNIFF_BYTES));
  if (!sniffed) {
    await fsp.rm(file, { force: true }).catch(() => {});
    const [col] = await db().select({ locale: collections.locale }).from(collections).where(eq(collections.id, video.collectionId));
    const locale: Locale = col?.locale === 'en' ? 'en' : 'hu';
    await db()
      .update(videos)
      .set({ uploadStatus: 'failed', status: 'error', storagePath: null, error: translate(locale, 'errors.unsupported') })
      .where(eq(videos.id, videoId));
    console.info('[api] upload rejected by magic-byte sniffing', { videoId, collectionId: video.collectionId });
    throw new HttpError(415, 'unsupported');
  }

  const updated = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(videos)
      .set({
        uploadStatus: 'uploaded',
        status: 'queued',
        kind: sniffed.kind,
        // Image signatures are exact; for videos keep a declared video/* type (e.g. video/quicktime vs. mp4
        // brands, mkv vs. webm) and only replace a type that contradicts the content.
        mimeType: sniffed.kind === 'image' || !video.mimeType.startsWith('video/') ? sniffed.mimeType : video.mimeType,
        stage: null,
        progress: 0,
        error: null,
      })
      .where(and(eq(videos.id, videoId), eq(videos.uploadStatus, 'uploading')))
      .returning();
    if (!row) throw new HttpError(409, 'conflict');
    await tx
      .update(collections)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(collections.id, video.collectionId));
    return row;
  });

  await enqueueJob('process_video', { videoId }, { dedupeKey: videoId });
  console.info('[api] upload completed', { collectionId: video.collectionId, videoId, kind: sniffed.kind, sizeBytes: size });
  return updated;
}

/**
 * Owner "reanalyse": queues the recognition of a finished (or failed) source again – from the stored key
 * frames when the source file was already removed after processing. Books the owner added or confirmed
 * stay; the other books that only this source showed are recognised anew.
 * 409 `conflict` (details.reason) while the source is still uploading or processing, or when neither the
 * source file nor key frames are left.
 */
export async function reanalyzeSource(video: VideoRow): Promise<VideoRow> {
  if (video.uploadStatus !== 'uploaded') throw new HttpError(409, 'conflict', { reason: 'upload_incomplete' });
  if (video.status === 'queued' || video.status === 'processing') throw new HttpError(409, 'conflict', { reason: 'processing' });
  const [{ n }] = await db().select({ n: count() }).from(frames).where(eq(frames.videoId, video.id));
  const fromFrames = Number(n) > 0;
  if (!fromFrames && !video.storagePath) throw new HttpError(409, 'conflict', { reason: 'no_frames' });

  const updated = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(videos)
      .set({ status: 'queued', stage: null, progress: 0, error: null })
      .where(and(eq(videos.id, video.id), ne(videos.status, 'processing'), ne(videos.status, 'queued')))
      .returning();
    if (!row) throw new HttpError(409, 'conflict', { reason: 'processing' });
    await tx.update(collections).set({ status: 'processing', updatedAt: new Date() }).where(eq(collections.id, video.collectionId));
    return row;
  });
  await enqueueJob('process_video', { videoId: video.id, fromFrames }, { dedupeKey: video.id });
  console.info('[api] source queued for reanalysis', { collectionId: video.collectionId, videoId: video.id, fromFrames });
  return updated;
}

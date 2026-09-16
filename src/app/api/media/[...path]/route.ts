import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { requireCollection, requireOwner, requireViewer } from '@/lib/collections/guards';
import { HttpError, withErrorHandling } from '@/lib/http';
import { isCollectionId } from '@/lib/security/tokens';
import { abs } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

/** Top-level storage directories served here, and who may read them. `exports/` is never served. */
const ROOT_ACCESS: Record<string, 'viewer' | 'owner'> = {
  frames: 'viewer',
  spines: 'viewer',
  covers: 'viewer',
  uploads: 'owner',
};

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp',
};

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext] : 'application/octet-stream';
}

function validSegments(segments: unknown): segments is string[] {
  if (!Array.isArray(segments) || segments.length < 3 || segments.length > 8) return false;
  return segments.every(
    (s) =>
      typeof s === 'string' &&
      s.length > 0 &&
      s.length <= 255 &&
      s !== '.' &&
      s !== '..' &&
      // Windows device names (dev machines) never refer to stored files
      !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s) &&
      // no separators, NUL, drive letters / ADS (":"), or other control characters
      !/[\\/:\u0000-\u001f\u007f]/.test(s),
  );
}

/** GET /api/media/<dir>/<collectionId>/… – access-checked file streaming (supports Range + ETag). */
export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { path: segments } = await ctx.params;
  if (!validSegments(segments)) throw new HttpError(400, 'invalid');

  const access = Object.hasOwn(ROOT_ACCESS, segments[0]) ? ROOT_ACCESS[segments[0]] : undefined;
  if (!access || !isCollectionId(segments[1])) throw new HttpError(404, 'not_found');

  const collection = await requireCollection(segments[1]);
  if (access === 'owner') requireOwner(req, collection);
  else requireViewer(req, collection);

  let file: string;
  try {
    file = abs(segments.join('/'));
  } catch {
    throw new HttpError(400, 'invalid');
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
  } catch {
    throw new HttpError(404, 'not_found');
  }
  if (!stat.isFile()) throw new HttpError(404, 'not_found');

  const size = stat.size;
  const etag = `W/"${size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentTypeFor(file),
    'Cache-Control': 'private, max-age=86400',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-site',
  };

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.get('range');
  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
    }
    if (m[1] === '') {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
    baseHeaders['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  const length = size === 0 ? 0 : end - start + 1;
  const headers = { ...baseHeaders, 'Content-Length': String(length) };
  if (length === 0) return new Response(null, { status, headers });

  const stream = fs.createReadStream(file, { start, end });
  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
});

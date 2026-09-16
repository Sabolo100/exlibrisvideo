import { requireOwnedVideo } from '@/lib/collections/guards';
import { deleteSource } from '@/lib/collections/service';
import { uploadLockKey, withLock } from '@/lib/collections/upload-lock';
import { writeChunk } from '@/lib/collections/uploads';
import { HttpError, json, noContent, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ videoId: string }> };

/** GET /api/uploads/:videoId – resume info. */
export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { videoId } = await ctx.params;
  const { video } = await requireOwnedVideo(req, videoId);
  return json({
    bytesReceived: Number(video.bytesReceived),
    sizeBytes: Number(video.sizeBytes),
    uploadStatus: video.uploadStatus,
  });
});

function parseOffset(req: Request): number {
  const raw = new URL(req.url).searchParams.get('offset');
  if (raw === null || !/^[0-9]{1,15}$/.test(raw)) {
    throw new HttpError(400, 'invalid', { issues: [{ path: 'offset', code: 'invalid_type', message: 'offset must be a non-negative integer' }] });
  }
  return Number(raw);
}

function parseContentLength(req: Request): number | null {
  const raw = req.headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  if (!/^[0-9]+$/.test(raw.trim())) throw new HttpError(400, 'invalid');
  return Number(raw.trim());
}

/** PUT /api/uploads/:videoId?offset=<n> – append one chunk (raw bytes). */
export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { videoId } = await ctx.params;
  const offset = parseOffset(req);
  const contentLength = parseContentLength(req);
  await requireOwnedVideo(req, videoId);
  const bytesReceived = await withLock(uploadLockKey(videoId), () => writeChunk(videoId, offset, req.body, contentLength));
  return json({ bytesReceived });
});

/** DELETE /api/uploads/:videoId – remove a source with its frames, detections and single-source books. */
export const DELETE = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { videoId } = await ctx.params;
  await requireOwnedVideo(req, videoId);
  await withLock(uploadLockKey(videoId), () => deleteSource(videoId));
  return noContent();
});

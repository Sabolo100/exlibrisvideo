import { enforceRateLimit, requireCollection, requireOwner } from '@/lib/collections/guards';
import { chunkSizeBytes, initUpload } from '@/lib/collections/uploads';
import { initUploadSchema } from '@/lib/collections/validation';
import { env } from '@/lib/env';
import { getClientIp, json, parseJson, withErrorHandling } from '@/lib/http';
import type { InitUploadResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/collections/:id/uploads – owner starts a chunked upload. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  await enforceRateLimit(`uploads:ip:${getClientIp(req)}`, env().RATE_UPLOADS_PER_IP_HOUR, 3600);
  const body = await parseJson(req, initUploadSchema);
  const video = await initUpload(collection.id, body);
  const response: InitUploadResponse = {
    videoId: video.id,
    chunkSize: chunkSizeBytes(),
    bytesReceived: Number(video.bytesReceived),
  };
  return json(response, { status: 201 });
});

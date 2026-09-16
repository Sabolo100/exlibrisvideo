import { toVideoDTO } from '@/lib/collections/dto';
import { enforceRateLimit, requireOwnedVideo } from '@/lib/collections/guards';
import { uploadLockKey, withLock } from '@/lib/collections/upload-lock';
import { reanalyzeSource } from '@/lib/collections/uploads';
import { json, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ videoId: string }> };

/**
 * POST /api/uploads/:videoId/reanalyze – owner: recognise the books of a finished source again (from its
 * stored key frames when the source file is gone). 202 + VideoDTO. Rate: 6 / hour per collection.
 */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { videoId } = await ctx.params;
  const { video, collection } = await requireOwnedVideo(req, videoId);
  await enforceRateLimit(`reanalyze:collection:${collection.id}`, 6, 3600);
  const updated = await withLock(uploadLockKey(videoId), () => reanalyzeSource(video));
  return json({ video: toVideoDTO(updated) }, { status: 202 });
});

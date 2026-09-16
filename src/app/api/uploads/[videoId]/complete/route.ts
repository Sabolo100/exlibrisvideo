import { toVideoDTO } from '@/lib/collections/dto';
import { requireOwnedVideo } from '@/lib/collections/guards';
import { uploadLockKey, withLock } from '@/lib/collections/upload-lock';
import { completeUpload } from '@/lib/collections/uploads';
import { json, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ videoId: string }> };

/** POST /api/uploads/:videoId/complete – verify size + magic bytes, queue processing. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { videoId } = await ctx.params;
  await requireOwnedVideo(req, videoId);
  const video = await withLock(uploadLockKey(videoId), () => completeUpload(videoId));
  return json({ video: toVideoDTO(video) });
});

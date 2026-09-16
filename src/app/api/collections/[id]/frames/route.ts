import { requireCollection, requireViewer } from '@/lib/collections/guards';
import { getCollectionFrames } from '@/lib/collections/queries';
import { json, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/collections/:id/frames – key frames + detection boxes ("how we saw it"). */
export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireViewer(req, collection);
  return json(await getCollectionFrames(collection.id));
});

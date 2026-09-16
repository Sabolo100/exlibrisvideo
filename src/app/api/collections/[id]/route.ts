import { SEEN_COOKIE_MAX_AGE, seenCookieName } from '@/lib/collections/access';
import { requireCollection, requireOwner, requireViewer } from '@/lib/collections/guards';
import { buildCollectionDTO, buildCollectionWithBooks } from '@/lib/collections/queries';
import { deleteCollection, updateCollection } from '@/lib/collections/service';
import { collectionPatchSchema } from '@/lib/collections/validation';
import { countCollectionView, viewerFingerprint } from '@/lib/collections/views';
import { json, noContent, parseJson, readCookie, serializeCookie, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/collections/:id – CollectionWithBooksDTO for viewers; counts non-owner views (≤ 1 per 30 min per browser). */
export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  const viewer = requireViewer(req, collection);
  const countView = !viewer.isOwner && !readCookie(req, seenCookieName(collection.id));
  const [data] = await Promise.all([
    buildCollectionWithBooks(collection, viewer.isOwner),
    // Best-effort (never throws); shares its throttle with the collection page render.
    countView ? countCollectionView(collection.id, viewerFingerprint(req.headers)) : Promise.resolve(false),
  ]);

  const headers = new Headers();
  if (countView) {
    headers.append('Set-Cookie', serializeCookie(req, seenCookieName(collection.id), '1', { maxAge: SEEN_COOKIE_MAX_AGE }));
  }
  return json(data, { headers });
});

/** PATCH /api/collections/:id – owner updates settings; returns CollectionDTO. */
export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const patch = await parseJson(req, collectionPatchSchema);
  const updated = await updateCollection(collection.id, patch);
  return json(await buildCollectionDTO(updated, true));
});

/** DELETE /api/collections/:id – owner deletes everything (rows + files). */
export const DELETE = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  await deleteCollection(collection.id);
  return noContent();
});

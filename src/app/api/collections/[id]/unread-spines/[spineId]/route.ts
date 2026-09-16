import { toBookDTO } from '@/lib/collections/dto';
import { requireCollection, requireOwner } from '@/lib/collections/guards';
import { dismissUnreadSpine, resolveUnreadSpine } from '@/lib/collections/unread-spines';
import { resolveUnreadSpineSchema } from '@/lib/collections/validation';
import { json, noContent, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; spineId: string }> };

/** POST /api/collections/:id/unread-spines/:spineId – owner names the book on an unread spine → BookDTO (201). */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id, spineId } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const body = await parseJson(req, resolveUnreadSpineSchema);
  const book = await resolveUnreadSpine(collection.id, spineId, body);
  return json(toBookDTO(book, { isOwner: true }), { status: 201 });
});

/** DELETE /api/collections/:id/unread-spines/:spineId – owner discards an unread spine. */
export const DELETE = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id, spineId } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  await dismissUnreadSpine(collection.id, spineId);
  return noContent();
});

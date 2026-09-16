import { toBookDTO } from '@/lib/collections/dto';
import { requireCollection, requireOwner } from '@/lib/collections/guards';
import { mergeBooks } from '@/lib/collections/service';
import { mergeBooksSchema } from '@/lib/collections/validation';
import { json, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/collections/:id/books/merge – `{ keepId, mergeIds }` → merged BookDTO. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const { keepId, mergeIds } = await parseJson(req, mergeBooksSchema);
  const book = await mergeBooks(collection.id, keepId, mergeIds);
  return json(toBookDTO(book, { isOwner: true }));
});

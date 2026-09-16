import { toBookDTO } from '@/lib/collections/dto';
import { requireCollection, requireOwner } from '@/lib/collections/guards';
import { addManualBook } from '@/lib/collections/service';
import { newBookSchema } from '@/lib/collections/validation';
import { json, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/collections/:id/books – owner adds a book manually. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const body = await parseJson(req, newBookSchema);
  const book = await addManualBook(collection.id, body);
  return json(toBookDTO(book, { isOwner: true }), { status: 201 });
});

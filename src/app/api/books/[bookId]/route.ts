import { toBookDTO } from '@/lib/collections/dto';
import { requireOwnedBook } from '@/lib/collections/guards';
import { deleteBook, updateBook } from '@/lib/collections/service';
import { bookPatchSchema } from '@/lib/collections/validation';
import { json, noContent, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ bookId: string }> };

/** PATCH /api/books/:bookId – owner edits a book. */
export const PATCH = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { bookId } = await ctx.params;
  const { book } = await requireOwnedBook(req, bookId);
  const patch = await parseJson(req, bookPatchSchema);
  const updated = await updateBook(book.id, patch);
  return json(toBookDTO(updated, { isOwner: true }));
});

/** DELETE /api/books/:bookId – owner deletes a book. */
export const DELETE = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { bookId } = await ctx.params;
  const { book } = await requireOwnedBook(req, bookId);
  await deleteBook(book.id);
  return noContent();
});

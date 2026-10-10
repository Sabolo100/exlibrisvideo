import { z } from 'zod';
import { toBookDTO } from '@/lib/collections/dto';
import { requireOwnedBook } from '@/lib/collections/guards';
import { resolveDuplicate } from '@/lib/collections/service';
import { json, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ bookId: string }> };

const schema = z.object({ resolution: z.enum(['same', 'copy', 'different']) });

/**
 * POST /api/books/:bookId/duplicate `{ resolution }` – owner answers "this book was already in the
 * catalogue": `{ book, removedId }` (the book that stays; `removedId` = the merged-away book or null).
 */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { bookId } = await ctx.params;
  const { book } = await requireOwnedBook(req, bookId);
  const { resolution } = await parseJson(req, schema);
  const result = await resolveDuplicate(book.collectionId, book.id, resolution);
  return json({ book: toBookDTO(result.book, { isOwner: true }), removedId: result.removedId });
});

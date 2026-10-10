import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { books } from '@/db/schema';
import { attachBookPhoto } from '@/lib/books/photo';
import { toBookDTO } from '@/lib/collections/dto';
import { requireCollection, requireOwner } from '@/lib/collections/guards';
import { addManualBook } from '@/lib/collections/service';
import { newBookSchema } from '@/lib/collections/validation';
import { json, parseJson, withErrorHandling } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = newBookSchema.extend({
  /** the photo the book was identified from (POST …/identify-photo) */
  photo: z.object({ token: z.string().max(64), kind: z.enum(['spine', 'cover', 'isbn']) }).optional(),
});

/** a few books photographed one after the other → one enrichment run */
const ENRICH_AFTER_PHOTO_MS = 20_000;

/** POST /api/collections/:id/books – owner adds a book by hand or from a photo. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const { photo, ...body } = await parseJson(req, bodySchema);
  let book = await addManualBook(collection.id, body);
  if (photo) {
    try {
      if (await attachBookPhoto(collection.id, book.id, photo)) {
        await db().update(books).set({ source: 'image' }).where(eq(books.id, book.id));
        [book] = await db().select().from(books).where(eq(books.id, book.id));
      }
    } catch (err) {
      console.warn('[api] book photo not attached', { collectionId: collection.id, bookId: book.id, error: err instanceof Error ? err.message : String(err) });
    }
    // topics, description, cover (by ISBN) like the recognised books
    await enqueueJob(
      'enrich_collection',
      { collectionId: collection.id },
      { dedupeKey: collection.id, dedupeQueuedOnly: true, runAt: new Date(Date.now() + ENRICH_AFTER_PHOTO_MS) },
    ).catch((err) => console.warn('[api] enrichment after a photo book not queued', { collectionId: collection.id, error: String(err) }));
  }
  return json(toBookDTO(book, { isOwner: true }), { status: 201 });
});

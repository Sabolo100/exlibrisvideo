import { identifyBookPhoto } from '@/lib/books/photo';
import { enforceRateLimit, requireCollection, requireOwner } from '@/lib/collections/guards';
import { HttpError, json, withErrorHandling } from '@/lib/http';
import type { BookPhotoKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const KINDS: BookPhotoKind[] = ['spine', 'cover', 'isbn'];
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
/** photo recognitions per collection per hour (each one may be an AI call) */
const RATE_PER_HOUR = 120;

/**
 * POST /api/collections/:id/identify-photo (multipart: `kind` spine|cover|isbn, `photo` image, optional `isbn`
 * read by the browser) – owner: which book is on the photo, and does the library have it already.
 */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  await enforceRateLimit(`identify:col:${collection.id}`, RATE_PER_HOUR, 3600);

  const form = await req.formData().catch(() => {
    throw new HttpError(400, 'invalid');
  });
  const kind = form.get('kind');
  if (typeof kind !== 'string' || !KINDS.includes(kind as BookPhotoKind)) throw new HttpError(400, 'invalid');
  const isbnField = form.get('isbn');
  const clientIsbn = typeof isbnField === 'string' ? isbnField.slice(0, 40) : null;
  const file = form.get('photo');
  let image: Buffer | null = null;
  if (file && typeof file !== 'string') {
    if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'too_large', { maxBytes: MAX_PHOTO_BYTES });
    if (file.type && !/^image\//.test(file.type)) throw new HttpError(415, 'unsupported');
    image = Buffer.from(await file.arrayBuffer());
  }
  if (!image && !clientIsbn) throw new HttpError(400, 'invalid');

  const result = await identifyBookPhoto({ collectionId: collection.id, kind: kind as BookPhotoKind, image, clientIsbn });
  return json(result);
});

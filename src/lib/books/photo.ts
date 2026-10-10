/**
 * Adding one new book from a phone photo (owner). Server-only.
 *
 *  identifyBookPhoto  photo (spine | cover | ISBN barcode) → the book as far as it can be told + the books
 *                     of the library that look the same; a spine / cover photo is kept for 1 day under
 *                     tmp/photos/<collectionId>/<token>.jpg until the owner adds the book
 *  attachBookPhoto    moves that photo to the new book (spine photo → spinePath + spineColor, cover photo →
 *                     coverPath)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '@/db';
import { books } from '@/db/schema';
import { getVisionProvider } from '@/lib/ai';
import type { BookPhotoKind, BookPhotoReading } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import { authorsCompatible, hungarianNameOrder, normalizeTitle, titleSimilarityNormalized } from '@/lib/pipeline/text';
import { abs, ensureDirFor, rel } from '@/lib/storage';
import type { IdentifiedBookDTO, IdentifyBookResponse } from '@/lib/types';
import { readEan13FromImage } from './ean13';
import { toIsbn13 } from './isbn';
import { lookupIsbn } from './isbn-lookup';

const PHOTO_MAX_EDGE = 1600;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SAME_TITLE = 0.85;

export const tmpPhotoPath = (collectionId: string, token: string) => `tmp/photos/${collectionId}/${token}.jpg`;

/** Upright JPEG, long edge ≤ 1600 px. */
async function normalizePhoto(input: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

async function askVision(collectionId: string, photo: { jpeg: Buffer; width: number; height: number }, kind: BookPhotoKind): Promise<BookPhotoReading | null> {
  const provider = getVisionProvider();
  if (!provider.identifyBookPhoto) return null;
  try {
    const { reading, usage } = await provider.identifyBookPhoto(photo, kind);
    await recordUsage(collectionId, usage).catch(() => {});
    return reading;
  } catch (err) {
    console.warn('[books] photo recognition failed', { collectionId, kind, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Books of the collection that look like the identified one (same ISBN, or same title with compatible authors). */
export async function findSimilarBooks(
  collectionId: string,
  book: Pick<IdentifiedBookDTO, 'title' | 'author' | 'isbn'>,
): Promise<IdentifyBookResponse['similar']> {
  const title = normalizeTitle(book.title);
  if (!title && !book.isbn) return [];
  const rows = await db()
    .select({ id: books.id, title: books.title, author: books.author, isbn: books.isbn, copies: books.copies, spineTitle: books.spineTitle })
    .from(books)
    .where(eq(books.collectionId, collectionId));
  const scored = rows
    .map((r) => {
      if (book.isbn && r.isbn && r.isbn.replace(/[^0-9X]/gi, '') === book.isbn) return { r, score: 1 };
      if (!title) return null;
      const s = Math.max(titleSimilarityNormalized(title, normalizeTitle(r.title)), titleSimilarityNormalized(title, normalizeTitle(r.spineTitle)));
      return s >= SAME_TITLE && authorsCompatible(book.author, r.author) ? { r, score: s } : null;
    })
    .filter((x): x is { r: (typeof rows)[number]; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map(({ r }) => ({ id: r.id, title: r.title, author: r.author, copies: Math.max(1, r.copies ?? 1) }));
}

/**
 * Identifies a book from a photo. `clientIsbn`: digits the browser's own barcode reader found (checked
 * again here). Never throws for an unreadable photo – the answer then has `found: false`.
 */
export async function identifyBookPhoto(input: {
  collectionId: string;
  kind: BookPhotoKind;
  image: Buffer | null;
  clientIsbn?: string | null;
}): Promise<IdentifyBookResponse> {
  const { collectionId, kind } = input;
  const photo = input.image ? await normalizePhoto(input.image) : null;

  let isbn = toIsbn13(input.clientIsbn);
  let reading: BookPhotoReading | null = null;
  let via: IdentifyBookResponse['via'] = isbn ? 'barcode' : 'none';

  if (kind === 'isbn') {
    if (!isbn && photo) {
      isbn = await readEan13FromImage(photo.jpeg).then(toIsbn13).catch(() => null);
      if (isbn) via = 'barcode';
    }
    if (!isbn && photo) {
      reading = await askVision(collectionId, photo, 'isbn');
      isbn = toIsbn13(reading?.isbn);
      if (isbn) via = 'ai';
    }
  } else if (photo) {
    reading = await askVision(collectionId, photo, kind);
    if (reading) via = 'ai';
    isbn = toIsbn13(reading?.isbn);
  }

  const looked = isbn ? await lookupIsbn(isbn) : null;
  // an ISBN no database knows: the back cover often prints the title and the author too
  if (kind === 'isbn' && isbn && !looked && !reading && photo) reading = await askVision(collectionId, photo, 'isbn');
  const useReading = reading && reading.status === 'book' && (reading.title || reading.author);
  // on a spine or cover photo what is printed wins; the ISBN record fills the gaps (and is the only source for a barcode)
  const pick = <T>(printed: T | null | undefined, record: T | null | undefined): T | null =>
    kind === 'isbn' ? (record ?? printed ?? null) : (printed ?? record ?? null);
  const candidate: IdentifiedBookDTO = {
    title: pick(useReading ? reading!.title || null : null, looked?.title) ?? '',
    subtitle: pick(useReading ? reading!.subtitle : null, looked?.subtitle),
    author: pick(useReading ? reading!.author : null, hungarianNameOrder(looked?.author, looked?.language)),
    publisher: pick(useReading ? reading!.publisher : null, looked?.publisher),
    isbn,
    editionYear: looked?.editionYear ?? null,
    pageCount: looked?.pageCount ?? null,
    language: pick(useReading ? reading!.language : null, looked?.language),
    coverUrl: looked?.coverUrl ?? null,
    confidence: looked ? 1 : useReading ? reading!.confidence : 0,
  };
  if (looked) via = via === 'none' ? 'lookup' : via;

  let photoToken: string | null = null;
  if (photo && kind !== 'isbn') {
    photoToken = crypto.randomBytes(18).toString('base64url');
    await fs.writeFile(await ensureDirFor(tmpPhotoPath(collectionId, photoToken)), photo.jpeg);
  }

  const found = !!(candidate.title || candidate.author);
  const similar = found || isbn ? await findSimilarBooks(collectionId, candidate) : [];
  console.info('[books] photo identified', { collectionId, kind, via, found, isbn: !!isbn, lookup: looked?.source ?? null, similar: similar.length });
  return {
    found,
    via,
    candidate,
    photoToken,
    notBook: reading?.status === 'not_book',
    isbnUnknown: !!isbn && !looked && !useReading,
    similar,
  };
}

/** Gives a new book the photo it was identified from; false for no / an unknown / an expired photo. */
export async function attachBookPhoto(collectionId: string, bookId: string, photo: { token: string; kind: BookPhotoKind }): Promise<boolean> {
  if (!TOKEN_RE.test(photo.token) || photo.kind === 'isbn') return false;
  const from = abs(tmpPhotoPath(collectionId, photo.token));
  const buffer = await fs.readFile(from).catch(() => null);
  if (!buffer) return false;
  const target = photo.kind === 'spine' ? rel.spine(collectionId, bookId) : rel.cover(collectionId, bookId);
  if (photo.kind === 'spine') {
    // spines stand upright like the cut-out ones (portrait), at most 900 px long
    const meta = await sharp(buffer).metadata();
    const turned = (meta.width ?? 0) > (meta.height ?? 0) ? sharp(buffer).rotate(-90) : sharp(buffer);
    const out = await turned.resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    await fs.writeFile(await ensureDirFor(target), out);
    const { dominant } = await sharp(out).stats();
    const hex = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    await db().update(books).set({ spinePath: target, spineColor: hex }).where(eq(books.id, bookId));
  } else {
    const out = await sharp(buffer).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    await fs.writeFile(await ensureDirFor(target), out);
    await db().update(books).set({ coverPath: target }).where(eq(books.id, bookId));
  }
  await fs.rm(from, { force: true }).catch(() => {});
  return true;
}

/**
 * Access guards and small helpers for route handlers (owner: api). Every guard throws HttpError.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { books, collections, videos, type BookRow, type CollectionRow, type VideoRow } from '@/db/schema';
import { HttpError } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { isCollectionId, isUuid } from '@/lib/security/tokens';
import { getViewerFromRequest, type Viewer } from './access';

/** 404 unless `id` is a well-formed, existing collection id. */
export async function requireCollection(id: string): Promise<CollectionRow> {
  if (!isCollectionId(id)) throw new HttpError(404, 'not_found');
  const [row] = await db().select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

/** 403 `needs_pin` unless the request may view the collection. */
export function requireViewer(req: Request, collection: CollectionRow): Viewer {
  const viewer = getViewerFromRequest(req, collection);
  if (!viewer.canView) throw new HttpError(403, 'needs_pin', { id: collection.id, title: collection.title });
  return viewer;
}

/** 403 `forbidden` unless the request carries a valid owner cookie or bearer token. */
export function requireOwner(req: Request, collection: CollectionRow): Viewer {
  const viewer = getViewerFromRequest(req, collection);
  if (!viewer.isOwner) throw new HttpError(403, 'forbidden');
  return viewer;
}

/** Loads a source and checks that the request owns its collection (404 / 403). */
export async function requireOwnedVideo(req: Request, videoId: string): Promise<{ video: VideoRow; collection: CollectionRow }> {
  if (!isUuid(videoId)) throw new HttpError(404, 'not_found');
  const [row] = await db()
    .select({ video: videos, collection: collections })
    .from(videos)
    .innerJoin(collections, eq(collections.id, videos.collectionId))
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!row) throw new HttpError(404, 'not_found');
  requireOwner(req, row.collection);
  return row;
}

/** Loads a book and checks that the request owns its collection (404 / 403). */
export async function requireOwnedBook(req: Request, bookId: string): Promise<{ book: BookRow; collection: CollectionRow }> {
  if (!isUuid(bookId)) throw new HttpError(404, 'not_found');
  const [row] = await db()
    .select({ book: books, collection: collections })
    .from(books)
    .innerJoin(collections, eq(collections.id, books.collectionId))
    .where(eq(books.id, bookId))
    .limit(1);
  if (!row) throw new HttpError(404, 'not_found');
  requireOwner(req, row.collection);
  return row;
}

/** Counts a hit and throws 429 `rate_limited` (with Retry-After) when over the limit. */
export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const result = await checkRateLimit(key, limit, windowSec);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    throw new HttpError(
      429,
      'rate_limited',
      { retryAfterSec: retryAfter, resetAt: result.resetAt.toISOString() },
      { 'Retry-After': String(retryAfter) },
    );
  }
}

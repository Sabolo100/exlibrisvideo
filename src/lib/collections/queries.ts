/**
 * Read models used by Server Components, route handlers, exports, e-mails and the OG image.
 * Owner: api. Server-only.
 */
import { and, asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { books, collections, detections, frames, videos, type CollectionRow, type VideoRow } from '@/db/schema';
import { isCollectionId } from '@/lib/security/tokens';
import type {
  BBox,
  CollectionDTO,
  CollectionStatus,
  CollectionStatusDTO,
  CollectionWithBooksDTO,
  FrameDTO,
} from '@/lib/types';
import { getViewerForPage } from './access';
import { sortVideos, toBBox, toBookDTO, toCollectionDTO, toFrameDTO, toVideoDTO } from './dto';
import { countCollectionView, viewerFingerprint } from './views';

export type CollectionPageResult =
  | { kind: 'ok'; data: CollectionWithBooksDTO }
  | { kind: 'not_found' }
  | { kind: 'needs_pin'; id: string; title: string | null };

/** Collection row by public id, or null (also for malformed ids). */
export async function findCollectionRow(id: string): Promise<CollectionRow | null> {
  if (!isCollectionId(id)) return null;
  const [row] = await db().select().from(collections).where(eq(collections.id, id)).limit(1);
  return row ?? null;
}

/** Builds the full DTO for an already loaded (and access-checked) collection row. */
export async function buildCollectionWithBooks(row: CollectionRow, isOwner: boolean): Promise<CollectionWithBooksDTO> {
  const [videoRows, bookRows] = await Promise.all([
    db().select().from(videos).where(eq(videos.collectionId, row.id)).orderBy(asc(videos.sortOrder), asc(videos.createdAt)),
    db()
      .select()
      .from(books)
      .where(eq(books.collectionId, row.id))
      .orderBy(asc(books.shelfPosition), asc(books.createdAt), asc(books.id)),
  ]);
  return {
    ...toCollectionDTO(row, { isOwner, bookCount: bookRows.length, videos: videoRows }),
    books: bookRows.map((b) => toBookDTO(b, { isOwner })),
  };
}

/** CollectionDTO (without books) for an already loaded (and access-checked) collection row. */
export async function buildCollectionDTO(row: CollectionRow, isOwner: boolean): Promise<CollectionDTO> {
  const [videoRows, bookCount] = await Promise.all([
    db().select().from(videos).where(eq(videos.collectionId, row.id)),
    countBooks(row.id),
  ]);
  return toCollectionDTO(row, { isOwner, bookCount, videos: videoRows });
}

/**
 * For `/[id]/page.tsx`: applies viewer access from request cookies (owner cookie, PIN cookie).
 * Counts a non-owner view (at most once per 30 min per visitor, shared with GET /api/collections/:id);
 * pass `{ countView: false }` from `generateMetadata` or other secondary loads.
 */
export async function loadCollectionPage(id: string, opts?: { countView?: boolean }): Promise<CollectionPageResult> {
  const row = await findCollectionRow(id);
  if (!row) return { kind: 'not_found' };
  const viewer = await getViewerForPage(row);
  if (!viewer.canView) return { kind: 'needs_pin', id: row.id, title: row.title };
  const shouldCount = opts?.countView !== false && !viewer.isOwner;
  const [data] = await Promise.all([
    buildCollectionWithBooks(row, viewer.isOwner),
    shouldCount ? countPageView(row.id) : Promise.resolve(false),
  ]);
  return { kind: 'ok', data };
}

async function countPageView(collectionId: string): Promise<boolean> {
  try {
    const { headers } = await import('next/headers');
    return await countCollectionView(collectionId, viewerFingerprint(await headers()));
  } catch (err) {
    console.warn('[api] page view count failed', { collectionId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Trusted server-side load (worker, e-mail, export after access check). */
export async function getCollectionWithBooks(
  id: string,
  opts: { isOwner: boolean },
): Promise<CollectionWithBooksDTO | null> {
  const row = await findCollectionRow(id);
  if (!row) return null;
  return buildCollectionWithBooks(row, opts.isOwner);
}

/**
 * Overall 0..100 progress: average over uploaded sources (done and error count as 100, queued/pending 0,
 * processing = its own progress). No uploaded sources → 0. While the collection is still `processing`
 * (e.g. enrichment runs after every source finished) the value is capped at 99.
 */
export function computeCollectionProgress(
  status: CollectionStatus,
  sources: Pick<VideoRow, 'uploadStatus' | 'status' | 'progress'>[],
): number {
  const uploaded = sources.filter((s) => s.uploadStatus === 'uploaded');
  if (uploaded.length === 0) return 0;
  const total = uploaded.reduce((sum, s) => {
    if (s.status === 'done' || s.status === 'error') return sum + 100;
    if (s.status === 'processing') return sum + Math.min(100, Math.max(0, Number(s.progress) || 0));
    return sum;
  }, 0);
  let progress = Math.round(total / uploaded.length);
  if (status !== 'ready' && status !== 'error') progress = Math.min(progress, 99);
  return Math.min(100, Math.max(0, progress));
}

async function countBooks(collectionId: string): Promise<number> {
  const [r] = await db().select({ n: count() }).from(books).where(eq(books.collectionId, collectionId));
  return Number(r?.n ?? 0);
}

/** Status DTO for an already loaded (and access-checked) collection row. */
export async function buildCollectionStatus(row: CollectionRow): Promise<CollectionStatusDTO> {
  const [videoRows, bookCount] = await Promise.all([
    db().select().from(videos).where(eq(videos.collectionId, row.id)),
    countBooks(row.id),
  ]);
  const dto = toCollectionDTO(row, { isOwner: false, bookCount, videos: videoRows });
  return {
    id: row.id,
    status: dto.status,
    progress: computeCollectionProgress(dto.status, videoRows),
    bookCount,
    videos: sortVideos(videoRows).map(toVideoDTO),
    updatedAt: dto.updatedAt,
  };
}

export async function getCollectionStatus(id: string): Promise<CollectionStatusDTO | null> {
  const row = await findCollectionRow(id);
  if (!row) return null;
  return buildCollectionStatus(row);
}

export async function getCollectionFrames(
  id: string,
): Promise<{ frames: FrameDTO[]; detections: { frameId: string; bookId: string | null; bbox: BBox | null }[] }> {
  if (!isCollectionId(id)) return { frames: [], detections: [] };
  const [frameRows, detectionRows] = await Promise.all([
    db()
      .select({ frame: frames })
      .from(frames)
      .innerJoin(videos, eq(videos.id, frames.videoId))
      .where(eq(frames.collectionId, id))
      .orderBy(asc(videos.sortOrder), asc(videos.createdAt), asc(frames.idx)),
    db()
      .select({ frameId: detections.frameId, bookId: detections.bookId, bbox: detections.bbox, order: detections.orderInFrame })
      .from(detections)
      .where(and(eq(detections.collectionId, id), isNotNull(detections.frameId)))
      .orderBy(asc(detections.frameId), asc(detections.orderInFrame)),
  ]);
  return {
    frames: frameRows.map((r) => toFrameDTO(r.frame)),
    detections: detectionRows
      .filter((d): d is typeof d & { frameId: string } => d.frameId !== null)
      .map((d) => ({ frameId: d.frameId, bookId: d.bookId, bbox: toBBox(d.bbox) })),
  };
}

/** Small public summary for the Open Graph image; null when missing or PIN-protected. */
export async function getOgSummary(
  id: string,
): Promise<{ title: string | null; ownerName: string | null; bookCount: number; authorCount: number; spineColors: string[]; titles: string[] } | null> {
  const row = await findCollectionRow(id);
  if (!row || row.visibility === 'pin') return null;
  const [stats, firstBooks] = await Promise.all([
    db()
      .select({
        bookCount: count(),
        authorCount: sql<number>`count(DISTINCT lower(${books.author}))`,
      })
      .from(books)
      .where(eq(books.collectionId, id)),
    db()
      .select({ title: books.title, spineColor: books.spineColor })
      .from(books)
      .where(eq(books.collectionId, id))
      .orderBy(asc(books.shelfPosition), asc(books.createdAt))
      .limit(60),
  ]);
  return {
    title: row.title,
    ownerName: row.ownerName,
    bookCount: Number(stats[0]?.bookCount ?? 0),
    authorCount: Number(stats[0]?.authorCount ?? 0),
    spineColors: firstBooks
      .map((b) => b.spineColor)
      .filter((c): c is string => !!c && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c))
      .slice(0, 30),
    titles: firstBooks.map((b) => b.title).slice(0, 30),
  };
}

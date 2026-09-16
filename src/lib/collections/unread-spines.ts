/**
 * Unread spines (owner review): spines of a recording that the recognition found but could not read.
 * The owner names the book on the spine – it becomes a reviewed book at that place of the shelf, with the
 * spine photo, the frame and a detection as evidence – or discards the spine. Either way the row is gone.
 * Owner: api.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm';
import { db } from '@/db';
import { books, collections, detections, frames, unreadSpines, videos, type BookRow, type UnreadSpineRow } from '@/db/schema';
import { env } from '@/lib/env';
import { HttpError } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { authorSortKey, titleSortKey } from '@/lib/pipeline/text';
import { isUuid } from '@/lib/security/tokens';
import { abs, ensureDirFor, rel } from '@/lib/storage';
import type { BBox } from '@/lib/types';
import { parseOr400, removeStoredFiles } from './service';
import { resolveUnreadSpineSchema } from './validation';

/** named books are enriched this much later, so one review session triggers one enrichment run */
export const ENRICH_AFTER_NAMING_MS = 60_000;

/** The unread spines of a collection in shelf order (source order, then left to right). */
export async function listUnreadSpines(collectionId: string): Promise<UnreadSpineRow[]> {
  const rows = await db()
    .select({ spine: unreadSpines })
    .from(unreadSpines)
    .innerJoin(videos, eq(videos.id, unreadSpines.videoId))
    .where(eq(unreadSpines.collectionId, collectionId))
    .orderBy(asc(videos.sortOrder), asc(videos.createdAt), asc(unreadSpines.shelfOrder), asc(unreadSpines.id));
  return rows.map((r) => r.spine);
}

export interface PlacedBox {
  bbox: BBox;
  shelfPosition: number;
}

/**
 * Shelf position for a book standing at `box` of a frame: halfway between the nearest recognised books to
 * its left and right on the same shelf of that frame (boxes that overlap it vertically by at least half),
 * just after / before the only neighbour, or null when the frame shows no book beside it.
 */
export function shelfPositionBetween(box: BBox, others: readonly PlacedBox[]): number | null {
  const centre = (b: BBox) => (b.x0 + b.x1) / 2;
  const cx = centre(box);
  let left: { cx: number; position: number } | null = null;
  let right: { cx: number; position: number } | null = null;
  for (const other of others) {
    const b = other.bbox;
    const overlap = Math.min(box.y1, b.y1) - Math.max(box.y0, b.y0);
    if (overlap < 0.5 * Math.min(box.y1 - box.y0, b.y1 - b.y0)) continue; // another shelf
    const ocx = centre(b);
    if (ocx < cx && (!left || ocx > left.cx)) left = { cx: ocx, position: other.shelfPosition };
    if (ocx > cx && (!right || ocx < right.cx)) right = { cx: ocx, position: other.shelfPosition };
  }
  if (left && right) return (left.position + right.position) / 2;
  if (left) return left.position + 0.5;
  if (right) return right.position - 0.5;
  return null;
}

function isBBox(v: unknown): v is BBox {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return [b.x0, b.y0, b.x1, b.y1].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** The owner recognised the book on an unread spine: creates the book and removes the unread spine. */
export async function resolveUnreadSpine(collectionId: string, spineId: string, input: unknown): Promise<BookRow> {
  if (!isUuid(spineId)) throw new HttpError(404, 'not_found');
  const p = parseOr400(resolveUnreadSpineSchema, input);
  const [spine] = await db()
    .select()
    .from(unreadSpines)
    .where(and(eq(unreadSpines.id, spineId), eq(unreadSpines.collectionId, collectionId)))
    .limit(1);
  if (!spine) throw new HttpError(404, 'not_found');

  // the photo is copied before the book exists, so the book never points at a missing file
  const bookId = randomUUID();
  let spinePath: string | null = null;
  if (spine.spinePath) {
    const target = rel.spine(collectionId, bookId);
    try {
      await fs.copyFile(abs(spine.spinePath), await ensureDirFor(target));
      spinePath = target;
    } catch (err) {
      console.warn('[api] unread spine photo missing', { collectionId, spineId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  let book: BookRow;
  try {
    book = await db().transaction(async (tx) => {
      const [col] = await tx.select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId)).for('update');
      if (!col) throw new HttpError(404, 'not_found');
      // named or discarded meanwhile (another tab)
      const [locked] = await tx.select().from(unreadSpines).where(eq(unreadSpines.id, spineId)).for('update');
      if (!locked) throw new HttpError(404, 'not_found');
      const [stats] = await tx
        .select({ n: count(), maxPos: max(books.shelfPosition) })
        .from(books)
        .where(eq(books.collectionId, collectionId));
      if (Number(stats?.n ?? 0) >= env().MAX_BOOKS_PER_COLLECTION) throw new HttpError(400, 'too_many_books');

      const [video] = await tx.select({ id: videos.id, kind: videos.kind }).from(videos).where(eq(videos.id, locked.videoId));
      const [frame] = locked.frameId
        ? await tx.select({ id: frames.id, timeSec: frames.timeSec }).from(frames).where(eq(frames.id, locked.frameId))
        : [];
      const bbox = isBBox(locked.bbox) ? locked.bbox : null;

      let shelfPosition: number | null = null;
      if (frame && bbox) {
        const others = await tx
          .select({ bbox: detections.bbox, shelfPosition: books.shelfPosition })
          .from(detections)
          .innerJoin(books, eq(books.id, detections.bookId))
          .where(and(eq(detections.frameId, frame.id), isNotNull(detections.bbox)));
        shelfPosition = shelfPositionBetween(
          bbox,
          others.filter((o): o is PlacedBox => isBBox(o.bbox)),
        );
      }
      shelfPosition ??= stats?.maxPos === null || stats?.maxPos === undefined ? 0 : Number(stats.maxPos) + 1;

      const author = p.author ?? null;
      const [row] = await tx
        .insert(books)
        .values({
          id: bookId,
          collectionId,
          title: p.title,
          author,
          authorSort: authorSortKey(author),
          titleSort: titleSortKey(p.title),
          source: video?.kind === 'image' ? 'image' : 'video',
          confidence: 1,
          needsReview: false,
          reviewed: true,
          spinePath,
          spineColor: locked.spineColor,
          bestFrameId: frame && bbox ? frame.id : null,
          bestBbox: frame && bbox ? bbox : null,
          firstVideoId: video?.id ?? null,
          firstTimeSec: frame?.timeSec ?? null,
          shelfPosition,
          detectionCount: frame ? 1 : 0,
          // what the owner typed is theirs: enrichment fills the rest but never rewrites these
          enrichment: { userEdited: true, userEditedFields: author ? ['title', 'author'] : ['title'] },
        })
        .returning();
      if (video && frame) {
        await tx.insert(detections).values({
          collectionId,
          videoId: video.id,
          frameId: frame.id,
          bookId,
          rawAuthor: author,
          rawTitle: p.title,
          confidence: 1,
          bbox,
          provider: 'owner',
          model: 'review',
        });
        await tx
          .update(videos)
          .set({ booksFound: sql`${videos.booksFound} + 1` })
          .where(eq(videos.id, video.id));
      }
      await tx.delete(unreadSpines).where(eq(unreadSpines.id, spineId));
      await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
      return row;
    });
  } catch (err) {
    if (spinePath) await fs.rm(abs(spinePath), { force: true }).catch(() => {});
    throw err;
  }

  await removeStoredFiles([spine.spinePath]);
  try {
    await enqueueJob(
      'enrich_collection',
      { collectionId },
      { dedupeKey: collectionId, dedupeQueuedOnly: true, runAt: new Date(Date.now() + ENRICH_AFTER_NAMING_MS) },
    );
  } catch (err) {
    console.warn('[api] enrichment after naming a spine not queued', { collectionId, error: err instanceof Error ? err.message : String(err) });
  }
  console.info('[api] unread spine named', { collectionId, spineId, bookId });
  return book;
}

/** The owner discarded an unread spine (not a book, or a book already in the catalogue). */
export async function dismissUnreadSpine(collectionId: string, spineId: string): Promise<void> {
  if (!isUuid(spineId)) throw new HttpError(404, 'not_found');
  const [gone] = await db()
    .delete(unreadSpines)
    .where(and(eq(unreadSpines.id, spineId), eq(unreadSpines.collectionId, collectionId)))
    .returning({ spinePath: unreadSpines.spinePath });
  if (!gone) throw new HttpError(404, 'not_found');
  await removeStoredFiles([gone.spinePath]);
}

/**
 * Owner's tags of a recording (`videos.tags`) and how they reach its books (`books.tags`). Server-only.
 *
 * A book carries the tags of every recording it was found in (merge adds them), plus the ones the owner
 * gave it directly. Changing a recording's tags adds the new ones to its books and removes the dropped ones
 * from them – unless another recording of the same book still has that tag.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { books, detections, videos, type VideoRow } from '@/db/schema';
import { HttpError } from '@/lib/http';
import { dedupeTags } from './validation';

const fold = (tag: string) => tag.toLocaleLowerCase('hu');

/** `current` plus `add` (case-insensitive, first spelling kept), without the `remove` ones. */
export function applyTagChange(current: readonly string[], add: readonly string[], remove: readonly string[] = []): string[] {
  const drop = new Set(remove.map(fold));
  return dedupeTags([...current, ...add]).filter((t) => !drop.has(fold(t)));
}

/** Tags of `next` missing from `prev` and the other way round (case-insensitive). */
export function tagDiff(prev: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  const p = new Set(prev.map(fold));
  const n = new Set(next.map(fold));
  return { added: next.filter((t) => !p.has(fold(t))), removed: prev.filter((t) => !n.has(fold(t))) };
}

/** Sets a recording's tags and updates the books found in it. Returns the updated recording. */
export async function setSourceTags(videoId: string, tags: string[]): Promise<VideoRow> {
  return db().transaction(async (tx) => {
    const [video] = await tx.select().from(videos).where(eq(videos.id, videoId)).for('update');
    if (!video) throw new HttpError(404, 'not_found');
    const next = dedupeTags(tags);
    const { added, removed } = tagDiff(video.tags ?? [], next);
    const [updated] = await tx.update(videos).set({ tags: next }).where(eq(videos.id, videoId)).returning();
    if (!added.length && !removed.length) return updated;

    const bookRows = await tx
      .selectDistinct({ id: books.id, tags: books.tags })
      .from(books)
      .innerJoin(detections, eq(detections.bookId, books.id))
      .where(and(eq(detections.videoId, videoId), eq(books.collectionId, video.collectionId)));
    if (!bookRows.length) return updated;

    // a removed tag stays on a book that another recording with that tag also found
    const keep = new Map<string, Set<string>>();
    if (removed.length) {
      const others = await tx
        .selectDistinct({ bookId: detections.bookId, tags: videos.tags })
        .from(detections)
        .innerJoin(videos, eq(videos.id, detections.videoId))
        .where(and(inArray(detections.bookId, bookRows.map((b) => b.id)), ne(detections.videoId, videoId)));
      for (const o of others) {
        if (!o.bookId) continue;
        const set = keep.get(o.bookId) ?? new Set<string>();
        for (const t of o.tags ?? []) set.add(fold(t));
        keep.set(o.bookId, set);
      }
    }
    const now = new Date();
    for (const b of bookRows) {
      const kept = keep.get(b.id);
      const drop = removed.filter((t) => !kept?.has(fold(t)));
      const nextTags = applyTagChange(b.tags ?? [], added, drop);
      await tx.update(books).set({ tags: nextTags, updatedAt: now }).where(eq(books.id, b.id));
    }
    return updated;
  });
}

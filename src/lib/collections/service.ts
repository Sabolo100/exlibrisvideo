/**
 * Collection / book / source mutations (owner: api). Server-only.
 *
 * Callers (route handlers) are responsible for authentication (owner checks). Every function here
 * validates its input again, uses transactions for multi-row changes, and removes files only after
 * the database commit succeeded.
 */
import fs from 'node:fs/promises';
import { count, eq, inArray, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DB } from '@/db';
import { books, collections, detections, unreadSpines, videos, type BookRow, type CollectionRow, type NewBookRow } from '@/db/schema';
import { env } from '@/lib/env';
import { HttpError, zodIssues } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { authorSortKey, titleSortKey } from '@/lib/pipeline/text';
import { hashPin, isValidPin, newCollectionId, newOwnerToken, sha256Hex } from '@/lib/security/tokens';
import { abs, removeCollectionFiles } from '@/lib/storage';
import type { BBox, CollectionStatus, Locale } from '@/lib/types';
import {
  bookPatchSchema,
  collectionPatchSchema,
  createCollectionSchema,
  newBookSchema,
  normalizeEmail,
  type ValidBookPatch,
} from './validation';

export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
type Executor = DB | Tx;

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

export function parseOr400<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(400, 'invalid', { issues: zodIssues(parsed.error) });
  return parsed.data;
}

/** pg unique_violation (drizzle may wrap the driver error in `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e && typeof e === 'object'; depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Best-effort removal of stored files / per-source directories (relative paths). Never throws.
 * Only paths at least `<area>/<collectionId>/<name>` deep are touched, so a corrupt value can never
 * wipe a whole storage area or collection.
 */
export async function removeStoredFiles(paths: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  await Promise.all(
    unique.map(async (p) => {
      const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
      if (segments.length < 3 || segments.some((s) => s === '..' || s === '.') || !/^[1-9][0-9]{8}$/.test(segments[1])) {
        console.warn('[api] refusing to remove unexpected storage path', { path: p });
        return;
      }
      try {
        await fs.rm(abs(p), { force: true, recursive: true });
      } catch (err) {
        console.warn('[api] could not remove stored file', { path: p, error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return (a ?? null) === (b ?? null);
}

function union(...lists: unknown[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const v of list) if (typeof v === 'string' && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Bibliographic fields: a user edit marks `enrichment.userEdited` so enrichment never overwrites it. */
export const BIBLIOGRAPHIC_FIELDS = [
  'title',
  'subtitle',
  'author',
  'originalTitle',
  'series',
  'publisher',
  'language',
  'firstPublishedYear',
  'editionYear',
  'isbn',
  'pageCount',
  'category',
  'topics',
  'tags',
] as const;

const PATCHABLE_FIELDS = [
  ...BIBLIOGRAPHIC_FIELDS,
  'readingStatus',
  'rating',
  'favorite',
  'notes',
  'lentTo',
  'lentAt',
  'reviewed',
  'needsReview',
] as const satisfies readonly (keyof ValidBookPatch & keyof BookRow)[];

type PatchableField = (typeof PATCHABLE_FIELDS)[number];

function enrichmentWithUserEdits(current: unknown, fields: string[]): Record<string, unknown> {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return {
    ...base,
    userEdited: true,
    userEditedFields: union(base.userEditedFields, fields),
  };
}

/* ------------------------------------------------------------------ */
/* collections                                                          */
/* ------------------------------------------------------------------ */

export interface CreateCollectionInput {
  title?: string | null;
  ownerName?: string | null;
  email?: string | null;
  locale?: Locale;
}

/** Creates a draft collection with a fresh owner token (retries the random id on collision). */
export async function createCollection(
  input: CreateCollectionInput,
): Promise<{ collection: CollectionRow; ownerToken: string }> {
  const p = parseOr400(createCollectionSchema, input);
  const email = normalizeEmail(p.email);
  if (email === false) throw new HttpError(400, 'bad_email');
  const ownerToken = newOwnerToken();
  const ownerTokenHash = sha256Hex(ownerToken);

  for (let attempt = 0; attempt < 10; attempt++) {
    const id = newCollectionId();
    try {
      const [row] = await db()
        .insert(collections)
        .values({
          id,
          ownerTokenHash,
          title: p.title ?? null,
          ownerName: p.ownerName ?? null,
          email,
          locale: p.locale ?? 'hu',
        })
        .onConflictDoNothing({ target: collections.id })
        .returning();
      if (row) return { collection: row, ownerToken };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Could not allocate a unique collection id');
}

/**
 * Applies a CollectionPatch. Visibility rules:
 *  - `pin: "1234"` sets/changes the PIN (and switches to 'pin' unless visibility 'link' is sent too)
 *  - `pin: null` clears the PIN and switches to 'link'; `pin: ""` means "unchanged"
 *  - `visibility: 'pin'` needs a new PIN or an existing one; `visibility: 'link'` clears the PIN
 * A new PIN hash invalidates every PIN cookie.
 */
export async function updateCollection(collectionId: string, patch: unknown): Promise<CollectionRow> {
  const p = parseOr400(collectionPatchSchema, patch);
  const email = p.email !== undefined ? normalizeEmail(p.email) : undefined;
  if (email === false) throw new HttpError(400, 'bad_email');
  const pin = p.pin === '' ? undefined : p.pin;
  // A new PIN only matters when the result is 'pin' (an explicit visibility 'link' ignores it). scrypt runs
  // before the row lock is taken.
  let newPinHash: string | undefined;
  if (typeof pin === 'string' && p.visibility !== 'link') {
    if (!isValidPin(pin)) throw new HttpError(400, 'pin_format');
    newPinHash = await hashPin(pin);
  }

  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(collections).where(eq(collections.id, collectionId)).for('update');
    if (!row) throw new HttpError(404, 'not_found');

    const set: Partial<typeof collections.$inferInsert> = {};
    if (p.title !== undefined) set.title = p.title;
    if (p.description !== undefined) set.description = p.description;
    if (p.ownerName !== undefined) set.ownerName = p.ownerName;
    if (p.locale !== undefined) set.locale = p.locale;
    if (email !== undefined) set.email = email;

    if (p.visibility !== undefined || pin !== undefined) {
      const target = p.visibility ?? (typeof pin === 'string' ? 'pin' : pin === null ? 'link' : row.visibility);
      if (target === 'link') {
        set.visibility = 'link';
        set.pinHash = null;
      } else {
        if (newPinHash !== undefined) {
          set.pinHash = newPinHash;
        } else if (pin === null || !row.pinHash) {
          throw new HttpError(400, 'pin_format');
        }
        set.visibility = 'pin';
      }
    }

    if (Object.keys(set).length === 0) return row;
    set.updatedAt = new Date();
    const [updated] = await tx.update(collections).set(set).where(eq(collections.id, collectionId)).returning();
    return updated;
  });
}

/** Deletes the collection (rows cascade), its queued jobs and every stored file. */
export async function deleteCollection(collectionId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const videoIds = (await tx.select({ id: videos.id }).from(videos).where(eq(videos.collectionId, collectionId))).map(
      (v) => v.id,
    );
    const deleted = await tx.delete(collections).where(eq(collections.id, collectionId)).returning({ id: collections.id });
    if (deleted.length === 0) throw new HttpError(404, 'not_found');
    await tx.execute(sql`
      DELETE FROM jobs
      WHERE status = 'queued'
        AND (payload->>'collectionId' = ${collectionId}
             ${videoIds.length > 0 ? sql`OR payload->>'videoId' IN ${videoIds}` : sql``})
    `);
  });
  await removeCollectionFiles(collectionId);
  console.info('[api] collection deleted', { collectionId });
}

/**
 * Recomputes `collections.status` from its sources:
 *  - any uploaded source pending/queued/processing → processing
 *  - no uploaded sources → ready when books exist (manual), else draft
 *  - every uploaded source failed → error
 *  - otherwise (all finished, ≥1 done): stays processing while enrichment/finalize is queued or running;
 *    when the collection was processing but nothing is pending, `needsEnrichment` is true (caller enqueues)
 */
export async function recomputeCollectionStatus(
  collectionId: string,
  executor: Executor = db(),
): Promise<{ status: CollectionStatus; needsEnrichment: boolean }> {
  const [col] = await executor.select({ status: collections.status }).from(collections).where(eq(collections.id, collectionId));
  if (!col) return { status: 'draft', needsEnrichment: false };

  const sources = await executor
    .select({ status: videos.status, uploadStatus: videos.uploadStatus })
    .from(videos)
    .where(eq(videos.collectionId, collectionId));
  const uploaded = sources.filter((s) => s.uploadStatus === 'uploaded');

  let status: CollectionStatus;
  let needsEnrichment = false;
  if (uploaded.some((s) => s.status === 'pending' || s.status === 'queued' || s.status === 'processing')) {
    status = 'processing';
  } else if (uploaded.length === 0) {
    const [r] = await executor.select({ n: count() }).from(books).where(eq(books.collectionId, collectionId));
    status = Number(r?.n ?? 0) > 0 ? 'ready' : 'draft';
  } else if (uploaded.every((s) => s.status === 'error')) {
    status = 'error';
  } else if (col.status === 'processing') {
    status = 'processing';
    const pending = await executor.execute(sql`
      SELECT 1 FROM jobs
      WHERE type IN ('enrich_collection', 'finalize_collection')
        AND status IN ('queued', 'running')
        AND payload->>'collectionId' = ${collectionId}
      LIMIT 1
    `);
    needsEnrichment = pending.rows.length === 0;
  } else {
    status = 'ready';
  }

  if (status !== col.status) {
    await executor.update(collections).set({ status, updatedAt: new Date() }).where(eq(collections.id, collectionId));
  }
  return { status, needsEnrichment };
}

/* ------------------------------------------------------------------ */
/* books                                                                */
/* ------------------------------------------------------------------ */

/** Adds a manually entered book at the end of the shelf (`source='manual'`, reviewed). */
export async function addManualBook(collectionId: string, input: unknown): Promise<BookRow> {
  const p = parseOr400(newBookSchema, input);
  return db().transaction(async (tx) => {
    const [col] = await tx
      .select({ id: collections.id, status: collections.status })
      .from(collections)
      .where(eq(collections.id, collectionId))
      .for('update');
    if (!col) throw new HttpError(404, 'not_found');
    const [stats] = await tx
      .select({ n: count(), maxPos: max(books.shelfPosition) })
      .from(books)
      .where(eq(books.collectionId, collectionId));
    if (Number(stats?.n ?? 0) >= env().MAX_BOOKS_PER_COLLECTION) throw new HttpError(400, 'too_many_books');

    const provided = BIBLIOGRAPHIC_FIELDS.filter((f) => p[f] !== undefined && p[f] !== null);
    const values: NewBookRow = {
      collectionId,
      title: p.title,
      subtitle: p.subtitle ?? null,
      author: p.author ?? null,
      originalTitle: p.originalTitle ?? null,
      series: p.series ?? null,
      publisher: p.publisher ?? null,
      language: p.language ?? null,
      firstPublishedYear: p.firstPublishedYear ?? null,
      editionYear: p.editionYear ?? null,
      isbn: p.isbn ?? null,
      pageCount: p.pageCount ?? null,
      category: p.category ?? null,
      topics: p.topics ?? [],
      tags: p.tags ?? [],
      readingStatus: p.readingStatus ?? 'unknown',
      rating: p.rating ?? null,
      favorite: p.favorite ?? false,
      notes: p.notes ?? null,
      lentTo: p.lentTo ?? null,
      lentAt: p.lentAt ?? null,
      authorSort: authorSortKey(p.author ?? null, p.language ?? null),
      titleSort: titleSortKey(p.title),
      source: 'manual',
      confidence: 1,
      needsReview: p.needsReview ?? false,
      reviewed: p.reviewed ?? true,
      detectionCount: 0,
      shelfPosition: stats?.maxPos === null || stats?.maxPos === undefined ? 0 : Number(stats.maxPos) + 1,
      enrichment: { userEdited: true, userEditedFields: provided },
    };
    const [row] = await tx.insert(books).values(values).returning();
    await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));
    // A draft without uploaded sources that now has a book is a (manual) catalogue: show it as ready,
    // and keep it out of the empty-draft retention purge.
    if (col.status === 'draft') await recomputeCollectionStatus(collectionId, tx);
    return row;
  });
}

/**
 * Validates and applies a BookPatch (taxonomy keys, rating 1–5, years 1000–2100, trimmed text).
 * Recomputes sort keys when author/title/language change and records bibliographic edits in
 * `enrichment.userEdited` / `enrichment.userEditedFields`.
 */
export async function updateBook(bookId: string, patch: unknown): Promise<BookRow> {
  const p = parseOr400(bookPatchSchema, patch);
  return db().transaction(async (tx) => {
    const [book] = await tx.select().from(books).where(eq(books.id, bookId)).for('update');
    if (!book) throw new HttpError(404, 'not_found');

    const set: Partial<NewBookRow> = {};
    const changed: PatchableField[] = [];
    for (const field of PATCHABLE_FIELDS) {
      const value = p[field];
      if (value === undefined) continue;
      if (sameValue(value, book[field])) continue;
      (set as Record<string, unknown>)[field] = value;
      changed.push(field);
    }
    // Accepting a book in review clears the review flag unless the client says otherwise.
    if (p.reviewed === true && p.needsReview === undefined && book.needsReview) {
      set.needsReview = false;
      changed.push('needsReview');
    }
    if (changed.length === 0) return book;

    const nextTitle = set.title ?? book.title;
    const nextAuthor = set.author !== undefined ? set.author : book.author;
    const nextLanguage = set.language !== undefined ? set.language : book.language;
    if (changed.includes('title')) set.titleSort = titleSortKey(nextTitle);
    if (changed.includes('author') || changed.includes('language')) set.authorSort = authorSortKey(nextAuthor, nextLanguage);

    const biblio = changed.filter((f): f is (typeof BIBLIOGRAPHIC_FIELDS)[number] =>
      (BIBLIOGRAPHIC_FIELDS as readonly string[]).includes(f),
    );
    if (biblio.length > 0) set.enrichment = enrichmentWithUserEdits(book.enrichment, biblio);
    set.updatedAt = new Date();

    const [updated] = await tx.update(books).set(set).where(eq(books.id, bookId)).returning();
    return updated;
  });
}

export async function deleteBook(bookId: string): Promise<void> {
  const [deleted] = await db()
    .delete(books)
    .where(eq(books.id, bookId))
    .returning({ spinePath: books.spinePath, coverPath: books.coverPath });
  if (!deleted) throw new HttpError(404, 'not_found');
  await removeStoredFiles([deleted.spinePath, deleted.coverPath]);
}

const FILLABLE_FIELDS = [
  'subtitle',
  'author',
  'spineAuthor',
  'spineTitle',
  'originalTitle',
  'series',
  'publisher',
  'language',
  'originalLanguage',
  'authorCountry',
  'firstPublishedYear',
  'editionYear',
  'isbn',
  'pageCount',
  'category',
  'descriptionHu',
  'descriptionEn',
  'coverUrl',
  'coverPath',
  'enrichedAt',
  'enrichment',
  'firstVideoId',
  'firstTimeSec',
] as const satisfies readonly (keyof BookRow)[];

/**
 * Merges `mergeIds` into `keepId` (all must belong to `collectionId`): detections move to the kept book,
 * detection counts are summed, the best-confidence spine evidence is kept, topics/tags are united, empty
 * bibliographic fields are filled from the merged books, the kept book's owner fields stay as they are.
 */
export async function mergeBooks(collectionId: string, keepId: string, mergeIds: string[]): Promise<BookRow> {
  const ids = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (ids.length === 0) throw new HttpError(400, 'invalid', { issues: [{ path: 'mergeIds', code: 'empty', message: 'Nothing to merge' }] });

  const { updated, filesToRemove } = await db().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(books)
      .where(inArray(books.id, [keepId, ...ids]))
      .orderBy(books.id)
      .for('update');
    const keep = rows.find((r) => r.id === keepId);
    if (!keep || rows.length !== ids.length + 1 || rows.some((r) => r.collectionId !== collectionId)) {
      throw new HttpError(404, 'not_found');
    }
    const others = rows.filter((r) => r.id !== keepId).sort((a, b) => b.confidence - a.confidence);
    const all = [keep, ...others];

    await tx.update(detections).set({ bookId: keepId }).where(inArray(detections.bookId, ids));

    const set: Partial<NewBookRow> = {
      detectionCount: all.reduce((s, b) => s + (b.detectionCount ?? 0), 0),
      confidence: Math.max(...all.map((b) => b.confidence)),
      topics: union(keep.topics, ...others.map((b) => b.topics)),
      tags: union(keep.tags, ...others.map((b) => b.tags)),
      needsReview: false,
      reviewed: true,
      updatedAt: new Date(),
    };

    // Spine evidence travels as a unit (crop, colour, frame, bbox) from the most confident book that has it.
    const byConfidence = [...all].sort((a, b) => b.confidence - a.confidence || (a.id === keepId ? -1 : b.id === keepId ? 1 : 0));
    const evidence = byConfidence.find((b) => b.spinePath) ?? byConfidence.find((b) => b.bestBbox);
    if (evidence && evidence.id !== keepId) {
      set.spinePath = evidence.spinePath;
      set.spineColor = evidence.spineColor ?? keep.spineColor;
      set.bestFrameId = evidence.bestFrameId;
      set.bestBbox = evidence.bestBbox as BBox | null;
    }

    for (const field of FILLABLE_FIELDS) {
      if (keep[field] !== null && keep[field] !== undefined) continue;
      const donor = others.find((b) => b[field] !== null && b[field] !== undefined);
      if (donor) (set as Record<string, unknown>)[field] = donor[field];
    }
    if (set.author !== undefined) set.authorSort = authorSortKey(set.author, set.language ?? keep.language);

    const [row] = await tx.update(books).set(set).where(eq(books.id, keepId)).returning();
    await tx.delete(books).where(inArray(books.id, ids));

    // Remove every file no longer referenced: the merged books' files and the kept book's replaced crop.
    const kept = new Set([row.spinePath, row.coverPath].filter(Boolean));
    const remove = all.flatMap((b) => [b.spinePath, b.coverPath]).filter((p): p is string => !!p && !kept.has(p));
    return { updated: row, filesToRemove: remove };
  });

  await removeStoredFiles(filesToRemove);
  return updated;
}

/* ------------------------------------------------------------------ */
/* sources                                                              */
/* ------------------------------------------------------------------ */

/**
 * Removes a source (video/photo): its file, frames, detections and every book whose evidence came only
 * from this source (manual and reviewed books are kept). Books with other evidence get their detection
 * count and best frame re-derived. Recomputes the collection status (and re-enqueues enrichment when
 * the deleted source was the last one the collection was waiting for).
 */
export async function deleteSource(videoId: string): Promise<{ collectionId: string; deletedBookIds: string[] }> {
  const outcome = await db().transaction(async (tx) => {
    const [video] = await tx.select().from(videos).where(eq(videos.id, videoId)).for('update');
    if (!video) throw new HttpError(404, 'not_found');
    await tx.select({ id: collections.id }).from(collections).where(eq(collections.id, video.collectionId)).for('update');

    const affected = await tx.execute(sql`
      SELECT b.id, b.source, b.reviewed, b.spine_path, b.cover_path,
             EXISTS (SELECT 1 FROM detections d2 WHERE d2.book_id = b.id AND d2.video_id <> ${videoId}) AS has_other
      FROM books b
      WHERE b.collection_id = ${video.collectionId}
        AND (b.id IN (SELECT d.book_id FROM detections d WHERE d.video_id = ${videoId} AND d.book_id IS NOT NULL)
             OR b.first_video_id = ${videoId})
    `);
    type AffectedRow = { id: string; source: string; reviewed: boolean; spine_path: string | null; cover_path: string | null; has_other: boolean };
    const rows = affected.rows as AffectedRow[];
    const toDelete = rows.filter((r) => !r.has_other && r.source !== 'manual' && !r.reviewed);
    const toKeep = rows.filter((r) => !toDelete.includes(r)).map((r) => r.id);

    if (toDelete.length > 0) {
      await tx.delete(books).where(inArray(books.id, toDelete.map((r) => r.id)));
    }

    if (toKeep.length > 0) {
      await tx.execute(sql`
        UPDATE books b SET
          detection_count = (SELECT count(*) FROM detections d WHERE d.book_id = b.id AND d.video_id <> ${videoId}),
          updated_at = now()
        WHERE b.id IN ${toKeep}
      `);
      // Re-pick the best evidence frame for books whose best frame belonged to this source.
      await tx.execute(sql`
        UPDATE books b SET best_frame_id = best.frame_id, best_bbox = best.bbox
        FROM (
          SELECT DISTINCT ON (d.book_id) d.book_id, d.frame_id, d.bbox
          FROM detections d
          WHERE d.book_id IN ${toKeep} AND d.video_id <> ${videoId} AND d.frame_id IS NOT NULL AND d.bbox IS NOT NULL
          ORDER BY d.book_id, d.confidence DESC
        ) best
        WHERE b.id = best.book_id
          AND b.best_frame_id IN (SELECT f.id FROM frames f WHERE f.video_id = ${videoId})
      `);
      await tx.execute(sql`
        UPDATE books SET best_frame_id = NULL, best_bbox = NULL
        WHERE id IN ${toKeep} AND best_frame_id IN (SELECT f.id FROM frames f WHERE f.video_id = ${videoId})
      `);
      await tx.execute(sql`
        UPDATE books b SET first_video_id = fv.video_id, first_time_sec = fv.time_sec
        FROM (
          SELECT DISTINCT ON (d.book_id) d.book_id, d.video_id, f.time_sec
          FROM detections d
          JOIN frames f ON f.id = d.frame_id
          JOIN videos v ON v.id = d.video_id
          WHERE d.book_id IN ${toKeep} AND d.video_id <> ${videoId}
          ORDER BY d.book_id, v.sort_order, f.time_sec
        ) fv
        WHERE b.id = fv.book_id AND b.first_video_id = ${videoId}
      `);
      await tx.execute(sql`
        UPDATE books SET first_video_id = NULL, first_time_sec = NULL
        WHERE id IN ${toKeep} AND first_video_id = ${videoId}
      `);
    }

    await tx.execute(sql`
      DELETE FROM jobs WHERE type = 'process_video' AND status = 'queued' AND payload->>'videoId' = ${videoId}
    `);
    const unread = await tx.delete(unreadSpines).where(eq(unreadSpines.videoId, videoId)).returning({ spinePath: unreadSpines.spinePath });
    await tx.delete(videos).where(eq(videos.id, videoId));
    const recomputed = await recomputeCollectionStatus(video.collectionId, tx);
    await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, video.collectionId));

    return { video, toDelete, recomputed, unreadPaths: unread.map((u) => u.spinePath) };
  });

  const { video, toDelete, recomputed, unreadPaths } = outcome;
  await removeStoredFiles([
    video.storagePath,
    `frames/${video.collectionId}/${video.id}`,
    ...toDelete.flatMap((r) => [r.spine_path, r.cover_path]),
    ...unreadPaths,
  ]);
  if (recomputed.needsEnrichment) {
    await enqueueJob('enrich_collection', { collectionId: video.collectionId }, { dedupeKey: video.collectionId });
  }
  console.info('[api] source deleted', {
    collectionId: video.collectionId,
    videoId,
    deletedBooks: toDelete.length,
    status: recomputed.status,
  });
  return { collectionId: video.collectionId, deletedBookIds: toDelete.map((r) => r.id) };
}

export { countCollectionView, recordCollectionView } from './views';

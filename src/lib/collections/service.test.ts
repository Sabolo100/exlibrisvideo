import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testEnv = vi.hoisted(() => {
  const base = (process.env.EXL_TEST_TMP || process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/exl-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.STORAGE_DIR = dir;
  process.env.MAX_BOOKS_PER_COLLECTION = '5';
  return { dir };
});

vi.mock('@/lib/jobs/queue', () => ({
  enqueueJob: vi.fn(async () => 1),
}));

vi.mock('@/lib/pipeline/text', () => ({
  authorSortKey: vi.fn((author: string | null | undefined) => (author ? `sort:${author.toLowerCase()}` : null)),
  titleSortKey: vi.fn((title: string) => `title:${title.toLowerCase()}`),
}));

import { db, pool } from '@/db';
import { books, collections, detections, frames, videos, type BookRow } from '@/db/schema';
import { HttpError } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { verifyPin } from '@/lib/security/tokens';
import { abs } from '@/lib/storage';
import {
  addManualBook,
  createCollection,
  deleteCollection,
  deleteSource,
  mergeBooks,
  recomputeCollectionStatus,
  updateBook,
  updateCollection,
} from './service';

const dbAvailable = await pool()
  .query('SELECT 1 FROM collections LIMIT 1')
  .then(() => true)
  .catch(() => false);

const created: string[] = [];

async function newCollection(over: { email?: string } = {}) {
  const { collection, ownerToken } = await createCollection({ title: 'Teszt', locale: 'hu', ...over });
  created.push(collection.id);
  return { collection, ownerToken };
}

async function insertBook(collectionId: string, over: Partial<typeof books.$inferInsert> = {}): Promise<BookRow> {
  const [row] = await db()
    .insert(books)
    .values({ collectionId, title: 'Könyv', ...over })
    .returning();
  return row;
}

async function expectHttpError(p: Promise<unknown>, status: number, key?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (key) expect((err as HttpError).key).toBe(key);
  return err as HttpError;
}

describe.skipIf(!dbAvailable)('collections service (PostgreSQL)', () => {
  beforeAll(async () => {
    await fs.mkdir(testEnv.dir, { recursive: true });
  });

  afterAll(async () => {
    if (created.length > 0) await db().delete(collections).where(inArray(collections.id, created));
    await fs.rm(testEnv.dir, { recursive: true, force: true });
    await pool().end();
  });

  describe('createCollection / updateCollection', () => {
    it('creates a draft with a hashed owner token and normalised e-mail', async () => {
      const { collection, ownerToken } = await newCollection({ email: '  Kata.Konyv@Example.COM ' });
      expect(collection.id).toMatch(/^[1-9]\d{8}$/);
      expect(collection.status).toBe('draft');
      expect(collection.email).toBe('kata.konyv@example.com');
      expect(collection.ownerTokenHash).not.toContain(ownerToken);
      expect(collection.ownerTokenHash).toMatch(/^[0-9a-f]{64}$/);
      await expectHttpError(createCollection({ email: 'not-an-email', locale: 'hu' }), 400, 'bad_email');
    });

    it('validates e-mail and text fields on update', async () => {
      const { collection } = await newCollection();
      const updated = await updateCollection(collection.id, { title: '  Nappali  ', description: '', email: 'A@B.hu' });
      expect(updated.title).toBe('Nappali');
      expect(updated.description).toBeNull();
      expect(updated.email).toBe('a@b.hu');
      await expectHttpError(updateCollection(collection.id, { email: 'a@b@c' }), 400, 'bad_email');
      await expectHttpError(updateCollection(collection.id, { title: 'x'.repeat(201) }), 400, 'invalid');
      await expectHttpError(updateCollection('999999998', { title: 'x' }), 404, 'not_found');
      expect((await updateCollection(collection.id, { email: null })).email).toBeNull();
    });

    it('applies PIN visibility rules', async () => {
      const { collection } = await newCollection();
      await expectHttpError(updateCollection(collection.id, { visibility: 'pin' }), 400, 'pin_format');
      await expectHttpError(updateCollection(collection.id, { pin: '12' }), 400, 'pin_format');
      await expectHttpError(updateCollection(collection.id, { pin: '12ab' }), 400, 'pin_format');

      const withPin = await updateCollection(collection.id, { pin: '4321' });
      expect(withPin.visibility).toBe('pin');
      expect(await verifyPin('4321', withPin.pinHash)).toBe(true);

      // switching to pin again without a new PIN keeps the existing hash; "" means unchanged
      const same = await updateCollection(collection.id, { visibility: 'pin', pin: '' });
      expect(same.pinHash).toBe(withPin.pinHash);

      const changed = await updateCollection(collection.id, { pin: '98765432' });
      expect(changed.pinHash).not.toBe(withPin.pinHash);
      expect(await verifyPin('98765432', changed.pinHash)).toBe(true);

      await expectHttpError(updateCollection(collection.id, { visibility: 'pin', pin: null }), 400, 'pin_format');

      const cleared = await updateCollection(collection.id, { pin: null });
      expect(cleared.visibility).toBe('link');
      expect(cleared.pinHash).toBeNull();

      await updateCollection(collection.id, { visibility: 'pin', pin: '1111' });
      const link = await updateCollection(collection.id, { visibility: 'link', pin: '2222' });
      expect(link).toMatchObject({ visibility: 'link', pinHash: null });
      // an explicit switch to 'link' ignores a stale / half-typed PIN field
      expect(await updateCollection(collection.id, { visibility: 'link', pin: '12' })).toMatchObject({ visibility: 'link', pinHash: null });
    });
  });

  describe('updateBook', () => {
    it('rejects invalid values', async () => {
      const { collection } = await newCollection();
      const book = await insertBook(collection.id);
      const cases: [Record<string, unknown>, string][] = [
        [{ rating: 6 }, 'rating'],
        [{ rating: 0 }, 'rating'],
        [{ rating: 2.5 }, 'rating'],
        [{ firstPublishedYear: 999 }, 'firstPublishedYear'],
        [{ editionYear: 2101 }, 'editionYear'],
        [{ category: 'not_a_topic' }, 'category'],
        [{ topics: ['history', 'bogus'] }, 'topics.1'],
        [{ title: '   ' }, 'title'],
        [{ title: null }, 'title'],
        [{ lentAt: '2026-02-30' }, 'lentAt'],
        [{ readingStatus: 'finished' }, 'readingStatus'],
        [{ pageCount: -3 }, 'pageCount'],
        [{ isbn: 'abc' }, 'isbn'],
        [{ language: 'hungarian' }, 'language'],
        [{ favorite: 'yes' }, 'favorite'],
        [{ tags: ['x'.repeat(61)] }, 'tags.0'],
      ];
      for (const [patch, field] of cases) {
        const err = await expectHttpError(updateBook(book.id, patch), 400, 'invalid');
        const issues = (err.details?.issues ?? []) as { path: string }[];
        expect(issues.map((i) => i.path), JSON.stringify(patch)).toContain(field);
      }
      await expectHttpError(updateBook(randomUUID(), { rating: 3 }), 404, 'not_found');
      const unchanged = await db().select().from(books).where(eq(books.id, book.id));
      expect(unchanged[0].updatedAt.getTime()).toBe(book.updatedAt.getTime());
    });

    it('trims, nulls empty strings, recomputes sort keys and marks bibliographic edits', async () => {
      const { collection } = await newCollection();
      const book = await insertBook(collection.id, { title: 'Régi', author: 'Valaki', needsReview: true, enrichment: { source: 'openlibrary' } });

      const updated = await updateBook(book.id, {
        title: '  Harmonia caelestis ',
        author: ' Esterházy Péter ',
        publisher: '',
        category: 'hungarian_literature',
        topics: ['literary_fiction', 'literary_fiction', 'history'],
        tags: [' családregény ', ''],
        firstPublishedYear: 2000,
        isbn: '978-963-14-2201-2',
        language: 'HU',
        lentAt: '2026-03-01T12:00:00.000Z',
        unknownField: 'ignored',
      });
      expect(updated.title).toBe('Harmonia caelestis');
      expect(updated.author).toBe('Esterházy Péter');
      expect(updated.publisher).toBeNull();
      expect(updated.topics).toEqual(['literary_fiction', 'history']);
      expect(updated.tags).toEqual(['családregény']);
      expect(updated.isbn).toBe('9789631422012');
      expect(updated.language).toBe('hu');
      expect(updated.lentAt).toBe('2026-03-01');
      expect(updated.titleSort).toBe('title:harmonia caelestis');
      expect(updated.authorSort).toBe('sort:esterházy péter');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(book.updatedAt.getTime());
      const enrichment = updated.enrichment as Record<string, unknown>;
      expect(enrichment.source).toBe('openlibrary');
      expect(enrichment.userEdited).toBe(true);
      expect(enrichment.userEditedFields).toEqual(
        expect.arrayContaining(['title', 'author', 'category', 'topics', 'tags', 'firstPublishedYear', 'isbn', 'language']),
      );
      expect(enrichment.userEditedFields).not.toContain('lentAt');
    });

    it('owner-field edits do not mark enrichment; reviewed clears needsReview', async () => {
      const { collection } = await newCollection();
      const book = await insertBook(collection.id, { needsReview: true });
      const updated = await updateBook(book.id, { rating: 4, favorite: true, notes: ' jó ', readingStatus: 'to_read', reviewed: true });
      expect(updated).toMatchObject({ rating: 4, favorite: true, notes: 'jó', readingStatus: 'to_read', reviewed: true, needsReview: false });
      expect(updated.enrichment).toBeNull();
      const cleared = await updateBook(book.id, { rating: null, notes: null });
      expect(cleared).toMatchObject({ rating: null, notes: null });
    });
  });

  describe('addManualBook', () => {
    it('adds at the end of the shelf and enforces MAX_BOOKS_PER_COLLECTION', async () => {
      const { collection } = await newCollection();
      await insertBook(collection.id, { shelfPosition: 100003 });
      const manual = await addManualBook(collection.id, { title: ' Az ember tragédiája ', author: 'Madách Imre', rating: 5 });
      expect(manual).toMatchObject({
        source: 'manual',
        title: 'Az ember tragédiája',
        reviewed: true,
        needsReview: false,
        detectionCount: 0,
        shelfPosition: 100004,
        titleSort: 'title:az ember tragédiája',
      });
      await expectHttpError(addManualBook(collection.id, { title: '' }), 400, 'invalid');
      await expectHttpError(addManualBook('999999997', { title: 'x' }), 404, 'not_found');
      for (let i = 0; i < 3; i++) await addManualBook(collection.id, { title: `Könyv ${i}` });
      await expectHttpError(addManualBook(collection.id, { title: 'Túl sok' }), 400, 'too_many_books');
    });

    it('turns an empty draft into a ready (manual) catalogue, but leaves processing collections alone', async () => {
      const { collection } = await newCollection();
      expect(collection.status).toBe('draft');
      await addManualBook(collection.id, { title: 'Egri csillagok', author: 'Gárdonyi Géza' });
      const [ready] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, collection.id));
      expect(ready.status).toBe('ready');

      const other = await newCollection();
      await db().update(collections).set({ status: 'processing' }).where(eq(collections.id, other.collection.id));
      await db()
        .insert(videos)
        .values({ collectionId: other.collection.id, originalFilename: 'q.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'queued' });
      await addManualBook(other.collection.id, { title: 'Kézi' });
      const [still] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, other.collection.id));
      expect(still.status).toBe('processing');
    });
  });

  describe('mergeBooks', () => {
    it('moves detections, sums counts, keeps the best spine and the target owner fields', async () => {
      const { collection } = await newCollection();
      const [video] = await db()
        .insert(videos)
        .values({ collectionId: collection.id, originalFilename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'done' })
        .returning();
      const [frame] = await db()
        .insert(frames)
        .values({ videoId: video.id, collectionId: collection.id, idx: 1, timeSec: 0.5, storagePath: 'frames/x.jpg', width: 100, height: 100 })
        .returning();

      const keep = await insertBook(collection.id, {
        title: 'Harmonia',
        confidence: 0.5,
        detectionCount: 2,
        topics: ['history'],
        tags: ['a'],
        rating: 3,
        notes: 'keep notes',
        spinePath: `spines/${collection.id}/keep.jpg`,
      });
      const better = await insertBook(collection.id, {
        title: 'Harmonia caelestis',
        author: 'Esterházy Péter',
        confidence: 0.95,
        detectionCount: 3,
        topics: ['literary_fiction', 'history'],
        tags: ['b'],
        rating: 1,
        notes: 'other notes',
        spinePath: `spines/${collection.id}/better.jpg`,
        spineColor: '#112233',
        bestFrameId: frame.id,
        bestBbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
        coverUrl: 'https://covers.openlibrary.org/b/id/5-L.jpg',
      });
      const third = await insertBook(collection.id, { title: 'Harmónia', confidence: 0.2, detectionCount: 1, coverPath: `covers/${collection.id}/third.jpg` });
      for (const p of [keep.spinePath!, better.spinePath!, third.coverPath!]) {
        const f = abs(p);
        await fs.mkdir(path.dirname(f), { recursive: true });
        await fs.writeFile(f, 'jpg');
      }
      await db().insert(detections).values([
        { collectionId: collection.id, videoId: video.id, frameId: frame.id, bookId: better.id, rawTitle: 'x', confidence: 0.9, provider: 'mock', model: 'm' },
        { collectionId: collection.id, videoId: video.id, frameId: frame.id, bookId: third.id, rawTitle: 'y', confidence: 0.2, provider: 'mock', model: 'm' },
      ]);

      const merged = await mergeBooks(collection.id, keep.id, [better.id, third.id, keep.id, better.id]);
      expect(merged).toMatchObject({
        id: keep.id,
        title: 'Harmonia',
        author: 'Esterházy Péter',
        authorSort: 'sort:esterházy péter',
        detectionCount: 6,
        rating: 3,
        notes: 'keep notes',
        spinePath: better.spinePath,
        spineColor: '#112233',
        bestFrameId: frame.id,
        coverUrl: better.coverUrl,
        coverPath: third.coverPath,
        needsReview: false,
        reviewed: true,
      });
      expect(merged.confidence).toBeCloseTo(0.95, 5);
      expect(merged.topics).toEqual(['history', 'literary_fiction']);
      expect(merged.tags).toEqual(['a', 'b']);

      const remaining = await db().select({ id: books.id }).from(books).where(eq(books.collectionId, collection.id));
      expect(remaining.map((b) => b.id)).toEqual([keep.id]);
      const dets = await db().select({ bookId: detections.bookId }).from(detections).where(eq(detections.videoId, video.id));
      expect(dets.every((d) => d.bookId === keep.id)).toBe(true);

      // the replaced spine of the kept book is removed; adopted files stay
      await expect(fs.stat(abs(keep.spinePath!))).rejects.toThrow();
      await expect(fs.stat(abs(better.spinePath!))).resolves.toBeTruthy();
      await expect(fs.stat(abs(third.coverPath!))).resolves.toBeTruthy();
    });

    it('refuses cross-collection and empty merges', async () => {
      const a = await newCollection();
      const b = await newCollection();
      const ka = await insertBook(a.collection.id);
      const kb = await insertBook(b.collection.id);
      await expectHttpError(mergeBooks(a.collection.id, ka.id, [kb.id]), 404, 'not_found');
      await expectHttpError(mergeBooks(b.collection.id, ka.id, [kb.id]), 404, 'not_found');
      await expectHttpError(mergeBooks(a.collection.id, ka.id, [ka.id]), 400, 'invalid');
      await expectHttpError(mergeBooks(a.collection.id, ka.id, [randomUUID()]), 404, 'not_found');
      expect(await db().select().from(books).where(inArray(books.id, [ka.id, kb.id]))).toHaveLength(2);
    });
  });

  describe('deleteSource', () => {
    it('deletes single-source books, keeps shared/manual/reviewed ones and recomputes status', async () => {
      vi.mocked(enqueueJob).mockClear();
      const { collection } = await newCollection();
      await db().update(collections).set({ status: 'processing' }).where(eq(collections.id, collection.id));
      const [va, vb] = await db()
        .insert(videos)
        .values([
          { collectionId: collection.id, sortOrder: 0, originalFilename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 3, uploadStatus: 'uploaded', status: 'done', storagePath: `uploads/${collection.id}/a.mp4` },
          { collectionId: collection.id, sortOrder: 1, originalFilename: 'b.mp4', mimeType: 'video/mp4', sizeBytes: 3, uploadStatus: 'uploaded', status: 'processing' },
        ])
        .returning();
      const [fa, fb] = await db()
        .insert(frames)
        .values([
          { videoId: va.id, collectionId: collection.id, idx: 1, timeSec: 1, storagePath: `frames/${collection.id}/${va.id}/0001.jpg`, width: 10, height: 10 },
          { videoId: vb.id, collectionId: collection.id, idx: 1, timeSec: 2.5, storagePath: `frames/${collection.id}/${vb.id}/0001.jpg`, width: 10, height: 10 },
        ])
        .returning();
      await fs.mkdir(path.dirname(abs(fa.storagePath)), { recursive: true });
      await fs.writeFile(abs(fa.storagePath), 'jpg');
      await fs.mkdir(path.dirname(abs(va.storagePath!)), { recursive: true });
      await fs.writeFile(abs(va.storagePath!), 'mp4');

      const onlyA = await insertBook(collection.id, { title: 'only A', firstVideoId: va.id, bestFrameId: fa.id, spinePath: `spines/${collection.id}/onlyA.jpg`, detectionCount: 1 });
      const shared = await insertBook(collection.id, { title: 'shared', firstVideoId: va.id, firstTimeSec: 1, bestFrameId: fa.id, bestBbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, detectionCount: 2 });
      const reviewed = await insertBook(collection.id, { title: 'reviewed', firstVideoId: va.id, bestFrameId: fa.id, reviewed: true, detectionCount: 1 });
      const manual = await insertBook(collection.id, { title: 'manual', source: 'manual', firstVideoId: va.id, detectionCount: 0 });
      const other = await insertBook(collection.id, { title: 'only B', firstVideoId: vb.id, detectionCount: 1 });
      await fs.mkdir(path.dirname(abs(onlyA.spinePath!)), { recursive: true });
      await fs.writeFile(abs(onlyA.spinePath!), 'jpg');

      const det = (videoId: string, frameId: string, bookId: string, confidence: number) => ({
        collectionId: collection.id, videoId, frameId, bookId, rawTitle: 't', confidence, bbox: { x0: 5, y0: 5, x1: 9, y1: 9 }, provider: 'mock', model: 'm',
      });
      await db().insert(detections).values([
        det(va.id, fa.id, onlyA.id, 0.9),
        det(va.id, fa.id, shared.id, 0.9),
        det(vb.id, fb.id, shared.id, 0.7),
        det(va.id, fa.id, reviewed.id, 0.8),
        det(vb.id, fb.id, other.id, 0.8),
      ]);

      const result = await deleteSource(va.id);
      expect(result.deletedBookIds).toEqual([onlyA.id]);

      const rows = await db().select().from(books).where(eq(books.collectionId, collection.id));
      const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
      expect(Object.keys(byTitle).sort()).toEqual(['manual', 'only B', 'reviewed', 'shared']);
      expect(byTitle.shared).toMatchObject({ detectionCount: 1, bestFrameId: fb.id, firstVideoId: vb.id, bestBbox: { x0: 5, y0: 5, x1: 9, y1: 9 } });
      expect(byTitle.shared.firstTimeSec).toBeCloseTo(2.5);
      expect(byTitle.reviewed).toMatchObject({ detectionCount: 0, bestFrameId: null, bestBbox: null, firstVideoId: null });
      expect(byTitle.manual).toMatchObject({ firstVideoId: null });
      expect(byTitle['only B']).toMatchObject({ detectionCount: 1 });

      expect(await db().select().from(videos).where(eq(videos.id, va.id))).toHaveLength(0);
      expect(await db().select().from(frames).where(eq(frames.videoId, va.id))).toHaveLength(0);
      await expect(fs.stat(abs(va.storagePath!))).rejects.toThrow();
      await expect(fs.stat(abs(`frames/${collection.id}/${va.id}`))).rejects.toThrow();
      await expect(fs.stat(abs(onlyA.spinePath!))).rejects.toThrow();

      // B is still processing → collection stays processing, no extra enrichment
      const [col] = await db().select().from(collections).where(eq(collections.id, collection.id));
      expect(col.status).toBe('processing');
      expect(enqueueJob).not.toHaveBeenCalled();

      // once B is done and nothing is pending, deleting an errored extra source re-triggers enrichment
      await db().update(videos).set({ status: 'done' }).where(eq(videos.id, vb.id));
      const [vc] = await db()
        .insert(videos)
        .values({ collectionId: collection.id, sortOrder: 2, originalFilename: 'c.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'processing' })
        .returning();
      await deleteSource(vc.id);
      expect(enqueueJob).toHaveBeenCalledWith('enrich_collection', { collectionId: collection.id }, { dedupeKey: collection.id });

      await expectHttpError(deleteSource(randomUUID()), 404, 'not_found');
    });

    it('recomputeCollectionStatus covers draft / ready / error', async () => {
      const { collection } = await newCollection();
      expect((await recomputeCollectionStatus(collection.id)).status).toBe('draft');
      await db().insert(videos).values({ collectionId: collection.id, originalFilename: 'e.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'error' });
      expect((await recomputeCollectionStatus(collection.id)).status).toBe('error');
      await db().insert(videos).values({ collectionId: collection.id, originalFilename: 'd.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'done' });
      expect(await recomputeCollectionStatus(collection.id)).toEqual({ status: 'ready', needsEnrichment: false });
      const [col] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, collection.id));
      expect(col.status).toBe('ready');
    });
  });

  describe('deleteCollection', () => {
    it('removes rows, queued jobs and files', async () => {
      const { collection } = await newCollection();
      const [v] = await db()
        .insert(videos)
        .values({ collectionId: collection.id, originalFilename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 1 })
        .returning();
      await insertBook(collection.id);
      const file = abs(`spines/${collection.id}/x.jpg`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'x');
      const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000);
      await db().execute(sql`
        INSERT INTO jobs (type, payload, run_at) VALUES
          ('process_video', ${JSON.stringify({ videoId: v.id })}::jsonb, ${farFuture}),
          ('send_email', ${JSON.stringify({ kind: 'export', collectionId: collection.id })}::jsonb, ${farFuture})
      `);
      await deleteCollection(collection.id);
      expect(await db().select().from(collections).where(eq(collections.id, collection.id))).toHaveLength(0);
      expect(await db().select().from(books).where(eq(books.collectionId, collection.id))).toHaveLength(0);
      const jobsLeft = await db().execute(
        sql`SELECT 1 FROM jobs WHERE payload->>'videoId' = ${v.id} OR payload->>'collectionId' = ${collection.id}`,
      );
      expect(jobsLeft.rows).toHaveLength(0);
      await expect(fs.stat(file)).rejects.toThrow();
      await expectHttpError(deleteCollection(collection.id), 404, 'not_found');
    });
  });
});

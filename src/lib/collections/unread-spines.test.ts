import fs from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testEnv = vi.hoisted(() => {
  const base = (process.env.EXL_TEST_TMP || process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/exl-unread-spines-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.STORAGE_DIR = dir;
  process.env.MAX_BOOKS_PER_COLLECTION = '4';
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
import { books, collections, detections, frames, unreadSpines, videos } from '@/db/schema';
import { HttpError } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { abs, ensureDirFor, rel } from '@/lib/storage';
import type { BBox } from '@/lib/types';
import { createCollection, deleteSource } from './service';
import { dismissUnreadSpine, listUnreadSpines, resolveUnreadSpine, shelfPositionBetween } from './unread-spines';

const box = (x0: number, x1: number, y0 = 100, y1 = 900): BBox => ({ x0, y0, x1, y1 });

describe('shelfPositionBetween', () => {
  it('puts the book halfway between its neighbours on the same shelf', () => {
    const others = [
      { bbox: box(0, 80), shelfPosition: 3 },
      { bbox: box(100, 180), shelfPosition: 4 },
      { bbox: box(300, 380), shelfPosition: 6 },
      // the shelf below, right under the spine
      { bbox: box(200, 280, 1000, 1800), shelfPosition: 40 },
    ];
    expect(shelfPositionBetween(box(200, 280), others)).toBe(5);
  });

  it('goes next to the only neighbour, or nowhere without one', () => {
    expect(shelfPositionBetween(box(200, 280), [{ bbox: box(0, 80), shelfPosition: 7 }])).toBe(7.5);
    expect(shelfPositionBetween(box(200, 280), [{ bbox: box(400, 480), shelfPosition: 7 }])).toBe(6.5);
    expect(shelfPositionBetween(box(200, 280), [{ bbox: box(0, 80, 1000, 1800), shelfPosition: 7 }])).toBeNull();
    expect(shelfPositionBetween(box(200, 280), [])).toBeNull();
  });
});

const dbAvailable = await pool()
  .query('SELECT 1 FROM unread_spines LIMIT 1')
  .then(() => true)
  .catch(() => false);

const created: string[] = [];

async function expectHttpError(p: Promise<unknown>, status: number, key?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (key) expect((err as HttpError).key).toBe(key);
}

/** A finished video with one frame, two recognised books in it and one unread spine between them. */
async function shelf() {
  const { collection } = await createCollection({ title: 'Olvashatatlan', locale: 'hu' });
  created.push(collection.id);
  const [video] = await db()
    .insert(videos)
    .values({ collectionId: collection.id, originalFilename: 'polc.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'done' })
    .returning();
  const [frame] = await db()
    .insert(frames)
    .values({ videoId: video.id, collectionId: collection.id, idx: 3, timeSec: 1.5, storagePath: `frames/${collection.id}/${video.id}/0003.jpg`, width: 1000, height: 1000 })
    .returning();
  const [left, right] = await db()
    .insert(books)
    .values([
      { collectionId: collection.id, title: 'Bal', shelfPosition: 1, firstVideoId: video.id },
      { collectionId: collection.id, title: 'Jobb', shelfPosition: 2, firstVideoId: video.id },
    ])
    .returning();
  await db().insert(detections).values([
    { collectionId: collection.id, videoId: video.id, frameId: frame.id, bookId: left.id, rawTitle: 'Bal', confidence: 0.9, bbox: box(0, 90), provider: 'mock', model: 'm' },
    { collectionId: collection.id, videoId: video.id, frameId: frame.id, bookId: right.id, rawTitle: 'Jobb', confidence: 0.9, bbox: box(200, 290), provider: 'mock', model: 'm' },
  ]);
  const spineId = crypto.randomUUID();
  const spinePath = rel.unreadSpine(collection.id, spineId);
  await fs.writeFile(await ensureDirFor(spinePath), 'spine-jpeg');
  const bbox: BBox = { ...box(100, 190), rect: { cx: 145, cy: 500, width: 90, height: 800, deg: 2 } };
  const [spine] = await db()
    .insert(unreadSpines)
    .values({ id: spineId, collectionId: collection.id, videoId: video.id, frameId: frame.id, bbox, spinePath, spineColor: '#224466', reason: 'illegible', guessAuthor: 'Szerb Antal', shelfOrder: 1 })
    .returning();
  return { collection, video, frame, left, right, spine };
}

const exists = (p: string) =>
  fs.access(abs(p)).then(
    () => true,
    () => false,
  );

describe.skipIf(!dbAvailable)('unread spines (PostgreSQL)', () => {
  beforeAll(async () => {
    await fs.mkdir(testEnv.dir, { recursive: true });
  });

  afterAll(async () => {
    if (created.length > 0) await db().delete(collections).where(inArray(collections.id, created));
    await fs.rm(testEnv.dir, { recursive: true, force: true });
    await pool().end();
  });

  it('turns a named spine into a reviewed book at its place on the shelf, with its photo and frame', async () => {
    const { collection, video, frame, spine } = await shelf();
    vi.mocked(enqueueJob).mockClear();

    const book = await resolveUnreadSpine(collection.id, spine.id, { title: '  Utas és holdvilág ', author: 'Szerb Antal' });
    expect(book).toMatchObject({
      collectionId: collection.id,
      title: 'Utas és holdvilág',
      author: 'Szerb Antal',
      authorSort: 'sort:szerb antal',
      source: 'video',
      confidence: 1,
      reviewed: true,
      needsReview: false,
      spineColor: '#224466',
      bestFrameId: frame.id,
      firstVideoId: video.id,
      firstTimeSec: 1.5,
      shelfPosition: 1.5,
      detectionCount: 1,
      enrichment: { userEdited: true, userEditedFields: ['title', 'author'] },
    });
    expect(book.bestBbox).toMatchObject({ x0: 100, x1: 190, rect: { deg: 2 } });
    expect(book.spinePath).toBe(rel.spine(collection.id, book.id));
    expect(await fs.readFile(abs(book.spinePath!), 'utf8')).toBe('spine-jpeg');
    expect(await exists(spine.spinePath!)).toBe(false);

    const [detection] = await db().select().from(detections).where(eq(detections.bookId, book.id));
    expect(detection).toMatchObject({ videoId: video.id, frameId: frame.id, rawTitle: 'Utas és holdvilág', provider: 'owner' });
    expect(await db().select().from(unreadSpines).where(eq(unreadSpines.id, spine.id))).toHaveLength(0);
    expect(enqueueJob).toHaveBeenCalledWith(
      'enrich_collection',
      { collectionId: collection.id },
      expect.objectContaining({ dedupeKey: collection.id, dedupeQueuedOnly: true }),
    );

    // gone now: a second tab gets 404
    await expectHttpError(resolveUnreadSpine(collection.id, spine.id, { title: 'Újra' }), 404, 'not_found');
  });

  it('validates the title, the owner collection and the book limit', async () => {
    const { collection, spine } = await shelf();
    const other = await shelf();
    await expectHttpError(resolveUnreadSpine(collection.id, spine.id, { title: '   ' }), 400, 'invalid');
    await expectHttpError(resolveUnreadSpine(other.collection.id, spine.id, { title: 'Idegen' }), 404, 'not_found');
    await expectHttpError(resolveUnreadSpine(collection.id, 'not-a-uuid', { title: 'X' }), 404, 'not_found');

    await db()
      .insert(books)
      .values([
        { collectionId: collection.id, title: 'Harmadik' },
        { collectionId: collection.id, title: 'Negyedik' },
      ]);
    await expectHttpError(resolveUnreadSpine(collection.id, spine.id, { title: 'Ötödik' }), 400, 'too_many_books');
    // nothing half-done: the spine and its photo are still there, no stray copy
    expect(await listUnreadSpines(collection.id)).toHaveLength(1);
    expect(await exists(spine.spinePath!)).toBe(true);
    const spineFiles = await fs.readdir(abs(`spines/${collection.id}`));
    expect(spineFiles).toEqual(['unread']);
  });

  it('discards a spine with its photo', async () => {
    const { collection, spine } = await shelf();
    await expectHttpError(dismissUnreadSpine('999999997', spine.id), 404, 'not_found');
    await dismissUnreadSpine(collection.id, spine.id);
    expect(await listUnreadSpines(collection.id)).toHaveLength(0);
    expect(await exists(spine.spinePath!)).toBe(false);
    await expectHttpError(dismissUnreadSpine(collection.id, spine.id), 404, 'not_found');
  });

  it('lists spines in source order, then left to right, and forgets them with their source', async () => {
    const { collection, video, spine } = await shelf();
    const [second] = await db()
      .insert(videos)
      .values({ collectionId: collection.id, sortOrder: 1, originalFilename: 'b.mp4', mimeType: 'video/mp4', sizeBytes: 1, uploadStatus: 'uploaded', status: 'done' })
      .returning();
    await db().update(videos).set({ sortOrder: 2 }).where(eq(videos.id, video.id));
    const [late, early] = await db()
      .insert(unreadSpines)
      .values([
        { collectionId: collection.id, videoId: second.id, shelfOrder: 5 },
        { collectionId: collection.id, videoId: second.id, shelfOrder: 0 },
      ])
      .returning();
    expect((await listUnreadSpines(collection.id)).map((s) => s.id)).toEqual([early.id, late.id, spine.id]);

    await deleteSource(video.id);
    expect((await listUnreadSpines(collection.id)).map((s) => s.id)).toEqual([early.id, late.id]);
    expect(await exists(spine.spinePath!)).toBe(false);
  });
});

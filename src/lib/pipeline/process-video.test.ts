/**
 * Integration test of the per-source pipeline: real ffmpeg + sharp + Postgres (isolated schema),
 * with the AI provider, merge and enrichment modules mocked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpineObservation, VisionFrame } from '@/lib/ai/types';

const storageDir = mkdtempSync(path.join(os.tmpdir(), 'exl-pv-test-'));
process.env.STORAGE_DIR = storageDir;
process.env.MAX_VIDEO_SECONDS = '20';
process.env.VISION_BATCH_SIZE = '3';
process.env.VISION_CONCURRENCY = '2';

type ReadSpines = (frames: VisionFrame[]) => Promise<SpineObservation[]>;
const provider = vi.hoisted(() => ({ impl: null as null | ((frames: VisionFrame[]) => Promise<unknown[]>), calls: 0 }));

vi.mock('@/lib/ai', () => ({
  getVisionProvider: () => ({
    name: 'mock',
    model: 'test-model',
    readSpines: async (frames: VisionFrame[]) => {
      provider.calls++;
      const observations = provider.impl ? await provider.impl(frames) : [];
      return {
        observations,
        usage: { provider: 'mock', model: 'test-model', inputTokens: 10, outputTokens: 5, estCostUsd: 0 },
      };
    },
  }),
}));
vi.mock('@/lib/ai/usage', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('@/lib/pipeline/enrich', () => ({ enrichCollection: vi.fn(async () => ({ enriched: 0, covers: 0 })) }));
vi.mock('@/lib/pipeline/merge', () => ({
  // minimal stand-in for merge-enrich: one book per distinct title
  mergeVideoDetections: vi.fn(async (videoId: string) => {
    const { db } = await import('@/db');
    const s = await import('@/db/schema');
    const { eq, inArray } = await import('drizzle-orm');
    const [video] = await db().select().from(s.videos).where(eq(s.videos.id, videoId));
    const dets = await db().select().from(s.detections).where(eq(s.detections.videoId, videoId));
    const byTitle = new Map<string, typeof dets>();
    for (const d of dets) byTitle.set(d.rawTitle, [...(byTitle.get(d.rawTitle) ?? []), d]);
    const newBookIds: string[] = [];
    let i = 0;
    for (const [title, group] of byTitle) {
      const best = group.find((d) => d.bbox) ?? group[0];
      const [book] = await db()
        .insert(s.books)
        .values({
          collectionId: video.collectionId,
          title,
          author: group[0].rawAuthor,
          bestFrameId: best.frameId,
          bestBbox: best.bbox,
          firstVideoId: videoId,
          detectionCount: group.length,
          shelfPosition: video.sortOrder * 100000 + i++,
        })
        .returning({ id: s.books.id });
      await db().update(s.detections).set({ bookId: book.id }).where(inArray(s.detections.id, group.map((d) => d.id)));
      newBookIds.push(book.id);
    }
    await db().update(s.videos).set({ booksFound: newBookIds.length }).where(eq(s.videos.id, videoId));
    return { newBookIds, updatedBookIds: [] };
  }),
}));

const { createIsolatedDb } = await import('@/lib/jobs/testing/isolated-db');
const { db } = await import('@/db');
const schema = await import('@/db/schema');
const { eq } = await import('drizzle-orm');
const { processVideo } = await import('./process-video');
const { runEnrichmentJob } = await import('./finalize');
const { visionRetryDefaults } = await import('./vision-step');
const { abs } = await import('@/lib/storage');

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let iso: Awaited<ReturnType<typeof createIsolatedDb>> = null;

function ff(args: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

const twoSpines: ReadSpines = async (frames) =>
  frames.flatMap((f) => [
    { frame: f.index, order: 1, author: 'Szerző Egy', title: 'Első könyv', canonicalAuthor: null, canonicalTitle: null, publisher: null, confidence: 0.9, bbox: { x0: 10, y0: 20, x1: f.width / 2 - 10, y1: f.height - 20 } },
    { frame: f.index, order: 2, author: null, title: 'Második könyv', canonicalAuthor: 'X', canonicalTitle: 'Második könyv', publisher: 'Magvető', confidence: 0.7, bbox: { x0: f.width / 2 + 10, y0: 20, x1: f.width - 10, y1: f.height - 20 } },
  ]);

let seq = 0;
async function createSource(opts: { seconds: number; email?: string | null; size?: string }) {
  seq++;
  const collectionId = String(100000000 + seq);
  const videoId = crypto.randomUUID();
  const storagePath = `uploads/${collectionId}/${videoId}.mp4`;
  const file = abs(storagePath);
  await (await import('node:fs/promises')).mkdir(path.dirname(file), { recursive: true });
  ff([
    '-f', 'lavfi', '-i', `testsrc2=size=${opts.size ?? '180x320'}:rate=15:duration=${opts.seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', file,
  ]);
  const size = (await (await import('node:fs/promises')).stat(file)).size;
  await db().insert(schema.collections).values({ id: collectionId, ownerTokenHash: 'x', status: 'processing', email: opts.email ?? null });
  await db().insert(schema.videos).values({
    id: videoId,
    collectionId,
    originalFilename: 'shelf.mp4',
    mimeType: 'video/mp4',
    sizeBytes: size,
    bytesReceived: size,
    uploadStatus: 'uploaded',
    storagePath,
    status: 'queued',
  });
  return { collectionId, videoId, storagePath };
}

beforeAll(async () => {
  if (hasFfmpeg) iso = await createIsolatedDb('test_pv');
  visionRetryDefaults.retries = 1;
  visionRetryDefaults.retryDelayMs = () => 10;
});
afterAll(async () => {
  await iso?.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});
beforeEach(() => {
  provider.impl = null;
  provider.calls = 0;
});

describe.skipIf(!hasFfmpeg)('processVideo (integration)', () => {
  it('runs probe → frames → vision → merge → crops, then enrichment + finalize', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = twoSpines;
    const { collectionId, videoId, storagePath } = await createSource({ seconds: 4, email: 'owner@example.com' });

    const res = await processVideo(videoId);
    expect(res.status).toBe('done');

    const [video] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(video).toMatchObject({ status: 'done', stage: 'done', progress: 100, error: null, kind: 'video', width: 180, height: 320 });
    expect(video.durationSec).toBeCloseTo(4, 0);
    expect(video.processedAt).toBeInstanceOf(Date);

    const frameRows = await db().select().from(schema.frames).where(eq(schema.frames.videoId, videoId));
    expect(frameRows.length).toBe(video.framesTotal);
    expect(frameRows.length).toBeGreaterThan(1);
    expect(frameRows.every((f) => f.analyzed)).toBe(true);
    expect(video.framesAnalyzed).toBe(frameRows.length);
    for (const f of frameRows) {
      expect(existsSync(abs(f.storagePath))).toBe(true);
      expect(existsSync(abs(f.thumbPath!))).toBe(true);
    }

    const dets = await db().select().from(schema.detections).where(eq(schema.detections.videoId, videoId));
    // overlapping batches analyse boundary frames twice
    expect(dets.length).toBeGreaterThanOrEqual(frameRows.length * 2);
    expect(dets.every((d) => d.bookId && d.provider === 'mock' && d.model === 'test-model')).toBe(true);
    expect(dets.every((d) => d.bbox && d.bbox.x1 <= 180 && d.bbox.y1 <= 320)).toBe(true);

    const bookRows = await db().select().from(schema.books).where(eq(schema.books.collectionId, collectionId));
    expect(bookRows).toHaveLength(2);
    for (const b of bookRows) {
      expect(b.spinePath).toBe(`spines/${collectionId}/${b.id}.jpg`);
      expect(b.spineColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(existsSync(abs(b.spinePath!))).toBe(true);
      expect(b.updatedAt.getTime()).toBe(b.createdAt.getTime()); // crops never bump updated_at
    }

    const jobs = await db().select().from(schema.jobs);
    expect(jobs.map((j) => [j.type, j.status, j.payload._dedupe])).toEqual([['enrich_collection', 'queued', collectionId]]);

    const enrich = await runEnrichmentJob(collectionId);
    expect(enrich.skipped).toBeNull();
    expect(enrich.finalize).toMatchObject({ status: 'ready', deletedSources: 1, emailQueued: true });
    const [col] = await db().select().from(schema.collections).where(eq(schema.collections.id, collectionId));
    expect(col.status).toBe('ready');
    const [after] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(after.storagePath).toBeNull();
    expect(after.sourceDeletedAt).toBeInstanceOf(Date);
    expect(after.stage).toBe('done');
    expect(existsSync(abs(storagePath))).toBe(false);
    const email = (await db().select().from(schema.jobs)).filter((j) => j.type === 'send_email');
    expect(email).toHaveLength(1);
    expect(email[0].payload).toMatchObject({ kind: 'collection_ready', collectionId, locale: 'hu', _dedupe: `ready:${collectionId}` });

    // a re-delivered job for an already processed source is a no-op
    expect((await processVideo(videoId)).status).toBe('skipped');
    await db().delete(schema.jobs);
  });

  it('analyses the stored key frames again after the source file was removed', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = twoSpines;
    const { collectionId, videoId } = await createSource({ seconds: 3 });
    expect((await processVideo(videoId)).status).toBe('done');
    await runEnrichmentJob(collectionId);
    const [removed] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(removed.storagePath).toBeNull();
    const framesBefore = await db().select().from(schema.frames).where(eq(schema.frames.videoId, videoId));
    const booksBefore = await db().select().from(schema.books).where(eq(schema.books.collectionId, collectionId));
    const confirmed = booksBefore.find((b) => b.title === 'Első könyv')!;
    await db().update(schema.books).set({ reviewed: true }).where(eq(schema.books.id, confirmed.id));
    await db().delete(schema.jobs);
    // a spine left unread by the first run goes, photo and all
    const unreadPath = `spines/${collectionId}/unread/first-run.jpg`;
    await (await import('node:fs/promises')).mkdir(path.dirname(abs(unreadPath)), { recursive: true });
    await (await import('node:fs/promises')).writeFile(abs(unreadPath), 'jpg');
    await db().insert(schema.unreadSpines).values({ collectionId, videoId, frameId: framesBefore[0].id, spinePath: unreadPath });

    provider.impl = async (frames) =>
      frames.map((f) => ({ frame: f.index, order: 1, author: null, title: 'Harmadik könyv', canonicalAuthor: null, canonicalTitle: null, publisher: null, confidence: 0.9, bbox: null }));
    const res = await processVideo(videoId, { fromFrames: true });
    expect(res.status).toBe('done');
    expect(await db().select().from(schema.unreadSpines).where(eq(schema.unreadSpines.videoId, videoId))).toHaveLength(0);
    expect(existsSync(abs(unreadPath))).toBe(false);

    const [video] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(video).toMatchObject({ status: 'done', stage: 'done', error: null, framesTotal: framesBefore.length });
    const framesAfter = await db().select().from(schema.frames).where(eq(schema.frames.videoId, videoId));
    expect(framesAfter.map((f) => f.id).sort()).toEqual(framesBefore.map((f) => f.id).sort());
    expect(framesAfter.every((f) => f.analyzed && existsSync(abs(f.storagePath)))).toBe(true);
    const titles = (await db().select().from(schema.books).where(eq(schema.books.collectionId, collectionId))).map((b) => [b.title, b.id === confirmed.id]);
    // the confirmed book stays, the other book of this source is recognised anew
    expect(titles).toContainEqual(['Első könyv', true]);
    expect(titles.some(([t]) => t === 'Második könyv')).toBe(false);
    expect(titles.some(([t]) => t === 'Harmadik könyv')).toBe(true);
    // without stored frames and without the file there is nothing to analyse
    await db().delete(schema.frames).where(eq(schema.frames.videoId, videoId));
    expect((await processVideo(videoId, { fromFrames: true })).status).toBe('error');
    await db().delete(schema.jobs);
  });

  it('is idempotent when re-run before finalize', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = twoSpines;
    const { collectionId, videoId } = await createSource({ seconds: 3 });
    await processVideo(videoId);
    const count = async () => ({
      frames: (await db().select().from(schema.frames).where(eq(schema.frames.videoId, videoId))).length,
      dets: (await db().select().from(schema.detections).where(eq(schema.detections.videoId, videoId))).length,
      books: (await db().select().from(schema.books).where(eq(schema.books.collectionId, collectionId))).length,
    });
    const first = await count();
    await db().update(schema.videos).set({ status: 'queued' }).where(eq(schema.videos.id, videoId));
    expect((await processVideo(videoId)).status).toBe('done');
    expect(await count()).toEqual(first);
    await db().delete(schema.jobs);
  });

  it('marks too long videos as error (non-retryable) and still schedules the collection', async (ctx) => {
    if (!iso) ctx.skip();
    const { collectionId, videoId } = await createSource({ seconds: 25, size: '64x64' });
    const res = await processVideo(videoId);
    expect(res).toEqual({ status: 'error', errorCode: 'too_long' });
    expect(provider.calls).toBe(0);
    const [video] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(video).toMatchObject({ status: 'error', error: 'too_long' });
    const jobs = await db().select().from(schema.jobs);
    expect(jobs.map((j) => j.payload.collectionId)).toEqual([collectionId]);
    const enrich = await runEnrichmentJob(collectionId);
    expect(enrich.finalize?.status).toBe('error');
    await db().delete(schema.jobs);
  });

  it('reports no_books when nothing legible was seen', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = async () => [];
    const { videoId } = await createSource({ seconds: 2 });
    expect(await processVideo(videoId)).toEqual({ status: 'error', errorCode: 'no_books' });
    await db().delete(schema.jobs);
  });

  it('throws a retryable ai_failed when most vision batches fail', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = async () => {
      throw new Error('provider down');
    };
    const { videoId } = await createSource({ seconds: 3 });
    await expect(processVideo(videoId)).rejects.toMatchObject({ code: 'ai_failed', retryable: true });
    const [video] = await db().select().from(schema.videos).where(eq(schema.videos.id, videoId));
    expect(video.status).toBe('processing'); // the worker decides: re-queue or markVideoFailed
    await db().delete(schema.jobs);
  });

  it('stops quietly when the source is deleted mid-run', async (ctx) => {
    if (!iso) ctx.skip();
    const { collectionId, videoId } = await createSource({ seconds: 3 });
    provider.impl = async (frames) => {
      await db().delete(schema.videos).where(eq(schema.videos.id, videoId));
      return twoSpines(frames);
    };
    expect((await processVideo(videoId)).status).toBe('gone');
    expect(existsSync(abs(`frames/${collectionId}/${videoId}`))).toBe(false);
    expect(await db().select().from(schema.frames).where(eq(schema.frames.videoId, videoId))).toHaveLength(0);
    await db().delete(schema.jobs);
  });

  it('stops quietly when the whole collection is deleted mid-run (failed FK inserts)', async (ctx) => {
    if (!iso) ctx.skip();
    const { collectionId, videoId } = await createSource({ seconds: 3 });
    provider.impl = async (frames) => {
      // DELETE /api/collections/:id – rows cascade, files removed, queued jobs deleted
      await db().delete(schema.collections).where(eq(schema.collections.id, collectionId));
      return twoSpines(frames);
    };
    expect((await processVideo(videoId)).status).toBe('gone');
    for (const dir of ['uploads', 'frames', 'spines']) expect(existsSync(abs(`${dir}/${collectionId}`))).toBe(false);
    expect(await db().select().from(schema.jobs)).toHaveLength(0); // nothing scheduled for a deleted collection
  });

  it('enrichment gives up quietly when the collection disappears while enriching', async (ctx) => {
    if (!iso) ctx.skip();
    provider.impl = twoSpines;
    const { collectionId, videoId } = await createSource({ seconds: 2 });
    expect((await processVideo(videoId)).status).toBe('done');
    const { enrichCollection } = await import('@/lib/pipeline/enrich');
    vi.mocked(enrichCollection).mockImplementationOnce(async () => {
      await db().delete(schema.collections).where(eq(schema.collections.id, collectionId));
      throw new Error('insert or update on table "books" violates foreign key constraint');
    });
    const errors = vi.spyOn(console, 'error');
    const res = await runEnrichmentJob(collectionId);
    expect(res).toMatchObject({ skipped: 'missing', enrichError: null, finalize: null });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect((await db().select().from(schema.jobs)).filter((j) => j.type === 'send_email')).toHaveLength(0);
    await db().delete(schema.jobs);
  });
});

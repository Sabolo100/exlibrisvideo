import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const storageDir = mkdtempSync(path.join(os.tmpdir(), 'exl-cleanup-test-'));
process.env.STORAGE_DIR = storageDir;
process.env.DRAFT_RETENTION_DAYS = '7';

vi.mock('@/lib/pipeline/enrich', () => ({ enrichCollection: vi.fn() }));

const { createIsolatedDb } = await import('@/lib/jobs/testing/isolated-db');
const { db } = await import('@/db');
const schema = await import('@/db/schema');
const { sql } = await import('drizzle-orm');
const { abs } = await import('@/lib/storage');
const { runCleanup } = await import('./cleanup');

let iso: Awaited<ReturnType<typeof createIsolatedDb>> = null;
beforeAll(async () => {
  iso = await createIsolatedDb('test_cleanup');
});
afterAll(async () => {
  await iso?.cleanup();
  rmSync(storageDir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

async function writeFile(rel: string, ageDays: number) {
  const file = abs(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'x');
  const t = daysAgo(ageDays);
  await fs.utimes(file, t, t);
  return file;
}

describe('runCleanup (isolated schema)', () => {
  it('purges stale uploads, old empty drafts, old exports, rate limits and old jobs', async (ctx) => {
    if (!iso) ctx.skip();
    const base = { ownerTokenHash: 'x' };
    await db().insert(schema.collections).values([
      { ...base, id: '100000001', status: 'draft', createdAt: daysAgo(10), updatedAt: daysAgo(10) }, // purge
      { ...base, id: '100000002', status: 'draft', createdAt: daysAgo(10), updatedAt: daysAgo(10) }, // has a book → keep
      { ...base, id: '100000003', status: 'processing', createdAt: daysAgo(3), updatedAt: daysAgo(3) },
      { ...base, id: '100000004', status: 'draft', createdAt: daysAgo(2), updatedAt: daysAgo(2) }, // too young
    ]);
    await db().insert(schema.books).values({ collectionId: '100000002', title: 'Kézzel felvett könyv', source: 'manual' });
    await writeFile('frames/100000001/x/0000.jpg', 10);

    const vid = (id: string, collectionId: string, extra: Partial<typeof schema.videos.$inferInsert>) => ({
      id,
      collectionId,
      originalFilename: 'a.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 10,
      ...extra,
    });
    const staleId = '00000000-0000-4000-8000-000000000001';
    const liveId = '00000000-0000-4000-8000-000000000002';
    const doneId = '00000000-0000-4000-8000-000000000003';
    const staleFile = await writeFile(`uploads/100000003/${staleId}.mp4`, 2);
    const liveFile = await writeFile(`uploads/100000004/${liveId}.mp4`, 0);
    await db().insert(schema.videos).values([
      vid(staleId, '100000003', { uploadStatus: 'uploading', storagePath: `uploads/100000003/${staleId}.mp4`, createdAt: daysAgo(2) }),
      vid(doneId, '100000003', { uploadStatus: 'uploaded', status: 'done', createdAt: daysAgo(2) }),
      vid(liveId, '100000004', { uploadStatus: 'uploading', storagePath: `uploads/100000004/${liveId}.mp4`, createdAt: daysAgo(2) }),
    ]);

    const oldExport = await writeFile('exports/100000003/old.xlsx', 2);
    const newExport = await writeFile('exports/100000003/new.xlsx', 0);
    const emptyDirExport = await writeFile('exports/100000009/stale.pdf', 3);

    await db().insert(schema.rateLimits).values([
      { key: 'old', windowStart: daysAgo(3), count: 1 },
      { key: 'new', windowStart: new Date(), count: 1 },
    ]);
    await db().insert(schema.jobs).values([
      { type: 'cleanup', status: 'done', updatedAt: daysAgo(40) },
      { type: 'cleanup', status: 'done', updatedAt: daysAgo(1) },
    ]);

    const res = await runCleanup();
    expect(res).toMatchObject({ staleUploads: 1, drafts: 1, exportFiles: 2, rateLimitRows: 1, jobs: 1, errors: [] });

    const cols = (await db().select({ id: schema.collections.id }).from(schema.collections)).map((c) => c.id).sort();
    expect(cols).toEqual(['100000002', '100000003', '100000004']);
    expect(existsSync(abs('frames/100000001'))).toBe(false);

    const vids = (await db().select({ id: schema.videos.id }).from(schema.videos)).map((v) => v.id).sort();
    expect(vids).toEqual([doneId, liveId].sort());
    expect(existsSync(staleFile)).toBe(false);
    expect(existsSync(liveFile)).toBe(true);

    expect(existsSync(oldExport)).toBe(false);
    expect(existsSync(newExport)).toBe(true);
    expect(existsSync(emptyDirExport)).toBe(false);
    expect(existsSync(path.dirname(emptyDirExport))).toBe(false);

    expect((await db().select().from(schema.rateLimits)).map((r) => r.key)).toEqual(['new']);

    // the purged upload was the last thing collection 3 waited for → enrichment scheduled
    const enrich = await db()
      .select()
      .from(schema.jobs)
      .where(sql`${schema.jobs.type} = 'enrich_collection'`);
    expect(enrich.map((j) => j.payload.collectionId)).toEqual(['100000003']);
  });
});

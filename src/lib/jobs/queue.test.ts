import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { PipelineError } from './errors';
import {
  BACKOFF_MAX_MS,
  backoffDelayMs,
  claimNextJob,
  completeJob,
  enqueueJob,
  ensureQueuedJob,
  failJob,
  mapJobRow,
  requeueJobs,
  resetStaleJobs,
  touchJob,
} from './queue';
import { createIsolatedDb, type IsolatedDb } from './testing/isolated-db';

describe('backoffDelayMs', () => {
  it('is 30 s × 4^(attempts-1)', () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBe(480_000);
    expect(backoffDelayMs(4)).toBe(1_920_000);
  });
  it('clamps silly inputs and caps huge delays', () => {
    expect(backoffDelayMs(0)).toBe(30_000);
    expect(backoffDelayMs(-5)).toBe(30_000);
    expect(backoffDelayMs(Number.NaN)).toBe(30_000);
    expect(backoffDelayMs(50)).toBe(BACKOFF_MAX_MS);
  });
});

describe('mapJobRow', () => {
  it('maps snake_case raw rows (bigint id as string) to JobRow', () => {
    const now = new Date();
    const row = mapJobRow({
      id: '42',
      type: 'process_video',
      payload: { videoId: 'v' },
      status: 'running',
      attempts: 1,
      max_attempts: 3,
      run_at: now,
      locked_at: now.toISOString(),
      locked_by: 'w1',
      last_error: null,
      created_at: now,
      updated_at: now,
    });
    expect(row.id).toBe(42);
    expect(row.maxAttempts).toBe(3);
    expect(row.lockedAt).toBeInstanceOf(Date);
    expect(row.lockedAt?.getTime()).toBe(now.getTime());
    expect(row.lastError).toBeNull();
    expect(row.payload).toEqual({ videoId: 'v' });
  });
});

let iso: IsolatedDb | null = null;
beforeAll(async () => {
  iso = await createIsolatedDb('test_queue');
});
afterAll(async () => {
  await iso?.cleanup();
});

describe('job queue against Postgres (isolated schema)', () => {
  it('enqueues, dedupes, claims, completes', async (ctx) => {
    if (!iso) ctx.skip();
    const id = await enqueueJob('process_video', { videoId: 'vid-1' }, { dedupeKey: 'vid-1' });
    expect(id).toBeTypeOf('number');
    // same key while queued → skipped
    expect(await enqueueJob('process_video', { videoId: 'vid-1' }, { dedupeKey: 'vid-1' })).toBeNull();
    // other type with the same key is independent
    expect(await enqueueJob('enrich_collection', { collectionId: 'vid-1' }, { dedupeKey: 'vid-1' })).toBeTypeOf('number');
    // no dedupe key → always inserted
    expect(await enqueueJob('cleanup', {})).toBeTypeOf('number');

    const claimed = await claimNextJob('worker-a');
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedBy).toBe('worker-a');
    expect(claimed?.payload).toMatchObject({ videoId: 'vid-1', _dedupe: 'vid-1' });

    // still deduped while running
    expect(await enqueueJob('process_video', { videoId: 'vid-1' }, { dedupeKey: 'vid-1' })).toBeNull();
    // …but not when only queued jobs count
    const follow = await enqueueJob('process_video', { videoId: 'vid-1' }, { dedupeKey: 'vid-1', dedupeQueuedOnly: true });
    expect(follow).toBeTypeOf('number');

    expect(await touchJob(claimed!.id, 'worker-a')).toBe(true);
    expect(await touchJob(claimed!.id, 'worker-b')).toBe(false);

    await completeJob(claimed!.id);
    const [done] = await db().select().from(jobs).where(sql`${jobs.id} = ${claimed!.id}`);
    expect(done.status).toBe('done');
    // finished job no longer blocks the key
    await db().delete(jobs);
    expect(await enqueueJob('process_video', { videoId: 'vid-1' }, { dedupeKey: 'vid-1' })).toBeTypeOf('number');
    await db().delete(jobs);
  });

  it('never hands the same job to two concurrent claimers', async (ctx) => {
    if (!iso) ctx.skip();
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => enqueueJob('cleanup', {}, { dedupeKey: `c${i}` })));
    const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => claimNextJob(`w${i}`)));
    const got = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(got.length).toBe(6);
    expect(new Set(got).size).toBe(6);
    expect(new Set(got)).toEqual(new Set(ids));
    await db().delete(jobs);
  });

  it('concurrent enqueues with the same dedupe key insert exactly one job', async (ctx) => {
    if (!iso) ctx.skip();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => enqueueJob('enrich_collection', { collectionId: 'c1' }, { dedupeKey: 'c1' })),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    await db().delete(jobs);
  });

  it('does not claim jobs scheduled in the future', async (ctx) => {
    if (!iso) ctx.skip();
    await enqueueJob('cleanup', {}, { runAt: new Date(Date.now() + 3600_000) });
    expect(await claimNextJob('w')).toBeNull();
    await db().delete(jobs);
  });

  it('fails with back-off, then permanently after maxAttempts', async (ctx) => {
    if (!iso) ctx.skip();
    const id = await enqueueJob('process_video', { videoId: 'v2' }, { maxAttempts: 2 });
    const first = await claimNextJob('w');
    expect(first?.id).toBe(id);
    const before = Date.now();
    expect(await failJob(first!, new Error('boom'))).toBe(false);
    const [requeued] = await db().select().from(jobs).where(sql`${jobs.id} = ${id}`);
    expect(requeued.status).toBe('queued');
    expect(requeued.lockedBy).toBeNull();
    expect(requeued.lastError).toContain('boom');
    const delay = requeued.runAt.getTime() - before;
    expect(delay).toBeGreaterThan(25_000);
    expect(delay).toBeLessThan(40_000);
    // not claimable until run_at
    expect(await claimNextJob('w')).toBeNull();

    // pretend the back-off elapsed
    await db().update(jobs).set({ runAt: sql`now() - interval '1 second'` }).where(sql`${jobs.id} = ${id}`);
    const second = await claimNextJob('w');
    expect(second?.attempts).toBe(2);
    expect(await failJob(second!, new Error('boom again'))).toBe(true);
    const [failed] = await db().select().from(jobs).where(sql`${jobs.id} = ${id}`);
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toContain('boom again');
    await db().delete(jobs);
  });

  it('non-retryable pipeline errors fail immediately', async (ctx) => {
    if (!iso) ctx.skip();
    await enqueueJob('process_video', { videoId: 'v3' }, { maxAttempts: 5 });
    const job = await claimNextJob('w');
    expect(await failJob(job!, new PipelineError('too_long'))).toBe(true);
    await db().delete(jobs);
  });

  it('resets stale running jobs and requeues on shutdown', async (ctx) => {
    if (!iso) ctx.skip();
    const staleId = await enqueueJob('process_video', { videoId: 'stale' }, { maxAttempts: 3 });
    const poisonId = await enqueueJob('process_video', { videoId: 'poison' }, { maxAttempts: 1 });
    const freshId = await enqueueJob('process_video', { videoId: 'fresh' });
    const a = await claimNextJob('dead-worker');
    const b = await claimNextJob('dead-worker');
    const c = await claimNextJob('live-worker');
    expect([a?.id, b?.id, c?.id]).toEqual([staleId, poisonId, freshId]);
    await db()
      .update(jobs)
      .set({ lockedAt: sql`now() - interval '31 minutes'` })
      .where(sql`${jobs.id} IN (${staleId}, ${poisonId})`);

    const res = await resetStaleJobs();
    expect(res.requeued.map((j) => j.id)).toEqual([staleId]);
    expect(res.failed.map((j) => j.id)).toEqual([poisonId]);
    const rows = await db().select().from(jobs).orderBy(jobs.id);
    expect(rows.map((r) => r.status)).toEqual(['queued', 'failed', 'running']);

    // graceful shutdown: running job of this worker goes back without consuming an attempt
    expect(await requeueJobs([freshId!], 'someone-else')).toBe(0);
    expect(await requeueJobs([freshId!], 'live-worker')).toBe(1);
    const [fresh] = await db().select().from(jobs).where(sql`${jobs.id} = ${freshId}`);
    expect(fresh.status).toBe('queued');
    expect(fresh.attempts).toBe(0);
    await db().delete(jobs);
  });

  it('ensureQueuedJob keeps one queued follow-up and pulls it forward', async (ctx) => {
    if (!iso) ctx.skip();
    const later = new Date(Date.now() + 10 * 60_000);
    const a = await ensureQueuedJob('enrich_collection', { collectionId: 'c9' }, 'c9', { runAt: later });
    expect(a.created).toBe(true);
    const b = await ensureQueuedJob('enrich_collection', { collectionId: 'c9' }, 'c9');
    expect(b).toEqual({ id: a.id, created: false });
    const [row] = await db().select().from(jobs).where(sql`${jobs.id} = ${a.id}`);
    expect(row.runAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // a running job does not count: a follow-up is created
    const running = await claimNextJob('w');
    expect(running?.id).toBe(a.id);
    const c = await ensureQueuedJob('enrich_collection', { collectionId: 'c9' }, 'c9');
    expect(c.created).toBe(true);
    // plain enqueueJob still dedupes against both
    expect(await enqueueJob('enrich_collection', { collectionId: 'c9' }, { dedupeKey: 'c9' })).toBeNull();
    await db().delete(jobs);
  });
});

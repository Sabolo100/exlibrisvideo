import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db';
import { checkRateLimit, purgeRateLimits } from './rate-limit';

const dbAvailable = await pool()
  .query('SELECT 1 FROM rate_limits LIMIT 1')
  .then(() => true)
  .catch(() => false);

const prefix = `test:rl:${randomUUID()}`;

describe.skipIf(!dbAvailable)('checkRateLimit (PostgreSQL)', () => {
  afterAll(async () => {
    await db().execute(sql`DELETE FROM rate_limits WHERE key LIKE ${prefix + '%'}`);
    await pool().end();
  });

  it('counts hits inside a fixed window', async () => {
    const key = `${prefix}:basic`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(key, 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    const resetIn = results[3].resetAt.getTime() - Date.now();
    expect(resetIn).toBeGreaterThan(50_000);
    expect(resetIn).toBeLessThanOrEqual(61_000);
    // the window start does not move while it is active
    expect(results[3].resetAt.getTime()).toBe(results[0].resetAt.getTime());
  });

  it('starts a new window once the previous one expired', async () => {
    const key = `${prefix}:expiry`;
    await checkRateLimit(key, 1, 60);
    expect((await checkRateLimit(key, 1, 60)).allowed).toBe(false);
    await db().execute(sql`UPDATE rate_limits SET window_start = now() - interval '61 seconds' WHERE key = ${key}`);
    const fresh = await checkRateLimit(key, 1, 60);
    expect(fresh).toMatchObject({ allowed: true, remaining: 0 });
    const row = await db().execute(sql`SELECT count FROM rate_limits WHERE key = ${key}`);
    expect(Number((row.rows[0] as { count: number }).count)).toBe(1);
  });

  it('is atomic under concurrency', async () => {
    const key = `${prefix}:concurrent`;
    const results = await Promise.all(Array.from({ length: 25 }, () => checkRateLimit(key, 10, 60)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const row = await db().execute(sql`SELECT count FROM rate_limits WHERE key = ${key}`);
    expect(Number((row.rows[0] as { count: number }).count)).toBe(25);
  });

  it('keeps separate keys independent, hashes very long keys, and treats limit <= 0 as disabled', async () => {
    expect((await checkRateLimit(`${prefix}:a`, 1, 60)).allowed).toBe(true);
    expect((await checkRateLimit(`${prefix}:b`, 1, 60)).allowed).toBe(true);
    const long = `${prefix}:${'x'.repeat(500)}`;
    expect((await checkRateLimit(long, 1, 60)).allowed).toBe(true);
    expect((await checkRateLimit(long, 1, 60)).allowed).toBe(false);
    const disabledKey = `${prefix}:disabled`;
    expect((await checkRateLimit(disabledKey, 0, 60)).allowed).toBe(true);
    const row = await db().execute(sql`SELECT 1 FROM rate_limits WHERE key = ${disabledKey}`);
    expect(row.rows).toHaveLength(0);
  });

  it('purgeRateLimits removes stale windows only', async () => {
    const stale = `${prefix}:stale`;
    const live = `${prefix}:live`;
    await checkRateLimit(stale, 5, 60);
    await checkRateLimit(live, 5, 60);
    await db().execute(sql`UPDATE rate_limits SET window_start = now() - interval '3 days' WHERE key = ${stale}`);
    expect(await purgeRateLimits(2 * 24 * 3600)).toBeGreaterThanOrEqual(1);
    const rows = await db().execute(sql`SELECT key FROM rate_limits WHERE key IN (${stale}, ${live})`);
    expect((rows.rows as { key: string }[]).map((r) => r.key)).toEqual([live]);
  });
});

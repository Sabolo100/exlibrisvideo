/**
 * Fixed-window rate limiting shared by all web instances (table `rate_limits`). Server-only (owner: api).
 *
 * One atomic statement per check:
 *   INSERT … ON CONFLICT (key) DO UPDATE
 * which either starts a new window (expired or first hit → count 1) or increments the current one.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface RateLimitResult {
  allowed: boolean;
  /** requests left in the current window (0 when blocked) */
  remaining: number;
  /** when the current window ends */
  resetAt: Date;
}

const MAX_KEY_LENGTH = 200;

function normalizeKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `${key.slice(0, 120)}#${crypto.createHash('sha256').update(key).digest('hex')}`;
}

/**
 * Counts one hit for `key` and reports whether it is within `limit` hits per `windowSec` seconds.
 * A `limit` ≤ 0 disables the limit (always allowed, nothing stored).
 */
export async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const window = Math.max(1, Math.floor(windowSec));
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, remaining: Number.POSITIVE_INFINITY, resetAt: new Date(Date.now() + window * 1000) };
  }
  const k = normalizeKey(key);
  const result = await db().execute(sql`
    INSERT INTO rate_limits AS rl (key, window_start, count)
    VALUES (${k}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE
        WHEN rl.window_start <= now() - make_interval(secs => ${window}::double precision) THEN now()
        ELSE rl.window_start END,
      count = CASE
        WHEN rl.window_start <= now() - make_interval(secs => ${window}::double precision) THEN 1
        ELSE LEAST(rl.count + 1, 2147483647) END
    RETURNING count, window_start
  `);
  const row = result.rows[0] as { count: number | string; window_start: Date | string } | undefined;
  if (!row) throw new Error('rate limit upsert returned no row');
  const count = Number(row.count);
  const windowStart = row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(windowStart.getTime() + window * 1000),
  };
}

/** Deletes rows whose window started more than `olderThanSec` ago (for the cleanup job). Returns the count. */
export async function purgeRateLimits(olderThanSec = 2 * 24 * 3600): Promise<number> {
  const result = await db().execute(
    sql`DELETE FROM rate_limits WHERE window_start < now() - make_interval(secs => ${Math.max(1, Math.floor(olderThanSec))}::double precision)`,
  );
  return result.rowCount ?? 0;
}

/**
 * Postgres job queue on the `jobs` table (SPEC §4.8).
 *
 * - enqueueJob: optional dedupe key stored as payload._dedupe (serialised by an advisory xact lock)
 * - claimNextJob: single UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *
 * - failJob: exponential back-off 30 s × 4^(attempts-1) until maxAttempts, then `failed`
 * - resetStaleJobs: running jobs whose lock is older than 30 min go back to `queued`
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { jobs, type JobRow } from '@/db/schema';
import type { EmailKind, ExportFormat, JobStatus, JobType, Locale } from '@/lib/types';
import { describeError, isRetryable } from './errors';

export interface JobPayloads {
  /** fromFrames: recognise the books again from the stored key frames (owner "reanalyse") */
  process_video: { videoId: string; fromFrames?: boolean };
  enrich_collection: { collectionId: string };
  finalize_collection: { collectionId: string };
  send_email: {
    kind: EmailKind;
    /** required for collection_ready / export */
    collectionId?: string;
    /** recipient override (export to another address) / recover_links address */
    to?: string;
    formats?: ExportFormat[];
    locale?: Locale;
  };
  cleanup: Record<string, never>;
}

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** skip enqueueing when a queued/running job of the same type has the same dedupeKey (stored in payload._dedupe) */
  dedupeKey?: string;
  /**
   * Only dedupe against *queued* jobs (ignore running ones). Use it to guarantee one more run after a
   * job that is already running (e.g. enrichment must see sources that finished while it was running).
   */
  dedupeQueuedOnly?: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const BACKOFF_BASE_MS = 30_000;
/** upper bound for a single back-off delay (keeps large maxAttempts values sane) */
export const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** running jobs whose lock is older than this are considered abandoned */
export const STALE_LOCK_MS = 30 * 60 * 1000;
const LAST_ERROR_MAX = 4000;

/** Back-off before the next attempt, given the number of attempts already made (≥ 1). */
export function backoffDelayMs(attempts: number): number {
  const n = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 4 ** (n - 1));
}

export async function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  opts?: EnqueueOptions,
): Promise<number | null> {
  const maxAttempts = Math.max(1, Math.floor(opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const body: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  const dedupeKey = opts?.dedupeKey;

  if (!dedupeKey) {
    const [row] = await db()
      .insert(jobs)
      .values({ type, payload: body, maxAttempts, ...(opts?.runAt ? { runAt: opts.runAt } : {}) })
      .returning({ id: jobs.id });
    return Number(row.id);
  }

  body._dedupe = dedupeKey;
  const activeStatuses: JobStatus[] = opts?.dedupeQueuedOnly ? ['queued'] : ['queued', 'running'];
  return db().transaction(async (tx) => {
    // Serialise concurrent enqueuers of the same (type, key) so the check + insert is atomic.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`exl-job:${type}:${dedupeKey}`}))`);
    const existing = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, type),
          inArray(jobs.status, activeStatuses),
          sql`${jobs.payload}->>'_dedupe' = ${dedupeKey}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return null;
    const [row] = await tx
      .insert(jobs)
      .values({ type, payload: body, maxAttempts, ...(opts?.runAt ? { runAt: opts.runAt } : {}) })
      .returning({ id: jobs.id });
    return Number(row.id);
  });
}

/**
 * Guarantees one *queued* job of `type` with `dedupeKey` that runs no later than `runAt` (default now):
 * inserts one when none is queued, otherwise pulls the existing job's run_at forward if needed.
 * Running jobs are ignored, so a job that is in progress always gets a follow-up run.
 */
export async function ensureQueuedJob<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  dedupeKey: string,
  opts?: { runAt?: Date; maxAttempts?: number },
): Promise<{ id: number; created: boolean }> {
  const maxAttempts = Math.max(1, Math.floor(opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const runAt = opts?.runAt;
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`exl-job:${type}:${dedupeKey}`}))`);
    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, type), eq(jobs.status, 'queued'), sql`${jobs.payload}->>'_dedupe' = ${dedupeKey}`))
      .orderBy(jobs.runAt)
      .limit(1);
    if (existing) {
      await tx
        .update(jobs)
        .set({
          runAt: runAt ? sql`least(${jobs.runAt}, ${runAt.toISOString()}::timestamptz)` : sql`least(${jobs.runAt}, now())`,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, existing.id));
      return { id: Number(existing.id), created: false };
    }
    const [row] = await tx
      .insert(jobs)
      .values({
        type,
        payload: { ...(payload as Record<string, unknown>), _dedupe: dedupeKey },
        maxAttempts,
        ...(runAt ? { runAt } : {}),
      })
      .returning({ id: jobs.id });
    return { id: Number(row.id), created: true };
  });
}

/* ------------------------------------------------------------------ */
/* Row mapping for raw SQL results                                     */
/* ------------------------------------------------------------------ */

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return new Date(Number.NaN);
}

function toDateOrNull(v: unknown): Date | null {
  return v === null || v === undefined ? null : toDate(v);
}

function toPayload(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

/** Maps a snake_case `jobs` row (raw SQL) to the Drizzle JobRow shape. */
export function mapJobRow(r: Record<string, unknown>): JobRow {
  return {
    id: Number(r.id),
    type: String(r.type) as JobType,
    payload: toPayload(r.payload),
    status: String(r.status) as JobStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    runAt: toDate(r.run_at),
    lockedAt: toDateOrNull(r.locked_at),
    lockedBy: r.locked_by === null || r.locked_by === undefined ? null : String(r.locked_by),
    lastError: r.last_error === null || r.last_error === undefined ? null : String(r.last_error),
    createdAt: toDate(r.created_at),
    updatedAt: toDate(r.updated_at),
  };
}

/** Atomically claims the next runnable job, or null. */
export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  const res = await db().execute<Record<string, unknown>>(sql`
    UPDATE jobs
       SET status = 'running',
           locked_at = now(),
           locked_by = ${workerId},
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
        WHERE status = 'queued' AND run_at <= now()
        ORDER BY run_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING *`);
  const row = res.rows[0];
  return row ? mapJobRow(row) : null;
}

export async function completeJob(id: number): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: 'done', lockedAt: null, updatedAt: sql`now()` })
    .where(eq(jobs.id, id));
}

/** Re-queues with back-off or marks failed after maxAttempts. Returns true when permanently failed. */
export async function failJob(job: JobRow, error: unknown): Promise<boolean> {
  const permanent = !isRetryable(error) || job.attempts >= job.maxAttempts;
  const message = describeError(error, LAST_ERROR_MAX);
  if (permanent) {
    await db()
      .update(jobs)
      .set({ status: 'failed', lockedAt: null, lockedBy: null, lastError: message, updatedAt: sql`now()` })
      .where(eq(jobs.id, job.id));
    return true;
  }
  const delaySec = backoffDelayMs(job.attempts) / 1000;
  await db()
    .update(jobs)
    .set({
      status: 'queued',
      runAt: sql`now() + make_interval(secs => ${delaySec})`,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      updatedAt: sql`now()`,
    })
    .where(eq(jobs.id, job.id));
  return false;
}

/** Heartbeat for long-running jobs so resetStaleJobs() on another worker does not steal them. */
export async function touchJob(id: number, workerId: string): Promise<boolean> {
  const res = await db()
    .update(jobs)
    .set({ lockedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
    .returning({ id: jobs.id });
  return res.length > 0;
}

/**
 * Puts running jobs of this worker back to `queued` without consuming an attempt
 * (graceful shutdown that could not wait for them to finish).
 */
export async function requeueJobs(ids: number[], workerId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db()
    .update(jobs)
    .set({
      status: 'queued',
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      runAt: sql`now()`,
      lockedAt: null,
      lockedBy: null,
      updatedAt: sql`now()`,
    })
    .where(and(inArray(jobs.id, ids), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
    .returning({ id: jobs.id });
  return res.length;
}

export interface StaleResetResult {
  /** jobs put back to `queued` */
  requeued: JobRow[];
  /** jobs that had already used all attempts (crashed on every try) → `failed` */
  failed: JobRow[];
}

/**
 * Running jobs locked more than 30 minutes ago → `queued` (their worker died). A job that already used
 * all of its attempts is marked `failed` instead, so a job that crashes the worker cannot loop forever.
 */
export async function resetStaleJobs(staleAfterMs: number = STALE_LOCK_MS): Promise<StaleResetResult> {
  const staleSec = Math.max(0, staleAfterMs) / 1000;
  const res = await db().execute<Record<string, unknown>>(sql`
    UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           last_error = CASE WHEN attempts >= max_attempts
                             THEN 'worker lost while running (stale lock)'
                             ELSE last_error END,
           run_at = now(),
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE status = 'running'
       AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => ${staleSec}))
    RETURNING *`);
  const rows = res.rows.map(mapJobRow);
  return {
    requeued: rows.filter((r) => r.status === 'queued'),
    failed: rows.filter((r) => r.status === 'failed'),
  };
}

/** Deletes finished jobs older than `days` (housekeeping, used by the cleanup job). */
export async function purgeFinishedJobs(days: number): Promise<number> {
  const res = await db().execute<Record<string, unknown>>(sql`
    DELETE FROM jobs
     WHERE status IN ('done', 'failed')
       AND updated_at < now() - make_interval(days => ${Math.max(1, Math.floor(days))})
    RETURNING id`);
  return res.rows.length;
}

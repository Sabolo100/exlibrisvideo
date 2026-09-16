/**
 * Small pure helpers of the worker entry (kept separate so tests can import them without starting
 * the worker).
 */
import type { JobRow } from '@/db/schema';

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Next full UTC hour – all workers agree on the same slot, so the cleanup dedupe key collapses them. */
export function nextFullHour(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

/** Payload fields that are safe to log (never e-mail addresses). */
export function payloadSummary(job: Pick<JobRow, 'payload'>): Record<string, unknown> {
  const p = job.payload ?? {};
  const out: Record<string, unknown> = {};
  for (const key of ['videoId', 'collectionId', 'kind', 'formats', 'locale']) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  return out;
}

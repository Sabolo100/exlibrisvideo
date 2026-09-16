/**
 * Collection completion (SPEC §4.6 hand-off + §4.7 finalize_collection).
 *
 * - scheduleCollectionCompletion: called whenever a source reaches a terminal state; enqueues
 *   enrich_collection once nothing else of the collection is still being processed / uploaded.
 * - runEnrichmentJob: stage `enrich` on done sources, enrichCollection (non-fatal), finalizeCollection.
 * - finalizeCollection: status ready / error, source file deletion, collection_ready e-mail.
 */
import fs from 'node:fs/promises';
import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, pool } from '@/db';
import { books, collections, videos } from '@/db/schema';
import { env } from '@/lib/env';
import { describeError } from '@/lib/jobs/errors';
import { enqueueJob, ensureQueuedJob } from '@/lib/jobs/queue';
import { enrichCollection } from '@/lib/pipeline/enrich';
import { abs } from '@/lib/storage';
import type { CollectionStatus, Locale, UploadStatus, VideoStatus } from '@/lib/types';

/** an upload without new bytes for this long no longer holds back enrichment */
export const UPLOAD_IDLE_MS = 30 * 60 * 1000;
/**
 * re-check delay while uploads are still in flight (short: the API's deleteSource does not enqueue
 * enrichment while this delayed re-check is queued, so it bounds the wait after an upload is removed)
 */
export const UPLOAD_RECHECK_MS = 2 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Source activity                                                     */
/* ------------------------------------------------------------------ */

export interface SourceSnapshot {
  id: string;
  status: VideoStatus;
  uploadStatus: UploadStatus;
  storagePath: string | null;
  createdAt: Date;
}

export interface SourceActivity {
  /** uploaded sources that still have to be processed (pending / queued / processing) */
  processing: number;
  /** uploads still receiving bytes (recent activity) */
  aliveUploads: number;
  done: number;
  error: number;
  uploaded: number;
}

async function lastUploadActivity(src: SourceSnapshot): Promise<number> {
  let t = src.createdAt.getTime();
  if (src.storagePath) {
    try {
      const st = await fs.stat(abs(src.storagePath));
      t = Math.max(t, st.mtimeMs);
    } catch {
      /* no bytes written yet */
    }
  }
  return t;
}

/** Pure classification (activity timestamps resolved by the caller). */
export function classifySources(
  sources: (SourceSnapshot & { lastActivityMs?: number })[],
  nowMs: number,
  idleMs: number = UPLOAD_IDLE_MS,
): SourceActivity {
  const a: SourceActivity = { processing: 0, aliveUploads: 0, done: 0, error: 0, uploaded: 0 };
  for (const s of sources) {
    if (s.uploadStatus === 'uploaded') {
      a.uploaded++;
      if (s.status === 'pending' || s.status === 'queued' || s.status === 'processing') a.processing++;
      else if (s.status === 'done') a.done++;
      else if (s.status === 'error') a.error++;
    } else if (s.uploadStatus === 'uploading') {
      const last = s.lastActivityMs ?? s.createdAt.getTime();
      if (nowMs - last < idleMs) a.aliveUploads++;
    }
  }
  return a;
}

export async function sourceActivity(collectionId: string): Promise<SourceActivity> {
  const rows: SourceSnapshot[] = await db()
    .select({
      id: videos.id,
      status: videos.status,
      uploadStatus: videos.uploadStatus,
      storagePath: videos.storagePath,
      createdAt: videos.createdAt,
    })
    .from(videos)
    .where(eq(videos.collectionId, collectionId));
  const withActivity = await Promise.all(
    rows.map(async (r) => (r.uploadStatus === 'uploading' ? { ...r, lastActivityMs: await lastUploadActivity(r) } : r)),
  );
  return classifySources(withActivity, Date.now());
}

export type CompletionDecision = 'wait_processing' | 'wait_uploads' | 'enrich';

export function completionDecision(a: SourceActivity): CompletionDecision {
  if (a.processing > 0) return 'wait_processing';
  if (a.aliveUploads > 0) return 'wait_uploads';
  return 'enrich';
}

/**
 * Called when a source of the collection reached done/error (or was purged). When no other source is
 * pending/queued/processing, enrichment is enqueued (dedupe key = collection id). While uploads are still
 * in flight a delayed re-check is queued instead, so an abandoned upload cannot block the collection.
 */
export async function scheduleCollectionCompletion(collectionId: string): Promise<CompletionDecision> {
  const activity = await sourceActivity(collectionId);
  const decision = completionDecision(activity);
  if (decision === 'enrich') {
    await ensureQueuedJob('enrich_collection', { collectionId }, collectionId);
  } else if (decision === 'wait_uploads') {
    await ensureQueuedJob('enrich_collection', { collectionId }, collectionId, {
      runAt: new Date(Date.now() + UPLOAD_RECHECK_MS),
    });
  }
  return decision;
}

/* ------------------------------------------------------------------ */
/* finalize_collection                                                 */
/* ------------------------------------------------------------------ */

export interface FinalizeResult {
  status: CollectionStatus | null;
  deletedSources: number;
  emailQueued: boolean;
}

/** Same rules as the API's recomputeCollectionStatus: `error` only when every uploaded source failed. */
export function computeCollectionStatus(a: SourceActivity, bookCount: number): CollectionStatus {
  if (a.processing > 0) return 'processing';
  if (a.uploaded === 0) return bookCount > 0 ? 'ready' : 'draft';
  if (a.done === 0 && a.error > 0) return 'error';
  return 'ready';
}

async function deleteProcessedSources(collectionId: string): Promise<number> {
  const rows = await db()
    .select({ id: videos.id, storagePath: videos.storagePath })
    .from(videos)
    .where(
      and(
        eq(videos.collectionId, collectionId),
        eq(videos.uploadStatus, 'uploaded'),
        inArray(videos.status, ['done', 'error']),
        isNotNull(videos.storagePath),
      ),
    );
  let deleted = 0;
  for (const row of rows) {
    if (!row.storagePath) continue;
    // Claim the row first (guards against a concurrent re-queue of this source).
    const claimed = await db()
      .update(videos)
      .set({ storagePath: null, sourceDeletedAt: new Date() })
      .where(and(eq(videos.id, row.id), inArray(videos.status, ['done', 'error']), eq(videos.storagePath, row.storagePath)))
      .returning({ id: videos.id });
    if (claimed.length === 0) continue;
    try {
      await fs.rm(abs(row.storagePath), { force: true });
      deleted++;
    } catch (err) {
      console.warn('[pipeline] finalize: source file removal failed', {
        videoId: row.id,
        error: describeError(err, 200),
      });
    }
  }
  return deleted;
}

export async function finalizeCollection(collectionId: string): Promise<FinalizeResult> {
  const [col] = await db()
    .select({
      id: collections.id,
      status: collections.status,
      email: collections.email,
      emailSentAt: collections.emailSentAt,
      locale: collections.locale,
    })
    .from(collections)
    .where(eq(collections.id, collectionId));
  if (!col) return { status: null, deletedSources: 0, emailQueued: false };

  const activity = await sourceActivity(collectionId);
  const [{ n: bookCount }] = await db().select({ n: count() }).from(books).where(eq(books.collectionId, collectionId));
  const status = computeCollectionStatus(activity, Number(bookCount));
  if (status !== col.status) {
    await db().update(collections).set({ status, updatedAt: new Date() }).where(eq(collections.id, collectionId));
  }

  let deletedSources = 0;
  if (env().DELETE_SOURCE_AFTER_PROCESSING) {
    deletedSources = await deleteProcessedSources(collectionId);
  }

  let emailQueued = false;
  if (status === 'ready' && col.email && !col.emailSentAt) {
    const locale: Locale = col.locale === 'en' ? 'en' : 'hu';
    const id = await enqueueJob(
      'send_email',
      { kind: 'collection_ready', collectionId, locale },
      { dedupeKey: `ready:${collectionId}` },
    );
    emailQueued = id !== null;
  }

  console.info('[pipeline] collection finalized', {
    collectionId,
    status,
    books: Number(bookCount),
    sourcesDone: activity.done,
    sourcesFailed: activity.error,
    deletedSources,
    emailQueued,
  });
  return { status, deletedSources, emailQueued };
}

/* ------------------------------------------------------------------ */
/* enrich_collection job                                               */
/* ------------------------------------------------------------------ */

const lockKey = (collectionId: string) => `exl-enrich:${collectionId}`;

async function collectionExists(collectionId: string): Promise<boolean> {
  const rows = await db().select({ id: collections.id }).from(collections).where(eq(collections.id, collectionId));
  return rows.length > 0;
}

export interface EnrichmentJobResult {
  skipped: CompletionDecision | 'missing' | null;
  enriched: number;
  covers: number;
  enrichError: string | null;
  finalize: FinalizeResult | null;
}

export async function runEnrichmentJob(collectionId: string): Promise<EnrichmentJobResult> {
  const out: EnrichmentJobResult = { skipped: null, enriched: 0, covers: 0, enrichError: null, finalize: null };
  if (!(await collectionExists(collectionId))) {
    out.skipped = 'missing';
    return out;
  }

  // One enrichment per collection at a time (a follow-up job waits for the running one).
  const client = await pool().connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey(collectionId)]);
    locked = true;

    const activity = await sourceActivity(collectionId);
    const decision = completionDecision(activity);
    if (decision !== 'enrich') {
      // A source is still being processed (it will schedule us again when done) or uploads are in
      // flight (re-check later). Nothing to do now.
      if (decision === 'wait_uploads') {
        await ensureQueuedJob('enrich_collection', { collectionId }, collectionId, {
          runAt: new Date(Date.now() + UPLOAD_RECHECK_MS),
        });
      }
      out.skipped = decision;
      console.info('[pipeline] enrichment postponed', { collectionId, reason: decision });
      return out;
    }

    await db()
      .update(videos)
      .set({ stage: 'enrich' })
      .where(and(eq(videos.collectionId, collectionId), eq(videos.status, 'done')));

    const started = Date.now();
    let lastLog = 0;
    try {
      const res = await enrichCollection(collectionId, (fraction) => {
        const now = Date.now();
        if (now - lastLog > 10_000) {
          lastLog = now;
          console.info('[pipeline] enrichment progress', {
            collectionId,
            percent: Math.round(Math.max(0, Math.min(1, fraction)) * 100),
          });
        }
      });
      out.enriched = res.enriched;
      out.covers = res.covers;
      console.info('[pipeline] enrichment done', {
        collectionId,
        enriched: res.enriched,
        covers: res.covers,
        ms: Date.now() - started,
      });
    } catch (err) {
      if (!(await collectionExists(collectionId).catch(() => true))) {
        // The owner deleted the collection while it was being enriched (typically surfaces as a failed
        // FK insert / missing rows): nothing left to finalize – give up quietly, no retry.
        console.info('[pipeline] enrichment stopped: collection deleted', { collectionId });
        out.skipped = 'missing';
        return out;
      }
      out.enrichError = describeError(err, 500);
      console.error('[pipeline] enrichment failed (continuing with finalize)', {
        collectionId,
        error: out.enrichError,
      });
    } finally {
      await db()
        .update(videos)
        .set({ stage: 'done' })
        .where(and(eq(videos.collectionId, collectionId), eq(videos.stage, 'enrich')));
    }

    out.finalize = await finalizeCollection(collectionId);
    return out;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey(collectionId)]).catch(() => {});
    }
    client.release();
  }
}

/** Number of sources of a collection that are not yet in a terminal state (used by tooling/tests). */
export async function countUnfinishedSources(collectionId: string): Promise<number> {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(videos)
    .where(and(eq(videos.collectionId, collectionId), inArray(videos.status, ['pending', 'queued', 'processing'])));
  return Number(r?.n ?? 0);
}

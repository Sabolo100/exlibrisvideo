/**
 * Ex Libris Video background worker – `npm run worker` (tsx src/worker/index.ts).
 *
 *  - loads .env.local / .env BEFORE any module that reads env() is imported (dynamic imports below)
 *  - runs migrations (advisory lock); re-queues orphaned running jobs at start and every 2 min
 *  - WORKER_CONCURRENCY slots poll the Postgres job queue every WORKER_POLL_MS
 *  - dispatches process_video / enrich_collection / finalize_collection / send_email / cleanup
 *  - schedules the hourly cleanup job (deduplicated across workers)
 *  - job loop + graceful SIGINT / SIGTERM in ./runtime.ts: stop claiming, wait up to
 *    WORKER_SHUTDOWN_GRACE_MS (default 20 s, below Coolify's 30 s stop timeout), abort, re-queue
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { nextFullHour } from './helpers';
import { WorkerRuntime } from './runtime';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const CLEANUP_CHECK_MS = 5 * 60_000;
const STALE_SWEEP_MS = 2 * 60_000;

type JobRow = import('@/db/schema').JobRow;

interface Modules {
  env: typeof import('@/lib/env');
  db: typeof import('@/db');
  migrate: typeof import('@/db/migrate');
  queue: typeof import('@/lib/jobs/queue');
  errors: typeof import('@/lib/jobs/errors');
  processVideo: typeof import('@/lib/pipeline/process-video');
  finalize: typeof import('@/lib/pipeline/finalize');
  cleanup: typeof import('@/lib/pipeline/cleanup');
  email: typeof import('@/lib/email');
}

async function loadModules(): Promise<Modules> {
  const [env, db, migrate, queue, errors, processVideo, finalize, cleanup, email] = await Promise.all([
    import('@/lib/env'),
    import('@/db'),
    import('@/db/migrate'),
    import('@/lib/jobs/queue'),
    import('@/lib/jobs/errors'),
    import('@/lib/pipeline/process-video'),
    import('@/lib/pipeline/finalize'),
    import('@/lib/pipeline/cleanup'),
    import('@/lib/email'),
  ]);
  return { env, db, migrate, queue, errors, processVideo, finalize, cleanup, email };
}

async function main(): Promise<void> {
  const m = await loadModules();
  const e = m.env.env();
  const { PipelineError, describeError, videoErrorCodeOf } = m.errors;
  const workerId = `${os.hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  const concurrency = Math.max(1, e.WORKER_CONCURRENCY);
  const pollMs = Math.max(100, e.WORKER_POLL_MS);

  console.info('[worker] starting', { workerId, concurrency, pollMs, node: process.version });

  await m.migrate.runMigrations();
  console.info('[worker] migrations applied');

  // Running jobs send a heartbeat every 60 s, so one silent for WORKER_STALE_JOB_MS lost its worker
  // (SIGKILL during a redeploy, OOM, host restart). Swept at start and periodically, so a job orphaned by
  // another container is picked up without waiting for this worker to restart.
  const staleAfterMs = Math.max(3 * 60_000, e.WORKER_STALE_JOB_MS);
  const sweepStaleJobs = async () => {
    const stale = await m.queue.resetStaleJobs(staleAfterMs);
    if (stale.requeued.length > 0 || stale.failed.length > 0) {
      console.warn('[worker] reset stale jobs', {
        requeued: stale.requeued.map((j) => j.id),
        failed: stale.failed.map((j) => j.id),
      });
    }
    for (const job of stale.requeued) {
      if (job.type === 'process_video' && typeof job.payload.videoId === 'string') {
        await m.processVideo
          .markVideoRetrying(job.payload.videoId)
          .catch((err: unknown) => console.error('[worker] could not mark stale video queued', { error: describeError(err, 200) }));
      }
    }
    for (const job of stale.failed) {
      if (job.type === 'process_video' && typeof job.payload.videoId === 'string') {
        await m.processVideo
          .markVideoFailed(job.payload.videoId, 'internal', 'worker lost while processing')
          .catch((err: unknown) => console.error('[worker] could not mark stale video failed', { error: describeError(err, 200) }));
      }
    }
  };
  await sweepStaleJobs();

  /* ---------------- dispatch ---------------- */

  const requireString = (job: JobRow, key: string): string => {
    const v = job.payload[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new PipelineError('internal', `job ${job.id} (${job.type}) has no ${key}`, { retryable: false });
    }
    return v;
  };

  const dispatch = async (job: JobRow, signal: AbortSignal): Promise<unknown> => {
    switch (job.type) {
      case 'process_video':
        return m.processVideo.processVideo(requireString(job, 'videoId'), { signal, fromFrames: job.payload.fromFrames === true });
      case 'enrich_collection':
        return m.finalize.runEnrichmentJob(requireString(job, 'collectionId'));
      case 'finalize_collection':
        return m.finalize.finalizeCollection(requireString(job, 'collectionId'));
      case 'send_email': {
        const { _dedupe, ...rest } = job.payload;
        void _dedupe;
        const kind = rest.kind;
        if (kind !== 'collection_ready' && kind !== 'export' && kind !== 'recover_links') {
          throw new PipelineError('internal', `job ${job.id} has an invalid e-mail kind`, { retryable: false });
        }
        await m.email.handleSendEmailJob(rest as unknown as import('@/lib/jobs/queue').JobPayloads['send_email']);
        return { kind };
      }
      case 'cleanup':
        return m.cleanup.runCleanup();
      default:
        throw new PipelineError('internal', `unknown job type ${String(job.type)}`, { retryable: false });
    }
  };

  /* ---------------- job loop ---------------- */

  const markVideo = async (job: JobRow, fn: (videoId: string) => Promise<void>) => {
    if (job.type !== 'process_video' || typeof job.payload.videoId !== 'string') return;
    await fn(job.payload.videoId);
  };

  const runtime = new WorkerRuntime(
    {
      claimNextJob: m.queue.claimNextJob,
      completeJob: m.queue.completeJob,
      failJob: m.queue.failJob,
      touchJob: m.queue.touchJob,
      requeueJobs: m.queue.requeueJobs,
      dispatch,
      describeError,
      afterFailure: (job, err, permanent) =>
        markVideo(job, (videoId) =>
          permanent
            ? m.processVideo.markVideoFailed(videoId, videoErrorCodeOf(err), describeError(err, 300))
            : m.processVideo.markVideoRetrying(videoId),
        ),
      afterRequeue: (job) => markVideo(job, (videoId) => m.processVideo.markVideoRetrying(videoId)),
    },
    { workerId, concurrency, pollMs, shutdownGraceMs: Math.max(1_000, e.WORKER_SHUTDOWN_GRACE_MS) },
  );

  /* ---------------- hourly cleanup ---------------- */

  const scheduleCleanup = async () => {
    try {
      await m.queue.enqueueJob('cleanup', {}, { dedupeKey: 'cleanup', runAt: nextFullHour(), maxAttempts: 1 });
    } catch (err) {
      console.warn('[worker] could not schedule cleanup', { error: describeError(err, 200) });
    }
  };
  await scheduleCleanup();
  const cleanupTimer = setInterval(() => void scheduleCleanup(), CLEANUP_CHECK_MS);
  cleanupTimer.unref();
  const staleTimer = setInterval(() => {
    sweepStaleJobs().catch((err: unknown) => console.warn('[worker] stale job sweep failed', { error: describeError(err, 200) }));
  }, STALE_SWEEP_MS);
  staleTimer.unref();

  /* ---------------- shutdown ---------------- */

  let exiting = false;
  const shutdown = (signal: string) => {
    if (exiting) {
      console.warn('[worker] second signal – exiting immediately', { signal });
      process.exit(1);
    }
    exiting = true;
    clearInterval(cleanupTimer);
    clearInterval(staleTimer);
    void runtime
      .stop(signal)
      .catch((err: unknown) => console.error('[worker] shutdown failed', { error: describeError(err, 300) }))
      .finally(async () => {
        await m.db.pool().end().catch(() => {});
        console.info('[worker] stopped');
        process.exit(0);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[worker] unhandled rejection', { error: describeError(reason, 500) });
  });

  console.info('[worker] ready', { workerId });
  await runtime.start();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error('[worker] fatal', { error: msg });
  process.exit(1);
});

/**
 * Worker job loop (SPEC §4.8), independent of the concrete modules so it can be unit tested:
 *
 *  - `concurrency` slots, each claims a job, runs it, then claims the next one (poll every `pollMs`
 *    when the queue is empty)
 *  - heartbeat (touchJob) while a job runs, so a restarting worker does not treat it as stale
 *  - success → completeJob; failure → failJob (+ afterFailure hook, e.g. mark the video)
 *  - one log line per job start / end with duration
 *  - stop(): stop claiming, wait up to `shutdownGraceMs` for running jobs, then abort them, wait
 *    `abortGraceMs`, and re-queue whatever is still running (no attempt consumed)
 */
import type { JobRow } from '@/db/schema';
import { isAbortError, payloadSummary } from './helpers';

export interface WorkerDeps {
  claimNextJob: (workerId: string) => Promise<JobRow | null>;
  completeJob: (id: number) => Promise<void>;
  /** returns true when the job failed permanently */
  failJob: (job: JobRow, error: unknown) => Promise<boolean>;
  touchJob: (id: number, workerId: string) => Promise<boolean>;
  requeueJobs: (ids: number[], workerId: string) => Promise<number>;
  dispatch: (job: JobRow, signal: AbortSignal) => Promise<unknown>;
  /** called after failJob (permanent = no more attempts) */
  afterFailure?: (job: JobRow, error: unknown, permanent: boolean) => Promise<void>;
  /** called for a job that was re-queued because the worker shut down */
  afterRequeue?: (job: JobRow) => Promise<void>;
  describeError: (error: unknown, maxLength?: number) => string;
}

export interface WorkerLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

export interface WorkerOptions {
  workerId: string;
  concurrency: number;
  pollMs: number;
  shutdownGraceMs?: number;
  abortGraceMs?: number;
  heartbeatMs?: number;
  logger?: WorkerLogger;
}

export const SHUTDOWN_GRACE_MS = 60_000;
export const ABORT_GRACE_MS = 5_000;
export const HEARTBEAT_MS = 60_000;

const consoleLogger: WorkerLogger = {
  info: (m, d) => (d ? console.info(m, d) : console.info(m)),
  warn: (m, d) => (d ? console.warn(m, d) : console.warn(m)),
  error: (m, d) => (d ? console.error(m, d) : console.error(m)),
};

interface RunningJob {
  job: JobRow;
  controller: AbortController;
  startedAt: number;
  requeued: boolean;
}

export interface StopResult {
  /** jobs that finished (or failed) within the grace period */
  graceful: boolean;
  /** ids re-queued because they were still running after abort */
  requeued: number[];
}

export class WorkerRuntime {
  private readonly deps: WorkerDeps;
  private readonly opts: Required<Omit<WorkerOptions, 'logger'>>;
  private readonly log: WorkerLogger;
  private stopping = false;
  private readonly running = new Map<number, RunningJob>();
  private readonly sleepers = new Set<() => void>();
  private slots: Promise<void>[] = [];
  private stopPromise: Promise<StopResult> | null = null;

  constructor(deps: WorkerDeps, opts: WorkerOptions) {
    this.deps = deps;
    this.opts = {
      workerId: opts.workerId,
      concurrency: Math.max(1, Math.floor(opts.concurrency)),
      pollMs: Math.max(10, Math.floor(opts.pollMs)),
      shutdownGraceMs: opts.shutdownGraceMs ?? SHUTDOWN_GRACE_MS,
      abortGraceMs: opts.abortGraceMs ?? ABORT_GRACE_MS,
      heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS,
    };
    this.log = opts.logger ?? consoleLogger;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  get runningJobIds(): number[] {
    return [...this.running.keys()];
  }

  /** Starts the slots; resolves once every slot has stopped (after stop()). */
  start(): Promise<void> {
    if (this.slots.length === 0) {
      this.slots = Array.from({ length: this.opts.concurrency }, (_, i) => this.slot(i));
    }
    return Promise.allSettled(this.slots).then(() => undefined);
  }

  /** Graceful stop (idempotent). */
  stop(reason = 'stop'): Promise<StopResult> {
    if (!this.stopPromise) this.stopPromise = this.doStop(reason);
    return this.stopPromise;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  private async slot(index: number): Promise<void> {
    // stagger the slots so they do not hit the DB in lock-step
    if (index > 0) await this.sleep(Math.floor((this.opts.pollMs / this.opts.concurrency) * index));
    while (!this.stopping) {
      let job: JobRow | null = null;
      try {
        job = await this.deps.claimNextJob(this.opts.workerId);
      } catch (err) {
        this.log.error('[worker] claim failed', { slot: index, error: this.deps.describeError(err, 300) });
        await this.sleep(Math.min(30_000, this.opts.pollMs * 5));
        continue;
      }
      if (!job) {
        await this.sleep(this.opts.pollMs);
        continue;
      }
      if (this.stopping) {
        // claimed while a stop was being requested: hand it straight back
        await this.deps.requeueJobs([job.id], this.opts.workerId).catch(() => 0);
        break;
      }
      await this.runJob(job);
    }
  }

  private async runJob(job: JobRow): Promise<void> {
    const entry: RunningJob = { job, controller: new AbortController(), startedAt: Date.now(), requeued: false };
    this.running.set(job.id, entry);
    const heartbeat = setInterval(() => {
      this.deps
        .touchJob(job.id, this.opts.workerId)
        .catch((err: unknown) => this.log.warn('[worker] heartbeat failed', { id: job.id, error: this.deps.describeError(err, 200) }));
    }, this.opts.heartbeatMs);
    heartbeat.unref?.();
    this.log.info('[worker] job started', {
      id: job.id,
      type: job.type,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      ...payloadSummary(job),
    });
    try {
      const result = await this.deps.dispatch(job, entry.controller.signal);
      if (entry.requeued) return; // shutdown already handed it back
      await this.deps.completeJob(job.id);
      const status = result && typeof result === 'object' && 'status' in result ? (result as { status: unknown }).status : undefined;
      this.log.info('[worker] job finished', {
        id: job.id,
        type: job.type,
        ok: true,
        ...(status !== undefined ? { result: status } : {}),
        ms: Date.now() - entry.startedAt,
      });
    } catch (err) {
      if (entry.requeued) return;
      if (this.stopping && (isAbortError(err) || entry.controller.signal.aborted)) {
        entry.requeued = true;
        const n = await this.deps.requeueJobs([job.id], this.opts.workerId).catch(() => 0);
        await this.deps.afterRequeue?.(job).catch(() => {});
        this.log.warn('[worker] job interrupted by shutdown, re-queued', {
          id: job.id,
          type: job.type,
          requeued: n > 0,
          ms: Date.now() - entry.startedAt,
        });
        return;
      }
      let permanent = false;
      try {
        permanent = await this.deps.failJob(job, err);
      } catch (failErr) {
        this.log.error('[worker] failJob failed', { id: job.id, error: this.deps.describeError(failErr, 300) });
      }
      this.log.error('[worker] job finished', {
        id: job.id,
        type: job.type,
        ok: false,
        permanent,
        attempt: job.attempts,
        error: this.deps.describeError(err, 500),
        ms: Date.now() - entry.startedAt,
      });
      if (this.deps.afterFailure) {
        try {
          await this.deps.afterFailure(job, err, permanent);
        } catch (hookErr) {
          this.log.error('[worker] failure handling failed', { id: job.id, error: this.deps.describeError(hookErr, 300) });
        }
      }
    } finally {
      clearInterval(heartbeat);
      this.running.delete(job.id);
    }
  }

  private async doStop(reason: string): Promise<StopResult> {
    this.stopping = true;
    [...this.sleepers].forEach((wake) => wake());
    this.log.info('[worker] shutting down', { reason, runningJobs: this.runningJobIds });
    const allDone = Promise.allSettled(this.slots).then(() => 'done' as const);
    const timeout = (ms: number) =>
      new Promise<'timeout'>((resolve) => {
        const t = setTimeout(() => resolve('timeout'), ms);
        t.unref?.();
      });
    if ((await Promise.race([allDone, timeout(this.opts.shutdownGraceMs)])) === 'done' || this.running.size === 0) {
      await allDone;
      return { graceful: true, requeued: [] };
    }
    this.log.warn('[worker] grace period over, aborting running jobs', { jobs: this.runningJobIds });
    for (const r of this.running.values()) r.controller.abort();
    await Promise.race([allDone, timeout(this.opts.abortGraceMs)]);
    const leftovers = [...this.running.values()].filter((r) => !r.requeued);
    if (leftovers.length === 0) return { graceful: false, requeued: [] };
    for (const r of leftovers) r.requeued = true;
    const ids = leftovers.map((r) => r.job.id);
    const n = await this.deps.requeueJobs(ids, this.opts.workerId).catch(() => 0);
    for (const r of leftovers) await this.deps.afterRequeue?.(r.job).catch(() => {});
    this.log.warn('[worker] re-queued unfinished jobs', { ids, requeued: n });
    return { graceful: false, requeued: ids };
  }
}

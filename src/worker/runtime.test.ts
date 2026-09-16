import { describe, expect, it, vi } from 'vitest';
import type { JobRow } from '@/db/schema';
import { WorkerRuntime, type WorkerDeps, type WorkerLogger } from './runtime';

const job = (id: number, type: JobRow['type'] = 'process_video', payload: Record<string, unknown> = { videoId: `v${id}` }): JobRow => ({
  id,
  type,
  payload,
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date(),
  lockedAt: new Date(),
  lockedBy: 'w',
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(queue: JobRow[], dispatch: WorkerDeps['dispatch']) {
  const lines: { level: string; msg: string; data?: Record<string, unknown> }[] = [];
  const logger: WorkerLogger = {
    info: (msg, data) => lines.push({ level: 'info', msg, data }),
    warn: (msg, data) => lines.push({ level: 'warn', msg, data }),
    error: (msg, data) => lines.push({ level: 'error', msg, data }),
  };
  const deps = {
    claimNextJob: vi.fn(async () => queue.shift() ?? null),
    completeJob: vi.fn(async (_id: number) => {}),
    failJob: vi.fn(async (j: JobRow) => j.attempts >= j.maxAttempts),
    touchJob: vi.fn(async () => true),
    requeueJobs: vi.fn(async (ids: number[], _workerId: string) => ids.length),
    dispatch: vi.fn(dispatch),
    afterFailure: vi.fn(async (_job: JobRow, _error: unknown, _permanent: boolean) => {}),
    afterRequeue: vi.fn(async (_job: JobRow) => {}),
    describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  } satisfies WorkerDeps;
  return { deps, lines, logger };
}

describe('WorkerRuntime', () => {
  it('runs jobs in parallel slots, completes successes and fails errors with one start/end log line each', async () => {
    const queue = [job(1), job(2), job(3, 'send_email', { kind: 'export', to: 'secret@example.com' })];
    const { deps, lines, logger } = harness(queue, async (j) => {
      await sleep(20);
      if (j.id === 2) throw new Error('boom');
      return { status: 'done' };
    });
    const rt = new WorkerRuntime(deps, { workerId: 'w', concurrency: 2, pollMs: 10, logger });
    const started = rt.start();
    while (deps.completeJob.mock.calls.length + deps.failJob.mock.calls.length < 3) await sleep(5);
    const res = await rt.stop('test');
    await started;

    expect(res).toEqual({ graceful: true, requeued: [] });
    expect(deps.completeJob.mock.calls.map((c) => c[0]).sort()).toEqual([1, 3]);
    expect(deps.failJob).toHaveBeenCalledTimes(1);
    expect(deps.afterFailure).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), expect.any(Error), false);
    const starts = lines.filter((l) => l.msg === '[worker] job started');
    const ends = lines.filter((l) => l.msg === '[worker] job finished');
    expect(starts).toHaveLength(3);
    expect(ends).toHaveLength(3);
    expect(ends.every((l) => typeof l.data?.ms === 'number')).toBe(true);
    expect(ends.find((l) => l.data?.id === 1)?.data).toMatchObject({ ok: true, result: 'done' });
    expect(ends.find((l) => l.data?.id === 2)).toMatchObject({ level: 'error', data: { ok: false, error: 'boom' } });
    // recipient addresses never reach the log
    expect(JSON.stringify(lines)).not.toContain('secret@example.com');
    expect(deps.dispatch).toHaveBeenCalledTimes(3);
  });

  it('stop() waits for running jobs within the grace period and stops claiming', async () => {
    const queue = [job(1), job(2)];
    let finished = false;
    const { deps, logger } = harness(queue, async () => {
      await sleep(80);
      finished = true;
    });
    const rt = new WorkerRuntime(deps, { workerId: 'w', concurrency: 1, pollMs: 10, shutdownGraceMs: 2000, logger });
    const started = rt.start();
    while (rt.runningJobIds.length === 0) await sleep(2);
    const res = await rt.stop('SIGTERM');
    await started;
    expect(finished).toBe(true);
    expect(res.graceful).toBe(true);
    expect(deps.completeJob).toHaveBeenCalledWith(1);
    expect(deps.dispatch).toHaveBeenCalledTimes(1); // job 2 was never claimed
    expect(queue.map((j) => j.id)).toEqual([2]);
    expect(deps.requeueJobs).not.toHaveBeenCalled();
  });

  it('after the grace period aborts running jobs and re-queues them without failing them', async () => {
    const { deps, lines, logger } = harness([job(7), job(8, 'enrich_collection', { collectionId: 'c' })], (j, signal) =>
      new Promise((resolve, reject) => {
        if (j.id === 7) {
          // honours the abort signal
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        } else {
          // ignores it (e.g. a long AI call) – re-queued after the abort grace
          setTimeout(() => resolve('late'), 2000);
        }
      }),
    );
    const rt = new WorkerRuntime(deps, { workerId: 'w', concurrency: 2, pollMs: 10, shutdownGraceMs: 50, abortGraceMs: 50, logger });
    void rt.start();
    while (rt.runningJobIds.length < 2) await sleep(2);
    const res = await rt.stop('SIGTERM');
    expect(res).toEqual({ graceful: false, requeued: [8] });
    expect(deps.requeueJobs.mock.calls.map((c) => c[0])).toEqual([[7], [8]]);
    expect(deps.afterRequeue.mock.calls.map((c) => c[0].id).sort()).toEqual([7, 8]);
    expect(deps.failJob).not.toHaveBeenCalled();
    expect(deps.completeJob).not.toHaveBeenCalled();
    expect(lines.some((l) => l.msg === '[worker] job interrupted by shutdown, re-queued' && l.data?.id === 7)).toBe(true);
  });

  it('keeps polling after claim errors', async () => {
    let calls = 0;
    const { deps, logger } = harness([], async () => undefined);
    deps.claimNextJob.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('db down');
      return null;
    });
    const rt = new WorkerRuntime(deps, { workerId: 'w', concurrency: 1, pollMs: 10, logger });
    const started = rt.start();
    await sleep(120);
    await rt.stop('test');
    await started;
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('hands back a job that was claimed while stop() was requested', async () => {
    const { deps, logger } = harness([], async () => undefined);
    let rt: WorkerRuntime | null = null;
    let stopped: Promise<unknown> | null = null;
    deps.claimNextJob.mockImplementation(async () => {
      stopped = rt!.stop('SIGTERM');
      return job(42);
    });
    rt = new WorkerRuntime(deps, { workerId: 'w', concurrency: 1, pollMs: 10, logger });
    await rt.start();
    await stopped;
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.requeueJobs).toHaveBeenCalledWith([42], 'w');
  });
});

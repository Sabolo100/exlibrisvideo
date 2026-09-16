import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn<() => Promise<void>>(),
  storageRoot: vi.fn<() => string>(),
  pool: vi.fn<() => EventEmitter>(),
}));

vi.mock('@/db/migrate', () => ({ runMigrations: mocks.runMigrations }));
vi.mock('@/lib/env', () => ({ storageRoot: mocks.storageRoot }));
vi.mock('@/db', () => ({ pool: mocks.pool }));

import { register } from './instrumentation';

type ConsoleSpy = MockInstance<(...args: unknown[]) => void>;

let tmp: string;
let fakePool: EventEmitter;
let infoSpy: ConsoleSpy;
let errorSpy: ConsoleSpy;
let warnSpy: ConsoleSpy;

const logged = (spy: ConsoleSpy) => spy.mock.calls.map((call: unknown[]) => JSON.stringify(call)).join('\n');

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'exlibris-instr-'));
  globalThis.__exlibrisBoot = undefined;
  mocks.runMigrations.mockReset().mockResolvedValue(undefined);
  mocks.storageRoot.mockReset().mockReturnValue(path.join(tmp, 'storage', 'nested'));
  fakePool = new EventEmitter();
  mocks.pool.mockReset().mockReturnValue(fakePool);
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NEXT_PHASE', '');
  vi.stubEnv('DATABASE_URL', 'postgres://postgres:sup3r-secret@exlibris-pg:5432/postgres');
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.__exlibrisBoot = undefined;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('instrumentation register()', () => {
  it('does nothing outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.storageRoot).not.toHaveBeenCalled();
    expect(globalThis.__exlibrisBoot).toBeUndefined();
  });

  it('does nothing during next build', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await register();
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.storageRoot).not.toHaveBeenCalled();
  });

  it('creates the storage directory, leaves no probe file and migrates exactly once', async () => {
    await register();
    await register();
    const root = path.join(tmp, 'storage', 'nested');
    expect((await fs.stat(root)).isDirectory()).toBe(true);
    expect(await fs.readdir(root)).toEqual([]);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
    expect(logged(infoSpy)).toContain('database migrations applied');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps a lost idle database connection from crashing the process', async () => {
    await register();
    await register();
    expect(mocks.pool).toHaveBeenCalledTimes(1);
    expect(fakePool.listenerCount('error')).toBe(1);
    // without a listener EventEmitter#emit('error') throws – that is what killed the process
    expect(() => fakePool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    expect(logged(errorSpy)).toContain('idle PostgreSQL connection lost');
    expect(logged(errorSpy)).toContain('administrator command');
  });

  it('does not add a second pool error listener when one already exists', async () => {
    fakePool.on('error', () => {});
    await register();
    expect(fakePool.listenerCount('error')).toBe(1);
  });

  it('still migrates when the pool cannot be created', async () => {
    mocks.pool.mockImplementation(() => {
      throw new Error('Invalid environment configuration: DATABASE_URL');
    });
    await expect(register()).resolves.toBeUndefined();
    expect(logged(warnSpy)).toContain('could not attach the database pool error handler');
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
  });

  it('logs loudly but keeps booting when the storage is not writable', async () => {
    const file = path.join(tmp, 'not-a-dir');
    await fs.writeFile(file, 'x');
    mocks.storageRoot.mockReturnValue(path.join(file, 'storage'));
    await expect(register()).resolves.toBeUndefined();
    expect(logged(errorSpy)).toContain('STORAGE NOT WRITABLE');
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
  });

  it('survives an invalid environment (storageRoot throws)', async () => {
    mocks.storageRoot.mockImplementation(() => {
      throw new Error('Invalid environment configuration');
    });
    await expect(register()).resolves.toBeUndefined();
    expect(logged(errorSpy)).toContain('Invalid environment configuration');
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
  });

  it('does not throw when migrations fail, never logs credentials, and retries in the background', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.runMigrations
      .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValue(undefined);

    await expect(register()).resolves.toBeUndefined();
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
    const firstErrors = logged(errorSpy);
    expect(firstErrors).toContain('DATABASE MIGRATION FAILED');
    expect(firstErrors).toContain('exlibris-pg:5432/postgres');
    expect(firstErrors).toContain('ECONNREFUSED');
    expect(firstErrors).not.toContain('sup3r-secret');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(2);
    expect(logged(errorSpy)).toContain('STILL FAILING');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(3);
    expect(logged(infoSpy)).toContain('applied after retry');

    // success stops the retry loop
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(3);
    expect(logged(errorSpy) + logged(infoSpy)).not.toContain('sup3r-secret');
  });

  it('times out a hanging migration instead of blocking the server forever', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.runMigrations.mockReturnValueOnce(new Promise<void>(() => {})).mockResolvedValue(undefined);
    const booting = register();
    // storage setup does real (unfaked) I/O first – wait until the migration has actually started
    for (let i = 0; i < 2_000 && mocks.runMigrations.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(booting).resolves.toBeUndefined();
    expect(logged(errorSpy)).toContain('timed out after 120 s');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.runMigrations).toHaveBeenCalledTimes(2);
    expect(logged(infoSpy)).toContain('applied after retry');
  });
});

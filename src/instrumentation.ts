/**
 * Next.js instrumentation hook – runs once when a server instance boots (owner: devops).
 *
 *  - Node.js runtime only (never in the Edge runtime) and never during `next build`
 *    (Next sets NEXT_PHASE=phase-production-build for its prerender workers).
 *  - makes sure STORAGE_DIR exists and is writable by the app user
 *  - keeps a lost idle PostgreSQL connection from crashing the server (pool 'error' listener)
 *  - applies pending SQL migrations (`runMigrations()` takes a Postgres advisory lock, so the
 *    worker container migrating at the same moment is safe)
 *
 * Failures are logged loudly but never crash the server: /api/health keeps answering
 * (503 while the database is unreachable) and failed migrations are retried in the
 * background with back-off, so a Postgres that comes up after the web app heals itself.
 *
 * Every Node-only import sits lexically inside the `NEXT_RUNTIME === 'nodejs'` branch so the
 * Edge compilation of this file drops them (Next.js recommended pattern).
 */

const BUILD_PHASE = 'phase-production-build';
const MIGRATION_TIMEOUT_MS = 120_000;
/** delays between background migration retries (the last one repeats until success) */
const MIGRATION_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

declare global {
  // eslint-disable-next-line no-var
  var __exlibrisBoot: Promise<void> | undefined;
}

interface StorageDeps {
  mkdir: (dir: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (file: string, data: string) => Promise<void>;
  rm: (file: string, opts: { force: true }) => Promise<void>;
  join: (...parts: string[]) => string;
  storageRoot: () => string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return `${err.name}${code ? ` [${code}]` : ''}: ${err.message}`.slice(0, 500);
  }
  return String(err).slice(0, 500);
}

/** Host, port and database of a Postgres URL – never the credentials (safe to log). */
function describeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return '(DATABASE_URL not set – development default)';
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || '5432'}${u.pathname || ''}`;
  } catch {
    return '(unparsable DATABASE_URL)';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureStorage(deps: StorageDeps): Promise<boolean> {
  let root = '(unknown)';
  try {
    root = deps.storageRoot();
    await deps.mkdir(root, { recursive: true });
    // A real write probe catches read-only mounts and wrong ownership (access(W_OK) is not enough on some mounts).
    const probe = deps.join(root, `.write-probe-${process.pid}-${Date.now()}`);
    await deps.writeFile(probe, 'ok');
    await deps.rm(probe, { force: true });
    console.info('[boot] storage ready', { storageDir: root });
    return true;
  } catch (err) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const gid = typeof process.getgid === 'function' ? process.getgid() : undefined;
    console.error('[boot] !!! STORAGE NOT WRITABLE – uploads, frames and spine images will fail !!!', {
      storageDir: root,
      error: errorMessage(err),
      uid,
      gid,
      hint:
        uid !== undefined
          ? `on the host: chown -R ${uid}:${gid ?? uid} <the host directory mounted at ${root}>`
          : 'check STORAGE_DIR and the permissions of that directory',
    });
    return false;
  }
}

/** Minimal view of pg.Pool: only what the idle-client error guard needs. */
interface ErrorEmitter {
  listenerCount: (event: 'error') => number;
  on: (event: 'error', listener: (err: Error) => void) => unknown;
}

/**
 * node-postgres emits 'error' on the pool when an IDLE client loses its connection (Postgres
 * restarted, Coolify database update, network blip). Without a listener Node treats that as an
 * unhandled 'error' event and kills the whole web server. With it, the broken client is simply
 * discarded and the next query opens a fresh connection.
 */
function guardPoolErrors(getPool: () => ErrorEmitter): void {
  try {
    const p = getPool();
    if (p.listenerCount('error') > 0) return; // someone (e.g. src/db) already handles it
    p.on('error', (err) => {
      console.error('[db] idle PostgreSQL connection lost – it will be re-opened on the next query', {
        error: errorMessage(err),
      });
    });
  } catch (err) {
    // pool() throws only for an invalid environment – the migration step logs that loudly
    console.warn('[boot] could not attach the database pool error handler', { error: errorMessage(err) });
  }
}

function scheduleMigrationRetry(run: () => Promise<void>, target: string, attempt: number): void {
  const delay = MIGRATION_RETRY_DELAYS_MS[Math.min(attempt, MIGRATION_RETRY_DELAYS_MS.length - 1)];
  const timer = setTimeout(() => {
    withTimeout(run(), MIGRATION_TIMEOUT_MS, 'database migration')
      .then(() => console.info('[boot] database migrations applied after retry', { database: target, attempt: attempt + 1 }))
      .catch((err: unknown) => {
        const next = MIGRATION_RETRY_DELAYS_MS[Math.min(attempt + 1, MIGRATION_RETRY_DELAYS_MS.length - 1)];
        console.error('[boot] !!! DATABASE MIGRATION STILL FAILING !!!', {
          database: target,
          attempt: attempt + 1,
          nextRetrySec: Math.round(next / 1000),
          error: errorMessage(err),
        });
        scheduleMigrationRetry(run, target, attempt + 1);
      });
  }, delay);
  // a pending retry must never keep the process alive on shutdown
  timer.unref?.();
}

/** Resolves true when the first attempt succeeded; on failure it keeps retrying in the background. */
async function migrateWithRetry(run: () => Promise<void>): Promise<boolean> {
  const target = describeDatabaseUrl(process.env.DATABASE_URL);
  const started = Date.now();
  try {
    await withTimeout(run(), MIGRATION_TIMEOUT_MS, 'database migration');
    console.info('[boot] database migrations applied', { database: target, ms: Date.now() - started });
    return true;
  } catch (err) {
    console.error('[boot] !!! DATABASE MIGRATION FAILED – the app cannot work until this is fixed; retrying in the background !!!', {
      database: target,
      error: errorMessage(err),
      hint: 'check DATABASE_URL (Coolify: the Postgres "Internal URL") and that the database runs; manual run: npm run db:migrate',
    });
    scheduleMigrationRetry(run, target, 0);
    return false;
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === BUILD_PHASE) return;
    // once per process, even if Next evaluates the hook again (dev reloads)
    if (!globalThis.__exlibrisBoot) {
      globalThis.__exlibrisBoot = (async () => {
        console.info('[boot] web server starting', { node: process.version, env: process.env.NODE_ENV, pid: process.pid });
        const [fs, path, envModule] = await Promise.all([import('node:fs/promises'), import('node:path'), import('@/lib/env')]);
        await ensureStorage({
          mkdir: (dir, opts) => fs.mkdir(dir, opts),
          writeFile: (file, data) => fs.writeFile(file, data),
          rm: (file, opts) => fs.rm(file, opts),
          join: (...parts) => path.join(...parts),
          storageRoot: envModule.storageRoot,
        });
        await import('@/db')
          .then((dbModule) => guardPoolErrors(dbModule.pool))
          .catch((err: unknown) =>
            console.warn('[boot] could not attach the database pool error handler', { error: errorMessage(err) }),
          );
        await migrateWithRetry(async () => {
          const { runMigrations } = await import('@/db/migrate');
          await runMigrations();
        });
      })().catch((err: unknown) => {
        // the steps handle their own errors; this is the last line of defence – never crash the server
        console.error('[boot] !!! UNEXPECTED STARTUP ERROR !!!', { error: errorMessage(err) });
      });
    }
    await globalThis.__exlibrisBoot;
  }
}

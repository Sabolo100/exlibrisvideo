/**
 * Applies pending SQL migrations from ./drizzle. Safe to run concurrently from the
 * web and worker containers: a Postgres advisory lock serialises the runs.
 *   npm run db:migrate
 */
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

const LOCK_KEY = 7_345_110_001;

export async function runMigrations(): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await migrate(db(), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

const isDirectRun = process.argv[1] && /migrate\.(ts|js|mjs)$/.test(process.argv[1]);
if (isDirectRun) {
  runMigrations()
    .then(async () => {
      console.log('[migrate] done');
      await pool().end();
    })
    .catch(async (err) => {
      console.error('[migrate] failed', err);
      await pool().end();
      process.exit(1);
    });
}

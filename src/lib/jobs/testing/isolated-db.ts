/**
 * Test-only helper: creates a throw-away Postgres schema with the full app schema (all ./drizzle
 * migrations applied into it) and installs a pool/Drizzle instance bound to it as the global `db()`.
 * Tests therefore never touch rows of the shared development database.
 *
 * Never import this from application code.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@/db/schema';

export interface IsolatedDb {
  schemaName: string;
  pool: pg.Pool;
  /** drops the schema and closes the pool */
  cleanup: () => Promise<void>;
}

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5432/exlibris';

function migrationStatements(schemaName: string): string[] {
  const dir = path.resolve(process.cwd(), 'drizzle');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.flatMap((f) =>
    fs
      .readFileSync(path.join(dir, f), 'utf8')
      .replaceAll('"public".', `"${schemaName}".`)
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Returns null when Postgres is not reachable (tests should skip). */
export async function createIsolatedDb(prefix = 'test_pipeline'): Promise<IsolatedDb | null> {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  const schemaName = `${prefix}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await admin.connect();
  } catch {
    return null;
  }
  try {
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    for (const stmt of migrationStatements(schemaName)) {
      await admin.query(stmt);
    }
  } catch (err) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
    throw err;
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: url, max: 10, options: `-c search_path=${schemaName}` });
  globalThis.__exlibrisPool = pool;
  globalThis.__exlibrisDb = drizzle(pool, { schema });

  return {
    schemaName,
    pool,
    cleanup: async () => {
      globalThis.__exlibrisDb = undefined;
      globalThis.__exlibrisPool = undefined;
      await pool.end().catch(() => {});
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await c.end();
      }
    },
  };
}

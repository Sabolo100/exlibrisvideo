import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __exlibrisPool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __exlibrisDb: DB | undefined;
}

/** Shared pg pool (survives Next.js dev hot reloads). */
export function pool(): pg.Pool {
  if (!globalThis.__exlibrisPool) {
    const p = new pg.Pool({
      connectionString: env().DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    });
    // An idle client losing its connection (Postgres restart, network blip) emits 'error' on the pool;
    // without a listener that event crashes the process. The pool drops the client and reconnects on demand.
    p.on('error', (err) => {
      console.warn('[db] idle PostgreSQL connection lost', { message: err.message });
    });
    globalThis.__exlibrisPool = p;
  }
  return globalThis.__exlibrisPool;
}

export function db(): DB {
  if (!globalThis.__exlibrisDb) {
    globalThis.__exlibrisDb = drizzle(pool(), { schema });
  }
  return globalThis.__exlibrisDb;
}

export { schema };

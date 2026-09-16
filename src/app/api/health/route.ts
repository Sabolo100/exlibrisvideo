import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { json, withErrorHandling } from '@/lib/http';
import pkg from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 3000;

async function pingDb(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db().execute(sql`SELECT 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('db ping timeout')), DB_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch (err) {
    console.warn('[api] health: database unavailable', { error: err instanceof Error ? err.message : String(err) });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET /api/health – `{ ok, db, version }` (503 when the database is unreachable). */
export const GET = withErrorHandling(async () => {
  const dbOk = await pingDb();
  const version = process.env.APP_VERSION || pkg.version;
  return json({ ok: dbOk, db: dbOk, version }, { status: dbOk ? 200 : 503 });
});

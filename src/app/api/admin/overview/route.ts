import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { enforceRateLimit } from '@/lib/collections/guards';
import { env } from '@/lib/env';
import { getClientIp, HttpError, json, withErrorHandling } from '@/lib/http';
import { timingSafeEqualStr } from '@/lib/security/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REALM_HEADER = { 'WWW-Authenticate': 'Basic realm="Ex Libris Video admin", charset="UTF-8"' };

function checkBasicAuth(req: Request, password: string): boolean {
  const header = req.headers.get('authorization');
  const m = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;
  if (!m) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  // Evaluate both comparisons to keep timing independent of which part is wrong.
  const userOk = timingSafeEqualStr(user, 'admin');
  const passOk = timingSafeEqualStr(pass, password);
  return userOk && passOk;
}

type CountRow = { key: string | null; n: number | string };

function toCounts(rows: CountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key ?? 'null'] = Number(r.n);
  return out;
}

const num = (column: string) =>
  sql.raw(`CASE WHEN jsonb_typeof(${column}) = 'number' THEN (${column})::text::numeric ELSE 0 END`);

/** GET /api/admin/overview – Basic auth `admin:<ADMIN_PASSWORD>`; 404 when no password is configured. */
export const GET = withErrorHandling(async (req: Request) => {
  const password = env().ADMIN_PASSWORD;
  if (!password) throw new HttpError(404, 'not_found');

  await enforceRateLimit(`admin:ip:${getClientIp(req)}`, 60, 10 * 60);
  if (!checkBasicAuth(req, password)) {
    throw new HttpError(401, 'unauthorized', undefined, REALM_HEADER);
  }

  const d = db();
  const [collectionsByStatus, videosByStatus, jobsByStatus, emails24h, totals, recent, failedJobs, usageTotals, usageByModel] =
    await Promise.all([
      d.execute(sql`SELECT status AS key, count(*)::int AS n FROM collections GROUP BY status`),
      d.execute(sql`SELECT status AS key, count(*)::int AS n FROM videos GROUP BY status`),
      d.execute(sql`SELECT status AS key, count(*)::int AS n FROM jobs GROUP BY status`),
      d.execute(sql`SELECT status AS key, count(*)::int AS n FROM email_log WHERE created_at > now() - interval '24 hours' GROUP BY status`),
      d.execute(sql`
        SELECT
          (SELECT count(*) FROM collections)::int AS collections,
          (SELECT count(*) FROM collections WHERE created_at > now() - interval '24 hours')::int AS collections_24h,
          (SELECT count(*) FROM videos)::int AS sources,
          (SELECT COALESCE(sum(size_bytes), 0) FROM videos)::bigint AS source_bytes,
          (SELECT count(*) FROM books)::int AS books,
          (SELECT count(*) FROM frames)::int AS frames,
          (SELECT COALESCE(sum(view_count), 0) FROM collections)::bigint AS views
      `),
      d.execute(sql`
        SELECT c.id, c.title, c.status, c.visibility, c.locale, c.view_count, c.created_at, c.updated_at,
               (c.email IS NOT NULL) AS has_email,
               (SELECT count(*) FROM books b WHERE b.collection_id = c.id)::int AS book_count,
               (SELECT count(*) FROM videos v WHERE v.collection_id = c.id)::int AS source_count,
               ${num("c.usage->'estCostUsd'")} AS est_cost_usd
        FROM collections c
        ORDER BY c.created_at DESC
        LIMIT 25
      `),
      d.execute(sql`
        SELECT id, type, payload, attempts, max_attempts, left(last_error, 2000) AS last_error, created_at, updated_at
        FROM jobs
        WHERE status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 25
      `),
      d.execute(sql`
        SELECT
          COALESCE(sum(${num("usage->'inputTokens'")}), 0) AS input_tokens,
          COALESCE(sum(${num("usage->'outputTokens'")}), 0) AS output_tokens,
          COALESCE(sum(${num("usage->'estCostUsd'")}), 0) AS est_cost_usd
        FROM collections
      `),
      d.execute(sql`
        SELECT m.key AS model,
               COALESCE(sum(${num("m.value->'inputTokens'")}), 0) AS input_tokens,
               COALESCE(sum(${num("m.value->'outputTokens'")}), 0) AS output_tokens,
               COALESCE(sum(${num("m.value->'calls'")}), 0) AS calls
        FROM collections c
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(c.usage->'byModel') = 'object' THEN c.usage->'byModel' ELSE '{}'::jsonb END
        ) AS m
        GROUP BY m.key
        ORDER BY m.key
      `),
    ]);

  const t = totals.rows[0] as Record<string, number | string>;
  const u = usageTotals.rows[0] as Record<string, number | string>;

  return json({
    generatedAt: new Date().toISOString(),
    counts: {
      collections: Number(t.collections),
      collectionsLast24h: Number(t.collections_24h),
      sources: Number(t.sources),
      sourceBytes: Number(t.source_bytes),
      books: Number(t.books),
      frames: Number(t.frames),
      views: Number(t.views),
      collectionsByStatus: toCounts(collectionsByStatus.rows as CountRow[]),
      sourcesByStatus: toCounts(videosByStatus.rows as CountRow[]),
      jobsByStatus: toCounts(jobsByStatus.rows as CountRow[]),
      emailsLast24hByStatus: toCounts(emails24h.rows as CountRow[]),
    },
    recentCollections: (recent.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      visibility: r.visibility,
      locale: r.locale,
      viewCount: Number(r.view_count),
      bookCount: Number(r.book_count),
      sourceCount: Number(r.source_count),
      hasEmail: r.has_email === true,
      estCostUsd: Number(r.est_cost_usd),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    })),
    failedJobs: (failedJobs.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      type: r.type,
      payload: r.payload,
      attempts: Number(r.attempts),
      maxAttempts: Number(r.max_attempts),
      lastError: r.last_error,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    })),
    aiUsage: {
      inputTokens: Number(u.input_tokens),
      outputTokens: Number(u.output_tokens),
      estCostUsd: Number(u.est_cost_usd),
      byModel: (usageByModel.rows as Record<string, unknown>[]).map((r) => ({
        model: String(r.model),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        calls: Number(r.calls),
      })),
    },
  });
});

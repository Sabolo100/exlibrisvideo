import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { collections } from '@/db/schema';
import { localeFromRequest } from '@/i18n/server';
import { enforceRateLimit } from '@/lib/collections/guards';
import { normalizeEmail, recoverSchema } from '@/lib/collections/validation';
import { getClientIp, HttpError, json, parseJson, withErrorHandling } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import { checkRateLimit } from '@/lib/rate-limit';
import { sha256Hex } from '@/lib/security/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/recover – `{ email }`. Always 202 for a well-formed address (no account enumeration).
 * Queues `send_email` kind `recover_links` (24-hour signed claim links) only when collections exist.
 * Rate: 3 / hour per IP (429) and 3 / hour per address (silently ignored).
 */
export const POST = withErrorHandling(async (req: Request) => {
  const { email } = await parseJson(req, recoverSchema);
  const normalized = normalizeEmail(email);
  if (!normalized) throw new HttpError(400, 'bad_email');

  await enforceRateLimit(`recover:ip:${getClientIp(req)}`, 3, 3600);

  const emailKey = sha256Hex(normalized);
  const perAddress = await checkRateLimit(`recover:email:${emailKey}`, 3, 3600);
  if (perAddress.allowed) {
    const [match] = await db()
      .select({ id: collections.id })
      .from(collections)
      .where(eq(sql`lower(${collections.email})`, normalized))
      .limit(1);
    if (match) {
      await enqueueJob(
        'send_email',
        { kind: 'recover_links', to: normalized, locale: localeFromRequest(req) },
        { dedupeKey: `recover:${emailKey}` },
      );
    }
  }
  return json({ ok: true }, { status: 202 });
});

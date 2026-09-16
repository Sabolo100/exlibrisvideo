import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { collections } from '@/db/schema';
import { enforceRateLimit, requireCollection, requireOwner } from '@/lib/collections/guards';
import { emailExportSchema, normalizeEmail } from '@/lib/collections/validation';
import { env } from '@/lib/env';
import { HttpError, json, parseJson, withErrorHandling } from '@/lib/http';
import { enqueueJob } from '@/lib/jobs/queue';
import type { ExportFormat, Locale } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_FORMATS: ExportFormat[] = ['xlsx', 'pdf'];

/** POST /api/collections/:id/email – owner e-mails exports (saves the address when given). */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  requireOwner(req, collection);
  const body = await parseJson(req, emailExportSchema);

  const given = normalizeEmail(body.email);
  if (given === false) throw new HttpError(400, 'bad_email');
  const to = given ?? collection.email;
  if (!to) throw new HttpError(400, 'bad_email');

  await enforceRateLimit(`email:col:${collection.id}`, env().RATE_EMAILS_PER_COLLECTION_DAY, 24 * 3600);

  if (given && given !== collection.email) {
    await db().update(collections).set({ email: given, updatedAt: new Date() }).where(eq(collections.id, collection.id));
  }
  const locale: Locale = collection.locale === 'en' ? 'en' : 'hu';
  await enqueueJob('send_email', {
    kind: 'export',
    collectionId: collection.id,
    to,
    formats: body.formats ?? DEFAULT_FORMATS,
    locale,
  });
  console.info('[api] export e-mail queued', { collectionId: collection.id, formats: body.formats ?? DEFAULT_FORMATS });
  return json({ queued: true }, { status: 202 });
});

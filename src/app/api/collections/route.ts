import { localeFromRequest } from '@/i18n/server';
import { ownerSetCookie } from '@/lib/collections/access';
import { enforceRateLimit } from '@/lib/collections/guards';
import { createCollection } from '@/lib/collections/service';
import { createCollectionSchema } from '@/lib/collections/validation';
import { env, publicCollectionUrl } from '@/lib/env';
import { getClientIp, json, parseJson, withErrorHandling } from '@/lib/http';
import type { CreateCollectionResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/collections – create a draft collection, set the owner cookie. */
export const POST = withErrorHandling(async (req: Request) => {
  await enforceRateLimit(`collections:ip:${getClientIp(req)}`, env().RATE_COLLECTIONS_PER_IP_DAY, 24 * 3600);
  const body = await parseJson(req, createCollectionSchema);
  const { collection, ownerToken } = await createCollection({
    title: body.title,
    ownerName: body.ownerName,
    email: body.email,
    locale: body.locale ?? localeFromRequest(req),
  });
  const publicUrl = publicCollectionUrl(collection.id);
  const response: CreateCollectionResponse = {
    id: collection.id,
    ownerToken,
    publicUrl,
    ownerUrl: `${publicUrl}?k=${encodeURIComponent(ownerToken)}`,
  };
  console.info('[api] collection created', { collectionId: collection.id, locale: collection.locale });
  return json(response, { status: 201, headers: { 'Set-Cookie': ownerSetCookie(req, collection) } });
});

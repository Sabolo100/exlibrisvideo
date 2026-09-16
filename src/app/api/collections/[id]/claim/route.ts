import { ownerSetCookie } from '@/lib/collections/access';
import { enforceRateLimit, requireCollection } from '@/lib/collections/guards';
import { claimSchema } from '@/lib/collections/validation';
import { getClientIp, HttpError, json, parseJson, withErrorHandling } from '@/lib/http';
import { verifyOwnerToken, verifyRecovery } from '@/lib/security/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/collections/:id/claim – `{ token }` or `{ recovery }` → owner cookie. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await enforceRateLimit(`claim:ip:${getClientIp(req)}`, 20, 10 * 60);
  const collection = await requireCollection(id);
  const body = await parseJson(req, claimSchema);

  if ('token' in body) {
    if (!verifyOwnerToken(body.token, collection.ownerTokenHash)) throw new HttpError(403, 'bad_owner_link');
  } else {
    const check = verifyRecovery(collection.id, collection.ownerTokenHash, body.recovery);
    if (check !== 'ok') throw new HttpError(403, 'expired_link', { expired: check === 'expired' });
  }

  console.info('[api] ownership claimed', { collectionId: collection.id, via: 'token' in body ? 'token' : 'recovery' });
  return json({ ok: true }, { headers: { 'Set-Cookie': ownerSetCookie(req, collection) } });
});

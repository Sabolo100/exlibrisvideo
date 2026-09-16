import { pinSetCookie } from '@/lib/collections/access';
import { enforceRateLimit, requireCollection } from '@/lib/collections/guards';
import { unlockSchema } from '@/lib/collections/validation';
import { getClientIp, HttpError, json, parseJson, withErrorHandling } from '@/lib/http';
import { verifyPin } from '@/lib/security/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/collections/:id/unlock – `{ pin }` → `exl_pin_<id>` cookie. Rate: 10 / 10 min per IP+id. */
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const collection = await requireCollection(id);
  await enforceRateLimit(`unlock:ip:${getClientIp(req)}:${collection.id}`, 10, 10 * 60);
  // Defence against distributed guessing of short PINs: generous caps per collection across all IPs
  // (a 4-digit PIN would need weeks of attempts). Viewers already holding a PIN cookie are unaffected.
  await enforceRateLimit(`unlock:col:${collection.id}`, 100, 10 * 60);
  await enforceRateLimit(`unlock:col-day:${collection.id}`, 500, 24 * 3600);
  const { pin } = await parseJson(req, unlockSchema);

  if (collection.visibility !== 'pin' || !collection.pinHash) {
    // Nothing to unlock (link visibility): viewers already have access.
    return json({ ok: true });
  }
  if (!(await verifyPin(pin.trim(), collection.pinHash))) {
    throw new HttpError(403, 'wrong_pin');
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': pinSetCookie(req, collection, collection.pinHash) } });
});

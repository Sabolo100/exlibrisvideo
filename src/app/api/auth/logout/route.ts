import { sessionClearCookie } from '@/lib/auth/session';
import { json, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout – signs out on this device (deletes the session cookie). */
export const POST = withErrorHandling(async (req: Request) => {
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionClearCookie(req) } });
});

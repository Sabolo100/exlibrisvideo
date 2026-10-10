import { oauthSetCookie, startGoogleSignIn } from '@/lib/auth/google';
import { googleAuthEnabled } from '@/lib/env';
import { withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/google?next=/path – starts "Sign in with Google" (redirect to Google's consent screen). */
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  if (!googleAuthEnabled()) {
    return new Response(null, { status: 303, headers: { Location: '/?auth=unavailable' } });
  }
  const { url: target, cookieValue } = startGoogleSignIn(url.searchParams.get('next'));
  const headers = new Headers({ Location: target, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', oauthSetCookie(req, cookieValue));
  return new Response(null, { status: 303, headers });
});

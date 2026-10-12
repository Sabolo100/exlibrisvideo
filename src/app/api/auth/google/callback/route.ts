import { localeFromRequest } from '@/i18n/server';
import { finishGoogleSignIn, OAUTH_COOKIE, oauthClearCookie, parseOAuthCookie } from '@/lib/auth/google';
import { sessionSetCookie } from '@/lib/auth/session';
import { adoptGuestCollection, ensureLibrary, upsertGoogleUser } from '@/lib/auth/users';
import { parseCookieHeader } from '@/lib/security/cookies';
import { timingSafeEqualStr } from '@/lib/security/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirect(req: Request, location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  headers.append('Set-Cookie', oauthClearCookie(req));
  return new Response(null, { status: 303, headers });
}

/**
 * GET /api/auth/google/callback?code&state – Google sends the user back here. Checks the state, exchanges
 * the code, creates / updates the user and their library, sets the session cookie and opens the library
 * (or the page the sign-in started from). A link-only catalogue the visitor filmed before signing in
 * (`claim`, proved by the owner cookie) becomes the new library instead of an empty one.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const jar = parseCookieHeader(req.headers.get('cookie'));
  const saved = parseOAuthCookie(jar.get(OAUTH_COOKIE));
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  // the user cancelled on Google's screen (or Google refused): back where they came from
  if (url.searchParams.get('error')) return redirect(req, saved?.next ?? '/');
  if (!saved || !state || !code || !timingSafeEqualStr(state, saved.state)) {
    console.warn('[auth] callback without a matching sign-in state');
    return redirect(req, '/?auth=failed');
  }

  try {
    const profile = await finishGoogleSignIn(code, saved.verifier);
    const user = await upsertGoogleUser(profile, localeFromRequest(req));
    const adopted = saved.claim ? await adoptGuestCollection(user, saved.claim, (name) => jar.get(name)) : null;
    const library = adopted ?? (await ensureLibrary(user));
    console.info('[auth] signed in', { userId: user.id, collectionId: library.id, adopted: adopted !== null });
    return redirect(req, saved.next ?? `/${library.id}`, [sessionSetCookie(req, user.id)]);
  } catch (err) {
    console.warn('[auth] sign-in failed', { error: err instanceof Error ? err.message : String(err) });
    return redirect(req, '/?auth=failed');
  }
}

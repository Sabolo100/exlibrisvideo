/**
 * "Sign in with Google": OAuth 2.0 authorization code flow with PKCE, OpenID Connect ID token.
 * Hand-written on fetch (no extra npm package). Server-only.
 *
 *  1. GET /api/auth/google            → state + PKCE verifier in the short-lived `exl_oauth` cookie,
 *                                        redirect to Google's consent screen
 *  2. GET /api/auth/google/callback   → state check, code + verifier exchanged for tokens at Google's
 *                                        token endpoint, the ID token's claims checked → the user
 *
 * The ID token comes straight from Google's token endpoint over TLS, so its signature need not be checked
 * (OpenID Connect Core §3.1.3.7); issuer, audience, expiry and the verified e-mail still are.
 */
import crypto from 'node:crypto';
import { env } from '@/lib/env';
import { serializeCookie } from '@/lib/security/cookies';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const OAUTH_COOKIE = 'exl_oauth';
/** the user has this long to finish the consent screen */
export const OAUTH_COOKIE_MAX_AGE = 15 * 60;

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  locale: string | null;
}

export function googleRedirectUri(): string {
  return `${env().APP_URL.replace(/\/$/, '')}/api/auth/google/callback`;
}

/** Only same-site paths may be the target after the sign-in ("/123456789", "/my"); anything else → null. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 512) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(next)) return null;
  if (next.startsWith('/api/')) return null;
  return next;
}

export interface OAuthStart {
  url: string;
  /** `exl_oauth` cookie value: "<state>.<verifier>.<b64url(next)>" */
  cookieValue: string;
}

export function startGoogleSignIn(next: string | null): OAuthStart {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
  const state = crypto.randomBytes(18).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    client_id: e.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const nextPart = Buffer.from(safeNextPath(next) ?? '', 'utf8').toString('base64url');
  return { url: `${GOOGLE_AUTH_URL}?${params}`, cookieValue: `${state}.${verifier}.${nextPart}` };
}

export function oauthSetCookie(req: Request, value: string): string {
  return serializeCookie(req, OAUTH_COOKIE, value, { maxAge: OAUTH_COOKIE_MAX_AGE });
}

export function oauthClearCookie(req: Request): string {
  return serializeCookie(req, OAUTH_COOKIE, '', { maxAge: 0 });
}

/** Parses the `exl_oauth` cookie; null when malformed. */
export function parseOAuthCookie(value: string | undefined): { state: string; verifier: string; next: string | null } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return null;
  let next: string | null = null;
  try {
    next = safeNextPath(Buffer.from(parts[2], 'base64url').toString('utf8'));
  } catch {
    next = null;
  }
  return { state: parts[0], verifier: parts[1], next };
}

export class GoogleAuthError extends Error {}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new GoogleAuthError('malformed id_token');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  const payload = JSON.parse(json) as unknown;
  if (!payload || typeof payload !== 'object') throw new GoogleAuthError('malformed id_token payload');
  return payload as Record<string, unknown>;
}

/** Checks the claims of an ID token received from Google's token endpoint and returns the profile. */
export function profileFromIdToken(idToken: string, clientId: string, nowSec = Math.floor(Date.now() / 1000)): GoogleProfile {
  const p = decodeJwtPayload(idToken);
  if (typeof p.iss !== 'string' || !GOOGLE_ISSUERS.has(p.iss)) throw new GoogleAuthError('wrong issuer');
  const audOk = p.aud === clientId || (Array.isArray(p.aud) && p.aud.includes(clientId));
  if (!audOk) throw new GoogleAuthError('wrong audience');
  if (typeof p.exp !== 'number' || p.exp < nowSec - 60) throw new GoogleAuthError('expired id_token');
  if (typeof p.sub !== 'string' || !p.sub) throw new GoogleAuthError('no subject');
  if (typeof p.email !== 'string' || !p.email.includes('@')) throw new GoogleAuthError('no e-mail');
  if (p.email_verified !== true && p.email_verified !== 'true') throw new GoogleAuthError('e-mail not verified');
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const picture = str(p.picture, 1000);
  return {
    sub: p.sub,
    email: p.email.trim().toLowerCase(),
    name: str(p.name, 200),
    picture: picture && /^https:\/\//i.test(picture) ? picture : null,
    locale: str(p.locale, 16),
  };
}

/** Exchanges the authorization code (+ PKCE verifier) for tokens and returns the verified profile. */
export async function finishGoogleSignIn(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<GoogleProfile> {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new GoogleAuthError('Google sign-in is not configured');
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: e.GOOGLE_CLIENT_ID,
      client_secret: e.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || !data || typeof data.id_token !== 'string') {
    throw new GoogleAuthError(`token exchange failed (${res.status}${data && typeof data.error === 'string' ? `: ${data.error}` : ''})`);
  }
  return profileFromIdToken(data.id_token, e.GOOGLE_CLIENT_ID);
}

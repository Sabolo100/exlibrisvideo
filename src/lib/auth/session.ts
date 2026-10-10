/**
 * Sign-in session of a Google account user. Server-only.
 *
 *  session cookie `exl_session` = "<userId>.<expUnixSeconds>.<b64url(HMAC-SHA256(APP_SECRET, "ses:" + userId + ":" + exp))>"
 *
 * Stateless (verified by recomputation, like the owner cookie). Signing out deletes the cookie.
 */
import { serializeCookie } from '@/lib/security/cookies';
import { hmacB64url, isUuid, timingSafeEqualStr } from '@/lib/security/tokens';

export const SESSION_COOKIE = 'exl_session';
/** 400 days – the maximum browsers honour; renewed at every sign-in */
export const SESSION_MAX_AGE = 400 * 24 * 3600;

function sign(userId: string, exp: number): string {
  return hmacB64url(`ses:${userId}:${exp}`);
}

export function sessionCookieValue(userId: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = nowSec + SESSION_MAX_AGE;
  return `${userId}.${exp}.${sign(userId, exp)}`;
}

/** The user id of a valid, unexpired session cookie value, else null. */
export function verifySessionValue(value: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!isUuid(userId) || !/^\d{1,12}$/.test(expStr)) return null;
  const exp = Number(expStr);
  if (exp < nowSec) return null;
  return timingSafeEqualStr(sig, sign(userId, exp)) ? userId : null;
}

export function sessionSetCookie(req: Request, userId: string): string {
  return serializeCookie(req, SESSION_COOKIE, sessionCookieValue(userId), { maxAge: SESSION_MAX_AGE });
}

export function sessionClearCookie(req: Request): string {
  return serializeCookie(req, SESSION_COOKIE, '', { maxAge: 0 });
}

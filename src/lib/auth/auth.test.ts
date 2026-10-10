import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-1';
});
import { resolveViewer } from '@/lib/collections/access';
import { parseOAuthCookie, profileFromIdToken, safeNextPath, startGoogleSignIn } from './google';
import { SESSION_COOKIE, sessionCookieValue, verifySessionValue } from './session';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(payload)}.sig`;
}

describe('session cookie', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const now = 1_800_000_000;
    const value = sessionCookieValue(USER, now);
    expect(verifySessionValue(value, now + 10)).toBe(USER);
    expect(verifySessionValue(value.replace(USER, OTHER), now)).toBeNull();
    expect(verifySessionValue(`${value}x`, now)).toBeNull();
    expect(verifySessionValue(value, now + 401 * 24 * 3600)).toBeNull();
    expect(verifySessionValue('garbage', now)).toBeNull();
    expect(verifySessionValue(undefined, now)).toBeNull();
  });

  it("makes the signed-in user the owner of their library only", () => {
    const library = { id: '123456789', ownerTokenHash: 'x', visibility: 'pin' as const, pinHash: 'h', userId: USER };
    const cookie = sessionCookieValue(USER);
    const jar = (name: string) => (name === SESSION_COOKIE ? cookie : undefined);
    expect(resolveViewer(library, jar, null)).toEqual({ isOwner: true, canView: true });
    expect(resolveViewer({ ...library, userId: OTHER }, jar, null)).toEqual({ isOwner: false, canView: false });
    expect(resolveViewer({ ...library, userId: null }, jar, null)).toEqual({ isOwner: false, canView: false });
  });
});

describe('Google sign-in', () => {
  it('accepts only same-site paths as the target', () => {
    expect(safeNextPath('/123456789')).toBe('/123456789');
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath(`/${String.fromCharCode(92)}evil.example`)).toBeNull();
    expect(safeNextPath('/api/auth/logout')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });

  it('starts with PKCE and remembers state, verifier and target', () => {
    const { url, cookieValue } = startGoogleSignIn('/my');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('client-1');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    const saved = parseOAuthCookie(cookieValue)!;
    expect(saved.state).toBe(u.searchParams.get('state'));
    expect(saved.next).toBe('/my');
    expect(saved.verifier.length).toBeGreaterThan(40);
  });

  it('checks the ID token claims', () => {
    const now = 1_800_000_000;
    const ok = { iss: 'https://accounts.google.com', aud: 'client-1', exp: now + 600, sub: '1099', email: 'Anna@Example.com', email_verified: true, name: 'Anna', picture: 'https://lh3.googleusercontent.com/a/x' };
    expect(profileFromIdToken(jwt(ok), 'client-1', now)).toEqual({
      sub: '1099',
      email: 'anna@example.com',
      name: 'Anna',
      picture: 'https://lh3.googleusercontent.com/a/x',
      locale: null,
    });
    expect(() => profileFromIdToken(jwt({ ...ok, aud: 'someone-else' }), 'client-1', now)).toThrow();
    expect(() => profileFromIdToken(jwt({ ...ok, iss: 'https://evil.example' }), 'client-1', now)).toThrow();
    expect(() => profileFromIdToken(jwt({ ...ok, exp: now - 3600 }), 'client-1', now)).toThrow();
    expect(() => profileFromIdToken(jwt({ ...ok, email_verified: false }), 'client-1', now)).toThrow();
  });
});

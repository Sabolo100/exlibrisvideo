/**
 * The Google callback with a claimed guest catalogue (PostgreSQL; Google's token exchange is replaced):
 * a first sign-in after filming as a guest ends in the guest catalogue being the account's library.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const google = vi.hoisted(() => ({ profile: { sub: '', email: '', name: null as string | null, picture: null, locale: null } }));

vi.mock('@/lib/auth/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/google')>();
  return { ...actual, finishGoogleSignIn: vi.fn(async () => google.profile) };
});

import { db, pool } from '@/db';
import { collections, users } from '@/db/schema';
import { OAUTH_COOKIE, startGoogleSignIn } from '@/lib/auth/google';
import { SESSION_COOKIE, verifySessionValue } from '@/lib/auth/session';
import { ownerCookieName } from '@/lib/collections/access';
import { createCollection } from '@/lib/collections/service';
import { ownerCookieValue } from '@/lib/security/tokens';
import { GET } from './route';

process.env.GOOGLE_CLIENT_ID ||= 'client-1';

const dbAvailable = await pool()
  .query('SELECT 1 FROM users LIMIT 1')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dbAvailable)('GET /api/auth/google/callback – claimed guest catalogue', () => {
  const collectionIds: string[] = [];
  const userEmails: string[] = [];

  afterAll(async () => {
    if (userEmails.length) {
      const rows = await db().select({ id: users.id }).from(users).where(inArray(users.email, userEmails));
      const ids = rows.map((r) => r.id);
      if (ids.length) await db().delete(collections).where(inArray(collections.userId, ids));
      if (ids.length) await db().delete(users).where(inArray(users.id, ids));
    }
    if (collectionIds.length) await db().delete(collections).where(inArray(collections.id, collectionIds));
    await pool().end();
  });

  beforeEach(() => {
    const sub = `cb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    google.profile = { sub, email: `${sub}@example.com`, name: 'Vendég Vera', picture: null, locale: null };
    userEmails.push(google.profile.email);
  });

  /** the request Google's redirect becomes: the sign-in cookie, plus the owner cookie when the browser has it */
  async function callback(opts: { claim: string | null; next: string | null; ownerCookie?: string }) {
    const { url, cookieValue } = startGoogleSignIn(opts.next, opts.claim);
    const state = new URL(url).searchParams.get('state')!;
    const cookies = [`${OAUTH_COOKIE}=${cookieValue}`, opts.ownerCookie].filter(Boolean).join('; ');
    const res = await GET(new Request(`http://localhost:3000/api/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: cookies } }));
    const session = /exl_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    return { res, userId: session ? verifySessionValue(decodeURIComponent(session)) : null };
  }

  async function guest(title: string) {
    const { collection } = await createCollection({ title });
    collectionIds.push(collection.id);
    return { id: collection.id, cookie: `${ownerCookieName(collection.id)}=${ownerCookieValue(collection.id, collection.ownerTokenHash)}` };
  }

  it('makes the guest catalogue the library of a new account and opens it', async () => {
    const g = await guest('Nappali');
    const { res, userId } = await callback({ claim: g.id, next: `/${g.id}`, ownerCookie: g.cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/${g.id}`);
    expect(userId).not.toBeNull();
    const [row] = await db().select().from(collections).where(eq(collections.id, g.id));
    expect(row).toMatchObject({ userId, title: 'Nappali', ownerName: 'Vendég Vera' });
    // the account has exactly this library – no empty second one was made
    expect(await db().select({ id: collections.id }).from(collections).where(eq(collections.userId, userId!))).toHaveLength(1);
  });

  it('opens the new library when the sign-in started from the home page (no next)', async () => {
    const g = await guest('Előszoba');
    const { res } = await callback({ claim: g.id, next: null, ownerCookie: g.cookie });
    expect(res.headers.get('location')).toBe(`/${g.id}`);
  });

  it('ignores a claim the browser cannot prove: the account gets its own empty library', async () => {
    const g = await guest('Idegen');
    const { res, userId } = await callback({ claim: g.id, next: null });
    const location = res.headers.get('location')!;
    expect(location).not.toBe(`/${g.id}`);
    const [row] = await db().select().from(collections).where(eq(collections.id, g.id));
    expect(row.userId).toBeNull();
    const [library] = await db().select().from(collections).where(eq(collections.userId, userId!));
    expect(location).toBe(`/${library.id}`);
  });

  it('signs in as before without a claim', async () => {
    const { res, userId } = await callback({ claim: null, next: null });
    const [library] = await db().select().from(collections).where(eq(collections.userId, userId!));
    expect(res.headers.get('location')).toBe(`/${library.id}`);
    expect(userId).toBeTruthy();
    expect(SESSION_COOKIE).toBe('exl_session');
  });
});

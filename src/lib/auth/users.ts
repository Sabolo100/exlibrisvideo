/**
 * Signed-in users and their library (one collection per user). Server-only.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { collections, users, type CollectionRow, type UserRow } from '@/db/schema';
import { createCollection } from '@/lib/collections/service';
import { parseCookieHeader } from '@/lib/security/cookies';
import type { Locale, SessionUserDTO } from '@/lib/types';
import type { GoogleProfile } from './google';
import { SESSION_COOKIE, verifySessionValue } from './session';

/** Creates the user at the first sign-in, refreshes name / photo / e-mail later. */
export async function upsertGoogleUser(profile: GoogleProfile, locale: Locale): Promise<UserRow> {
  const now = new Date();
  const [row] = await db()
    .insert(users)
    .values({ googleSub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture, locale, lastLoginAt: now })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email: profile.email, name: profile.name, picture: profile.picture, lastLoginAt: now },
    })
    .returning();
  return row;
}

export async function findUser(userId: string): Promise<UserRow | null> {
  const [row] = await db().select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

export async function findLibrary(userId: string): Promise<CollectionRow | null> {
  const [row] = await db().select().from(collections).where(eq(collections.userId, userId)).limit(1);
  return row ?? null;
}

/**
 * The user's library, created on first use (an empty draft collection owned by the user). Concurrent
 * sign-ins of the same user are serialised, so only one library is ever made.
 */
export async function ensureLibrary(user: Pick<UserRow, 'id' | 'name' | 'locale'>): Promise<CollectionRow> {
  const existing = await findLibrary(user.id);
  if (existing) return existing;
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exl-library:${user.id}`}, 0))`);
    const [again] = await tx.select().from(collections).where(eq(collections.userId, user.id)).limit(1);
    if (again) return again;
    const { collection } = await createCollection({
      ownerName: user.name ?? undefined,
      locale: user.locale === 'en' ? 'en' : 'hu',
    });
    const [owned] = await tx.update(collections).set({ userId: user.id }).where(eq(collections.id, collection.id)).returning();
    console.info('[auth] library created', { userId: user.id, collectionId: owned.id });
    return owned;
  });
}

export function toSessionUserDTO(user: UserRow, libraryId: string | null): SessionUserDTO {
  return { id: user.id, email: user.email, name: user.name, picture: user.picture, libraryId };
}

async function loadSessionUser(userId: string | null): Promise<SessionUserDTO | null> {
  if (!userId) return null;
  const user = await findUser(userId);
  if (!user) return null;
  const library = await findLibrary(user.id);
  return toSessionUserDTO(user, library?.id ?? null);
}

/** The signed-in user of a route handler request (session cookie), or null. */
export async function getSessionUserFromRequest(req: Request): Promise<SessionUserDTO | null> {
  const value = parseCookieHeader(req.headers.get('cookie')).get(SESSION_COOKIE);
  return loadSessionUser(verifySessionValue(value));
}

/** The signed-in user of a Server Component render, or null (never throws: the page still renders). */
export async function getSessionUser(): Promise<SessionUserDTO | null> {
  try {
    const { cookies } = await import('next/headers');
    const value = (await cookies()).get(SESSION_COOKIE)?.value;
    return await loadSessionUser(verifySessionValue(value));
  } catch (err) {
    console.warn('[auth] session lookup failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

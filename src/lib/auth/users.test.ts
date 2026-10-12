import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db';
import { collections, users } from '@/db/schema';
import { ownerCookieName } from '@/lib/collections/access';
import { createCollection } from '@/lib/collections/service';
import { ownerCookieValue } from '@/lib/security/tokens';
import { adoptGuestCollection, ensureLibrary, findLibrary, upsertGoogleUser } from './users';

const dbAvailable = await pool()
  .query('SELECT 1 FROM users LIMIT 1')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dbAvailable)('users and their library (PostgreSQL)', () => {
  const userIds: string[] = [];
  const guestIds: string[] = [];
  afterAll(async () => {
    if (guestIds.length) await db().delete(collections).where(inArray(collections.id, guestIds));
    if (userIds.length) {
      await db().delete(collections).where(inArray(collections.userId, userIds));
      await db().delete(users).where(inArray(users.id, userIds));
    }
    await pool().end();
  });

  it('creates the user once and exactly one library, even for parallel sign-ins', async () => {
    const sub = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const profile = { sub, email: 'anna@example.com', name: 'Anna', picture: null, locale: null };
    const user = await upsertGoogleUser(profile, 'hu');
    userIds.push(user.id);
    const again = await upsertGoogleUser({ ...profile, name: 'Anna B.' }, 'en');
    expect(again.id).toBe(user.id);
    expect(again.name).toBe('Anna B.');

    const libraries = await Promise.all([ensureLibrary(again), ensureLibrary(again), ensureLibrary(again)]);
    expect(new Set(libraries.map((l) => l.id)).size).toBe(1);
    expect(libraries[0]).toMatchObject({ userId: user.id, ownerName: 'Anna B.', status: 'draft' });
    expect((await findLibrary(user.id))?.id).toBe(libraries[0].id);
  });

  async function newUser(name: string) {
    const sub = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await upsertGoogleUser({ sub, email: `${sub}@example.com`, name, picture: null, locale: null }, 'hu');
    userIds.push(user.id);
    return user;
  }

  async function newGuest(title: string) {
    const { collection } = await createCollection({ title });
    guestIds.push(collection.id);
    const jar = (name: string) => (name === ownerCookieName(collection.id) ? ownerCookieValue(collection.id, collection.ownerTokenHash) : undefined);
    return { collection, jar };
  }

  it('turns the guest catalogue its visitor owns into the library of a new account – same id, nothing copied', async () => {
    const user = await newUser('Béla');
    const { collection, jar } = await newGuest('Nappali');
    const adopted = await adoptGuestCollection(user, collection.id, jar);
    expect(adopted).toMatchObject({ id: collection.id, userId: user.id, title: 'Nappali', ownerName: 'Béla' });
    expect((await findLibrary(user.id))?.id).toBe(collection.id);
    // signing in again keeps it – no second, empty library appears
    expect((await ensureLibrary(user)).id).toBe(collection.id);
  });

  it('does not adopt without the owner cookie, a catalogue of someone else, or into an existing library', async () => {
    const user = await newUser('Cili');
    const { collection, jar } = await newGuest('Más polca');
    // the claimed id alone proves nothing: no cookie, or the cookie of another catalogue
    expect(await adoptGuestCollection(user, collection.id, () => undefined)).toBeNull();
    expect(await adoptGuestCollection(user, collection.id, (name) => (name === ownerCookieName(collection.id) ? 'forged' : undefined))).toBeNull();
    expect((await db().select().from(collections).where(inArray(collections.id, [collection.id])))[0].userId).toBeNull();

    // an account that already has a library keeps it, and the guest catalogue stays a link catalogue
    const library = await ensureLibrary(user);
    expect(await adoptGuestCollection(user, collection.id, jar)).toBeNull();
    expect((await findLibrary(user.id))?.id).toBe(library.id);
    expect((await db().select().from(collections).where(inArray(collections.id, [collection.id])))[0].userId).toBeNull();

    // a catalogue that already belongs to an account is nobody's to take
    const other = await newUser('Dani');
    const owned = await newGuest('Danié');
    await adoptGuestCollection(other, owned.collection.id, owned.jar);
    const third = await newUser('Emma');
    expect(await adoptGuestCollection(third, owned.collection.id, owned.jar)).toBeNull();
  });
});

import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db';
import { collections, users } from '@/db/schema';
import { ensureLibrary, findLibrary, upsertGoogleUser } from './users';

const dbAvailable = await pool()
  .query('SELECT 1 FROM users LIMIT 1')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dbAvailable)('users and their library (PostgreSQL)', () => {
  const userIds: string[] = [];
  afterAll(async () => {
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
});

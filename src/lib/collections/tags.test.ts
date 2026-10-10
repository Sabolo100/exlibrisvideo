import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db';
import { books, collections, detections, videos } from '@/db/schema';
import { createCollection } from './service';
import { applyTagChange, setSourceTags, tagDiff } from './tags';

describe('tag helpers', () => {
  it('adds without duplicates (case-insensitive) and removes', () => {
    expect(applyTagChange(['Anna', 'krimi'], ['anna', 'Nappali'])).toEqual(['Anna', 'krimi', 'Nappali']);
    expect(applyTagChange(['Anna', 'krimi'], [], ['ANNA'])).toEqual(['krimi']);
  });
  it('diffs two tag lists', () => {
    expect(tagDiff(['Anna', 'krimi'], ['anna', 'Nagyi'])).toEqual({ added: ['Nagyi'], removed: ['krimi'] });
  });
});

const dbAvailable = await pool()
  .query('SELECT tags FROM videos LIMIT 1')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dbAvailable)('recording tags reach their books (PostgreSQL)', () => {
  const created: string[] = [];
  afterAll(async () => {
    if (created.length) await db().delete(collections).where(inArray(collections.id, created));
    await pool().end();
  });

  async function source(collectionId: string, tags: string[], sortOrder: number) {
    const [v] = await db()
      .insert(videos)
      .values({ collectionId, originalFilename: `polc${sortOrder}.mp4`, mimeType: 'video/mp4', sizeBytes: 1, sortOrder, tags, status: 'done' })
      .returning();
    return v;
  }
  async function seen(collectionId: string, videoId: string, bookId: string) {
    await db().insert(detections).values({ collectionId, videoId, bookId, rawTitle: 'x', confidence: 1, provider: 'mock', model: 'mock' });
  }

  it('adds and removes tags, keeping the ones another recording of the book still has', async () => {
    const { collection } = await createCollection({ locale: 'hu' });
    created.push(collection.id);
    const kids = await source(collection.id, ['Anna'], 0);
    const hall = await source(collection.id, ['Anna'], 1);
    const [onlyKids, both, manual] = await db()
      .insert(books)
      .values([
        { collectionId: collection.id, title: 'Csak a gyerekszobában', tags: ['Anna'] },
        { collectionId: collection.id, title: 'Mindkét polcon', tags: ['Anna', 'kedvenc'] },
        { collectionId: collection.id, title: 'Kézzel felvett', tags: ['Anna'] },
      ])
      .returning();
    await seen(collection.id, kids.id, onlyKids.id);
    await seen(collection.id, kids.id, both.id);
    await seen(collection.id, hall.id, both.id);

    const updated = await setSourceTags(kids.id, ['Gyerekszoba']);
    expect(updated.tags).toEqual(['Gyerekszoba']);
    const rows = await db().select({ id: books.id, tags: books.tags }).from(books).where(eq(books.collectionId, collection.id));
    const tagsOf = (id: string) => rows.find((r) => r.id === id)?.tags;
    expect(tagsOf(onlyKids.id)).toEqual(['Gyerekszoba']);
    // the hall recording is still tagged "Anna"
    expect(tagsOf(both.id)).toEqual(['Anna', 'kedvenc', 'Gyerekszoba']);
    // not found in that recording: untouched
    expect(tagsOf(manual.id)).toEqual(['Anna']);
  });
});

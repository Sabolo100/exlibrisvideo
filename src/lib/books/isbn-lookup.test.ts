import { describe, expect, it } from 'vitest';
import { coerceBookPhoto, toBookPhotoReading } from '@/lib/ai/book-photo';
import { lookupIsbn, parseGoogleVolume, parseOpenLibrarySearch } from './isbn-lookup';

const ISBN = '9789631411546';
const google = {
  items: [
    {
      volumeInfo: {
        title: 'Az ajtó',
        authors: ['Szabó Magda'],
        publisher: 'Magvető',
        publishedDate: '2003-05',
        pageCount: 303,
        language: 'hu',
        imageLinks: { thumbnail: 'http://books.google.com/books/content?id=x&zoom=1' },
      },
    },
  ],
};
const openLibrary = { docs: [{ title: 'Az ajtó', author_name: ['Magda Szabó'], publisher: ['Magvető'], number_of_pages_median: 303, cover_i: 13181538, language: ['hun'] }] };

describe('ISBN lookup', () => {
  it('reads Google Books and Open Library records', () => {
    expect(parseGoogleVolume(google, ISBN)).toMatchObject({ title: 'Az ajtó', author: 'Szabó Magda', editionYear: 2003, language: 'hu', coverUrl: 'https://books.google.com/books/content?id=x&zoom=1' });
    expect(parseOpenLibrarySearch(openLibrary, ISBN)).toMatchObject({ author: 'Magda Szabó', language: 'hu', coverUrl: 'https://covers.openlibrary.org/b/id/13181538-L.jpg' });
    expect(parseGoogleVolume({ totalItems: 0 }, ISBN)).toBeNull();
    expect(parseOpenLibrarySearch({ docs: [] }, ISBN)).toBeNull();
  });

  it('prefers Google, fills gaps from Open Library, survives a failing source', async () => {
    const both = await lookupIsbn(ISBN, async (url) => (url.includes('googleapis') ? google : openLibrary));
    expect(both).toMatchObject({ source: 'google', author: 'Szabó Magda', coverUrl: 'https://covers.openlibrary.org/b/id/13181538-L.jpg' });
    const olOnly = await lookupIsbn(ISBN, async (url) => {
      if (url.includes('googleapis')) throw new Error('HTTP 429');
      return openLibrary;
    });
    expect(olOnly).toMatchObject({ source: 'openlibrary', title: 'Az ajtó' });
    expect(await lookupIsbn(ISBN, async () => ({}))).toBeNull();
  });
});

describe('book photo reply', () => {
  it('coerces loose JSON and cleans the ISBN', () => {
    const wire = coerceBookPhoto({ book: { title: ' Abigél ', authors: 'Szabó Magda', isbn: 'ISBN 978-963-11-9002-1', confidence: '0.9', language: 'HU' } });
    expect(wire).toMatchObject({ status: 'book', title: 'Abigél', author: 'Szabó Magda' });
    expect(toBookPhotoReading(wire!)).toMatchObject({ isbn: '9789631190021', language: 'hu', confidence: 0.9 });
    expect(coerceBookPhoto({ status: 'not book', title: '' })?.status).toBe('not_book');
    expect(coerceBookPhoto('nope')).toBeNull();
  });
});

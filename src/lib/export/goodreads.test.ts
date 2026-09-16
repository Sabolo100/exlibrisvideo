import { describe, expect, it } from 'vitest';
import { buildExport } from './index';
import { GOODREADS_COLUMNS, cleanIsbn, goodreadsAuthor, goodreadsRow, goodreadsShelf } from './goodreads';
import { makeSampleBook, makeSampleCollection, SAMPLE_SEEDS } from './testing/sample-collection';

describe('goodreadsShelf', () => {
  it('maps reading status to the exclusive Goodreads shelves', () => {
    expect(goodreadsShelf('read')).toBe('read');
    expect(goodreadsShelf('reading')).toBe('currently-reading');
    expect(goodreadsShelf('to_read')).toBe('to-read');
    expect(goodreadsShelf('unknown')).toBe('to-read');
    expect(goodreadsShelf('abandoned')).toBe('to-read');
  });
});

describe('goodreadsAuthor', () => {
  it('flips Hungarian family-name-first names to Western order', () => {
    expect(goodreadsAuthor({ author: 'Szabó Magda', authorSort: 'szabo magda', language: 'hu', authorCountry: 'HU' })).toBe('Magda Szabó');
    expect(goodreadsAuthor({ author: 'Esterházy Péter', authorSort: 'esterhazy peter', language: 'hu', authorCountry: null })).toBe(
      'Péter Esterházy',
    );
  });
  it('keeps Western-order names and single names', () => {
    expect(goodreadsAuthor({ author: 'George Orwell', authorSort: 'orwell george', language: 'hu', authorCountry: 'GB' })).toBe('George Orwell');
    expect(goodreadsAuthor({ author: 'J. R. R. Tolkien', authorSort: 'tolkien j r r', language: 'hu', authorCountry: 'GB' })).toBe(
      'J. R. R. Tolkien',
    );
    expect(goodreadsAuthor({ author: 'Homérosz', authorSort: 'homerosz', language: 'hu', authorCountry: 'GR' })).toBe('Homérosz');
  });
  it('uses the first of several authors', () => {
    expect(goodreadsAuthor({ author: 'Neil Gaiman; Terry Pratchett', authorSort: 'gaiman neil', language: 'en', authorCountry: 'GB' })).toBe(
      'Neil Gaiman',
    );
  });
  it('falls back to the author country when there is no sort key', () => {
    expect(goodreadsAuthor({ author: 'Fekete István', authorSort: null, language: 'hu', authorCountry: 'HU' })).toBe('István Fekete');
    expect(goodreadsAuthor({ author: null, authorSort: null, language: null, authorCountry: null })).toBe('');
  });
});

describe('cleanIsbn', () => {
  it('keeps valid-looking ISBN-10/13 digits only', () => {
    expect(cleanIsbn('978-963-07-9054-5')).toBe('9789630790545');
    expect(cleanIsbn('963 11 1234 x')).toBe('963111234X');
    expect(cleanIsbn('12345')).toBe('');
    expect(cleanIsbn(null)).toBe('');
  });
});

describe('Goodreads export', () => {
  it('writes the exact Goodreads columns, comma separated, without BOM', async () => {
    const c = makeSampleCollection();
    const file = await buildExport(c, 'goodreads', 'hu', { isOwner: true });
    expect(file.filename).toBe('exlibris-334345435-goodreads.csv');
    const text = file.body.toString('utf8');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'Title,Author,ISBN,My Rating,Average Rating,Publisher,Binding,Year Published,Original Publication Year,Date Read,Date Added,Shelves,Bookshelves,My Review',
    );
    expect(GOODREADS_COLUMNS).toHaveLength(14);
    expect(lines).toHaveLength(c.books.length + 1);
    expect(text).toContain('"Piszkos Fred, a kapitány: Válogatott írások",Jenő Rejtő,');
    expect(text).toContain('Sátántangó,László Krasznahorkai,,4,,Magvető,,1985,1985,,2026/09/12,read,read,');
    // shelves with a comma are quoted; the same list goes into both shelf columns
    expect(text).toContain('Az ajtó,Magda Szabó,9789631000000,5,,Európa,,1987,1987,,2026/09/12,"read, favorites","read, favorites",');
    expect(text).toContain('Magda Szabó');
  });

  it('maps a book row', () => {
    const book = makeSampleBook(0, SAMPLE_SEEDS[0]);
    book.readingStatus = 'reading';
    book.rating = 4;
    book.favorite = true;
    book.isbn = '978-963-07-9054-5';
    book.notes = 'Kedvenc, dedikált';
    const row = goodreadsRow(book, { isOwner: true });
    expect(row).toEqual([
      'Az ajtó',
      'Magda Szabó',
      '9789630790545',
      4,
      '',
      'Európa',
      '',
      1987,
      1987,
      '',
      '2026/09/12',
      'currently-reading, favorites',
      'currently-reading, favorites',
      'Kedvenc, dedikált',
    ]);
    const anon = goodreadsRow({ ...book, rating: null, readingStatus: 'abandoned', favorite: false }, { isOwner: false });
    expect(anon[3]).toBe(0);
    expect(anon[11]).toBe('to-read, did-not-finish');
    expect(anon[12]).toBe('to-read, did-not-finish');
    expect(anon[13]).toBe('');
    expect(goodreadsRow({ ...book, readingStatus: 'read', favorite: false }, { isOwner: true })[11]).toBe('read');
  });
});

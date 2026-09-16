import { describe, expect, it } from 'vitest';
import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import type { BookDTO } from '@/lib/types';
import {
  buildAuthorEntries,
  groupAuthorsByInitial,
  guessSortName,
  HU_INDEX_LETTERS,
  letterSectionId,
  railLetters,
  sortAuthorEntries,
} from './authors';

const b = (p: Partial<BookDTO> & { title: string }) => makeSampleBook(p);

describe('buildAuthorEntries', () => {
  const books = [
    b({ title: 'Az ajtó', author: 'Szabó Magda', authorSort: 'szabo magda', authorCountry: 'HU', language: 'hu', firstPublishedYear: 1987 }),
    b({ title: 'Abigél', author: 'Szabó Magda', authorSort: 'szabo magda', authorCountry: 'hu', language: 'hu', firstPublishedYear: 1970 }),
    b({ title: 'Csillagok', author: 'Csáth Géza', authorSort: 'csath geza', authorCountry: 'HU', language: 'hu' }),
    b({ title: 'Nyomorultak', author: 'Victor Hugo', authorSort: 'hugo victor', authorCountry: 'FR', language: 'hu' }),
    b({ title: 'Talisman', author: 'Stephen King; Peter Straub', authorSort: 'king stephen', authorCountry: 'US', language: 'en' }),
    b({ title: 'Ghost Story', author: 'Peter Straub', authorCountry: 'US', language: 'en' }),
    b({ title: 'Szótár', author: null }),
    b({ title: 'Ábécé', author: '  ' }),
  ];

  it('creates one entry per individual author and collects the anonymous books', () => {
    const { authors, anonymous } = buildAuthorEntries(books, 'hu');
    expect(authors.map((a) => a.name).sort()).toEqual(['Csáth Géza', 'Peter Straub', 'Stephen King', 'Szabó Magda', 'Victor Hugo']);
    expect(anonymous.map((x) => x.title)).toEqual(['Ábécé', 'Szótár']);
    const szabo = authors.find((a) => a.name === 'Szabó Magda')!;
    expect(szabo).toMatchObject({ count: 2, country: 'HU', languages: ['hu'], initial: 'Sz', sortName: 'Szabó Magda' });
    expect(szabo.books.map((x) => x.title)).toEqual(['Abigél', 'Az ajtó']);
    const straub = authors.find((a) => a.name === 'Peter Straub')!;
    expect(straub.count).toBe(2);
    expect(straub.sortName).toBe('Straub Peter');
    expect(straub.initial).toBe('S');
    expect(authors.find((a) => a.name === 'Victor Hugo')).toMatchObject({ initial: 'H', country: 'FR' });
  });

  it('uses Hungarian digraphs only for the Hungarian UI', () => {
    expect(buildAuthorEntries(books, 'hu').authors.find((a) => a.name === 'Csáth Géza')?.initial).toBe('Cs');
    expect(buildAuthorEntries(books, 'en').authors.find((a) => a.name === 'Csáth Géza')?.initial).toBe('C');
  });

  it('sorts and groups by index letter in Hungarian alphabet order', () => {
    const { authors } = buildAuthorEntries(books, 'hu');
    const sections = groupAuthorsByInitial(authors, 'hu');
    expect(sections.map((s) => s.letter)).toEqual(['Cs', 'H', 'K', 'S', 'Sz']);
    expect(sortAuthorEntries(authors, 'count', 'hu').slice(0, 2).map((a) => a.name)).toEqual(['Peter Straub', 'Szabó Magda']);
  });

  it('handles the sample library', () => {
    const { authors, anonymous } = buildAuthorEntries(SAMPLE_BOOKS, 'hu');
    const counted = authors.reduce((s, a) => s + a.count, 0);
    expect(counted + anonymous.length).toBeGreaterThanOrEqual(SAMPLE_BOOKS.length);
    for (const s of groupAuthorsByInitial(authors, 'hu')) expect(s.authors.every((a) => a.initial === s.letter)).toBe(true);
  });
});

describe('rail & helpers', () => {
  it('lists the whole alphabet with the present letters enabled, extras sorted in, # last', () => {
    const rail = railLetters('hu', ['Sz', 'A', '#', 'Ж']);
    expect(rail).toHaveLength(HU_INDEX_LETTERS.length + 2);
    expect(rail[rail.length - 1]).toEqual({ letter: '#', enabled: true });
    expect(rail.find((r) => r.letter === 'Sz')?.enabled).toBe(true);
    expect(rail.find((r) => r.letter === 'B')?.enabled).toBe(false);
    expect(rail.findIndex((r) => r.letter === 'Cs')).toBe(rail.findIndex((r) => r.letter === 'C') + 1);
    expect(rail.some((r) => r.letter === 'Ж')).toBe(true);
    const en = railLetters('en', []);
    expect(en.map((r) => r.letter).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ#');
    expect(en.every((r) => !r.enabled)).toBe(true);
  });

  it('guesses family-first order for secondary authors', () => {
    expect(guessSortName('Terry Pratchett', { language: 'en', authorCountry: 'GB' })).toBe('Pratchett Terry');
    expect(guessSortName('Nemes Nagy Ágnes', { language: 'hu', authorCountry: null })).toBe('Nemes Nagy Ágnes');
    expect(guessSortName('Homérosz', { language: null, authorCountry: null })).toBe('Homérosz');
    // a Hungarian translation does not make a foreign name family-first
    expect(guessSortName('Agatha Christie', { language: 'hu', authorCountry: 'GB' })).toBe('Christie Agatha');
    expect(guessSortName('Márai Sándor', { language: 'de', authorCountry: 'HU' })).toBe('Márai Sándor');
  });

  it('builds safe DOM ids', () => {
    expect(letterSectionId('Cs')).toBe('authors-letter-Cs');
    expect(letterSectionId('#')).toBe('authors-letter-other');
    expect(letterSectionId('Ж')).toMatch(/^authors-letter-u[0-9a-f]+$/);
  });
});

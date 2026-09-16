import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  authorGroupOf,
  authorStats,
  calendarDate,
  collectionTitle,
  exportFilename,
  familyNameToken,
  isoDate,
  languageName,
  NO_AUTHOR_GROUP,
  ratingStars,
  sortBooksForCatalogue,
  topicStats,
} from './shared';
import { makeSampleBook, makeSampleCollection, SAMPLE_SEEDS } from './testing/sample-collection';
import type { BookDTO } from '@/lib/types';

function book(author: string | null, authorSort: string | null, title = 'Cím', extra: Partial<BookDTO> = {}): BookDTO {
  return { ...makeSampleBook(1, SAMPLE_SEEDS[0]), author, authorSort, title, titleSort: title.toLowerCase(), ...extra };
}

describe('author grouping', () => {
  it('uses Hungarian digraphs and Ö/Ü letters for hu', () => {
    expect(authorGroupOf(book('Csáth Géza', 'csath geza'), 'hu').key).toBe('Cs');
    expect(authorGroupOf(book('Dzsida Jenő', 'dzsida jeno'), 'hu').key).toBe('Dzs');
    expect(authorGroupOf(book('Szabó Magda', 'szabo magda'), 'hu').key).toBe('Sz');
    expect(authorGroupOf(book('Gyurkovics Tibor', 'gyurkovics tibor'), 'hu').key).toBe('Gy');
    expect(authorGroupOf(book('Örkény István', 'orkeny istvan'), 'hu').key).toBe('Ö');
    expect(authorGroupOf(book('Őze Lajos', 'oze lajos'), 'hu').key).toBe('Ö');
    expect(authorGroupOf(book('Ürményi Anna', 'urmenyi anna'), 'hu').key).toBe('Ü');
    expect(authorGroupOf(book('Ábrahám Pál', 'abraham pal'), 'hu').key).toBe('A');
    expect(authorGroupOf(book('Umberto Eco', 'eco umberto'), 'hu').key).toBe('E');
  });

  it('folds accents to A–Z for en', () => {
    expect(authorGroupOf(book('Csáth Géza', 'csath geza'), 'en').key).toBe('C');
    expect(authorGroupOf(book('Örkény István', 'orkeny istvan'), 'en').key).toBe('O');
  });

  it('puts books without author last, symbols before them', () => {
    const none = authorGroupOf(book(null, null), 'hu');
    expect(none.key).toBe(NO_AUTHOR_GROUP);
    const sym = authorGroupOf(book('4B csoport', '4b csoport'), 'hu');
    expect(sym.key).toBe('#');
    expect(sym.order).toBeLessThan(none.order);
  });

  it('finds the family-name token via authorSort', () => {
    expect(familyNameToken(book('Gabriel García Márquez', 'garcia marquez gabriel'))).toBe('García');
    expect(familyNameToken(book('Cserna-Szabó András', 'csernaszabo andras'))).toBe('Cserna-Szabó');
    expect(familyNameToken(book('Elena Ferrante', null, 'x', { language: 'it', authorCountry: 'IT' }))).toBe('Ferrante');
  });

  it('detects the name order without a sort key (Hungarian editions of foreign authors, Transylvanian authors)', () => {
    expect(familyNameToken(book('Terry Pratchett', null, 'x', { language: 'hu', authorCountry: 'GB' }))).toBe('Pratchett');
    expect(familyNameToken(book('Agatha Christie', null, 'x', { language: 'hu', authorCountry: null }))).toBe('Christie');
    expect(familyNameToken(book('Dzsida Jenő', null, 'x', { language: 'hu', authorCountry: 'RO' }))).toBe('Dzsida');
    expect(authorGroupOf(book('Terry Pratchett', null, 'x', { language: 'hu', authorCountry: 'GB' }), 'hu').key).toBe('P');
  });

  it('sorts the catalogue by Hungarian alphabet groups, then author and title', () => {
    const books = [
      book('Szabó Magda', 'szabo magda', 'Az ajtó'),
      book('Sánta Ferenc', 'santa ferenc', 'Húsz óra'),
      book('Örkény István', 'orkeny istvan', 'Tóték'),
      book('Ottlik Géza', 'ottlik geza', 'Iskola a határon'),
      book(null, null, 'Értelmező kéziszótár'),
      book('Szabó Magda', 'szabo magda', 'Abigél'),
      book('Csáth Géza', 'csath geza', 'Anyagyilkosság'),
      book('Cooper, James Fenimore', 'cooper james fenimore', 'Az utolsó mohikán'),
    ].map((b, i) => ({ ...b, id: `id-${i}` }));
    const sorted = sortBooksForCatalogue(books, 'hu').map((b) => `${b.author ?? '-'}|${b.title}`);
    expect(sorted).toEqual([
      'Cooper, James Fenimore|Az utolsó mohikán',
      'Csáth Géza|Anyagyilkosság',
      'Ottlik Géza|Iskola a határon',
      'Örkény István|Tóték',
      'Sánta Ferenc|Húsz óra',
      'Szabó Magda|Abigél',
      'Szabó Magda|Az ajtó',
      '-|Értelmező kéziszótár',
    ]);
  });
});

describe('labels and values', () => {
  it('names languages in the export locale', () => {
    expect(languageName('hu', 'hu')).toBe('magyar');
    expect(languageName('hu', 'en')).toBe('Hungarian');
    expect(languageName('en', 'hu')).toBe('angol');
    expect(languageName('', 'hu')).toBe('');
    expect(languageName('not a code!', 'en')).toBe('not a code!');
  });

  it('renders ratings as stars', () => {
    expect(ratingStars(4)).toBe('★★★★☆');
    expect(ratingStars(5)).toBe('★★★★★');
    expect(ratingStars(null)).toBe('');
    expect(ratingStars(0)).toBe('');
  });

  it('titles untitled collections', () => {
    expect(collectionTitle({ title: null, ownerName: 'Kovács Ödön' }, 'hu')).toBe('Kovács Ödön könyvtára');
    expect(collectionTitle({ title: '  ', ownerName: null }, 'en')).toBe('My library');
    expect(collectionTitle({ title: 'Polc', ownerName: 'X' }, 'en')).toBe('Polc');
  });

  it('builds safe file names', () => {
    expect(exportFilename('334345435', 'xlsx')).toBe('exlibris-334345435.xlsx');
    expect(exportFilename('334345435', 'goodreads')).toBe('exlibris-334345435-goodreads.csv');
    expect(exportFilename('../x"y', 'pdf')).toBe('exlibris-xy.pdf');
  });

  it('absolutizes media URLs and rejects other schemes', () => {
    expect(absoluteUrl('/api/media/covers/1/a.jpg', 'https://www.exlibrisvideo.hu')).toBe('https://www.exlibrisvideo.hu/api/media/covers/1/a.jpg');
    expect(absoluteUrl('https://covers.openlibrary.org/b/id/1-L.jpg', 'https://x.hu')).toBe('https://covers.openlibrary.org/b/id/1-L.jpg');
    expect(absoluteUrl('javascript:alert(1)', 'https://x.hu')).toBeNull();
    expect(absoluteUrl(null, 'https://x.hu')).toBeNull();
  });

  it('computes calendar dates in Budapest time', () => {
    expect(calendarDate('2026-09-12T23:30:00.000Z')).toEqual({ y: 2026, m: 9, d: 13 });
    expect(isoDate('2026-01-31T22:59:00.000Z')).toBe('2026-01-31');
    expect(isoDate('2026-08-01')).toBe('2026-08-01');
    expect(isoDate('garbage')).toBe('');
  });
});

describe('statistics', () => {
  it('counts authors including co-authors', () => {
    const coll = new Intl.Collator('hu');
    const stats = authorStats(
      [book('Szabó Magda', 'szabo magda', 'Az ajtó'), book('Szabó Magda; Tóth Árpád', 'szabo magda', 'Közös'), book('Tóth Árpád', 'toth arpad', 'Versek')],
      coll,
    );
    expect(stats).toEqual([
      { name: 'Szabó Magda', count: 2, titles: ['Az ajtó', 'Közös'] },
      { name: 'Tóth Árpád', count: 2, titles: ['Közös', 'Versek'] },
    ]);
  });

  it('orders equally frequent authors by family name', () => {
    const coll = new Intl.Collator('hu');
    const western = (author: string, authorSort: string | null, title: string) => ({
      ...book(author, authorSort, title),
      language: 'hu',
      authorCountry: 'GB',
    });
    const stats = authorStats(
      [
        western('Agatha Christie', 'christie agatha', 'Gyilkosság az Orient expresszen'),
        book('Arany János', 'arany janos', 'Toldi'),
        western('Neil Gaiman; Terry Pratchett', 'gaiman neil', 'Hazug Szív'),
        book('Weöres Sándor', 'weores sandor', 'Bóbita'),
      ],
      coll,
    );
    expect(stats.map((s) => s.name)).toEqual(['Arany János', 'Agatha Christie', 'Neil Gaiman', 'Terry Pratchett', 'Weöres Sándor']);
  });

  it('computes primary topic shares that sum to 1', () => {
    const c = makeSampleCollection();
    const stats = topicStats(c.books, 'hu', new Intl.Collator('hu'));
    const total = stats.reduce((s, t) => s + t.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(stats.reduce((s, t) => s + t.count, 0)).toBe(c.books.length);
    expect(stats[0].count).toBeGreaterThanOrEqual(stats[1].count);
    expect(stats.find((s) => s.key === 'hungarian_literature')?.label).toBe('Magyar irodalom');
  });
});

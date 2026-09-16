import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '@/components/collection/context';
import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import {
  applyFilters,
  authorFamilyName,
  authorInitial,
  authorSortName,
  bookMatchesQuery,
  centuryNumber,
  centuryOf,
  compareInitials,
  contrastRatio,
  countActiveFilters,
  countryFlagEmoji,
  countryName,
  decadeOf,
  foldForSearch,
  foldText,
  initialOf,
  languageName,
  parseHexColor,
  pickRandom,
  readableTextColor,
  shuffle,
  sortBooks,
  SPINE_PALETTE,
  spineColor,
  spineDimensions,
  splitAuthors,
  titleSortName,
  topicCounts,
  uniqueAuthors,
} from './book-utils';

const book = makeSampleBook;

describe('foldText / foldForSearch', () => {
  it('folds Hungarian accents incl. double acute', () => {
    expect(foldText('  Árvíztűrő   TÜKÖRFÚRÓGÉP ő ű ')).toBe('arvizturo tukorfurogep o u');
    expect(foldText('Straße Øresund Łódź')).toBe('strasse oresund lodz');
    expect(foldText(null)).toBe('');
  });
  it('removes punctuation for search', () => {
    expect(foldForSearch('Sapiens – Az emberiség (rövid) története!')).toBe('sapiens az emberiseg rovid tortenete');
  });
});

describe('bookMatchesQuery', () => {
  const b = book({
    title: 'Sci-fi antológia',
    author: 'Esterházy Péter',
    series: 'Galaktika',
    publisher: 'Móra',
    originalTitle: 'Best of',
  });
  it('matches accent-insensitive and multi-term (AND)', () => {
    expect(bookMatchesQuery(b, 'esterhazy')).toBe(true);
    expect(bookMatchesQuery(b, 'PÉTER antologia')).toBe(true);
    expect(bookMatchesQuery(b, 'peter krimi')).toBe(false);
    expect(bookMatchesQuery(b, 'galaktika')).toBe(true);
    expect(bookMatchesQuery(b, 'mora')).toBe(true);
    expect(bookMatchesQuery(b, 'best of')).toBe(true);
    expect(bookMatchesQuery(b, '   ')).toBe(true);
  });
  it('ignores punctuation both ways', () => {
    expect(bookMatchesQuery(b, 'scifi')).toBe(true);
    expect(bookMatchesQuery(b, 'sci fi')).toBe(true);
    expect(bookMatchesQuery(book({ title: 'Scifi' }), 'sci-fi')).toBe(true);
  });
});

describe('authors', () => {
  it('splits multi-author values', () => {
    expect(splitAuthors('Szerb Antal; Karinthy Frigyes')).toEqual(['Szerb Antal', 'Karinthy Frigyes']);
    expect(splitAuthors('A & B')).toEqual(['A', 'B']);
    expect(splitAuthors(null)).toEqual([]);
  });
  it('restores accents in family-name-first order', () => {
    expect(authorSortName({ author: 'Gabriel García Márquez', authorSort: 'garcia marquez gabriel' })).toBe(
      'García Márquez Gabriel',
    );
    expect(authorSortName({ author: 'Örkény István', authorSort: 'orkeny istvan' })).toBe('Örkény István');
    expect(authorSortName({ author: 'J.R.R. Tolkien', authorSort: 'tolkien j r r' })).toBe('Tolkien J R R');
    expect(authorSortName({ author: 'Elena Ferrante', authorSort: null })).toBe('Elena Ferrante');
    expect(authorSortName({ author: 'Edited Name', authorSort: 'stale sortkey' })).toBe('stale sortkey');
    expect(authorSortName({ author: null, authorSort: null })).toBeNull();
  });
  it('extracts the family name using authorSort order', () => {
    expect(authorFamilyName({ author: 'Gabriel García Márquez', authorSort: 'garcia marquez gabriel' })).toBe('García Márquez');
    expect(authorFamilyName({ author: 'Nemes Nagy Ágnes', authorSort: 'nemes nagy agnes' })).toBe('Nemes Nagy');
    expect(authorFamilyName({ author: 'Szabó Magda', authorSort: 'szabo magda' })).toBe('Szabó');
    expect(authorFamilyName({ author: 'J.R.R. Tolkien', authorSort: 'tolkien j r r' })).toBe('Tolkien');
    expect(authorFamilyName({ author: 'Jean-Paul Sartre', authorSort: 'sartre jean paul' })).toBe('Sartre');
    expect(authorFamilyName({ author: 'Homérosz', authorSort: 'homerosz' })).toBe('Homérosz');
    expect(authorFamilyName({ author: 'Elena Ferrante', authorSort: null })).toBe('Elena Ferrante');
    expect(authorFamilyName({ author: null, authorSort: null })).toBeNull();
  });
  it('groups unique authors with counts', () => {
    const books = [
      book({ title: 'a', author: 'Szerb Antal' }),
      book({ title: 'b', author: 'Szerb Antal; Karinthy Frigyes' }),
      book({ title: 'c', author: 'Karinthy Frigyes' }),
      book({ title: 'd', author: 'Szerb Antal' }),
      book({ title: 'e', author: null }),
    ];
    const groups = uniqueAuthors(books);
    expect(groups.map((g) => [g.author, g.count])).toEqual([
      ['Szerb Antal', 3],
      ['Karinthy Frigyes', 2],
    ]);
    expect(groups[1].books.map((b) => b.title)).toEqual(['b', 'c']);
  });
});

describe('authorInitial (Hungarian digraphs)', () => {
  const cases: [string | null, string | null, string][] = [
    ['Csáth Géza', 'csath geza', 'Cs'],
    ['Dzsida Jenő', 'dzsida jeno', 'Dzs'],
    ['Dzurisin Anna', null, 'Dz'],
    ['Gyurkovics Tibor', null, 'Gy'],
    ['Lyka Károly', null, 'Ly'],
    ['Nyirő Anna', null, 'Ny'],
    ['Szabó Magda', null, 'Sz'],
    ['Tyukodi Ágnes', null, 'Ty'],
    ['Zsolnay Vilmos', null, 'Zs'],
    ['Örkény István', 'orkeny istvan', 'O'],
    ['Ősz Ferenc', null, 'O'],
    ['Ádám Éva', null, 'A'],
    ['Élő Márton', null, 'E'],
    ['Úri Lajos', null, 'U'],
    ['Elena Ferrante', 'ferrante elena', 'F'],
    ['Stefan Zweig', 'zweig stefan', 'Z'],
    ['Carl Sagan', 'sagan carl', 'S'],
    ['Czakó Gábor', null, 'C'],
    ['Dávid Ferenc', null, 'D'],
    ['1848 Emlékbizottság', null, '#'],
    ['„Mesélő” Kiadó', null, 'M'],
    [null, null, '#'],
  ];
  it.each(cases)('%s → %s', (author, authorSort, expected) => {
    expect(authorInitial({ author, authorSort })).toBe(expected);
  });
  it('can disable digraphs', () => {
    expect(authorInitial({ author: 'Szabó Magda', authorSort: null }, { digraphs: false })).toBe('S');
  });
  it('orders initials Hungarian-style with # last', () => {
    const letters = ['Zs', '#', 'Cs', 'C', 'Sz', 'S', 'Z', 'A', 'Dzs', 'Dz', 'D'];
    expect([...letters].sort((a, b) => compareInitials(a, b, 'hu'))).toEqual([
      'A',
      'C',
      'Cs',
      'D',
      'Dz',
      'Dzs',
      'S',
      'Sz',
      'Z',
      'Zs',
      '#',
    ]);
    expect(initialOf('Булгаков')).toBe('Б');
  });
});

describe('sortBooks', () => {
  const names = ['Zweig Stefan', 'Zsolnay Vilmos', 'Csáth Géza', 'Czakó Gábor', 'Ottlik Géza', 'Örkény István', 'Pál Ádám', 'Ádám Éva'];
  const books = names.map((author, i) => book({ title: `T${i}`, author, shelfPosition: i }));

  it('uses Hungarian collation (cs after c, zs after z, ö after o)', () => {
    expect(sortBooks(books, 'author', 'hu').map((b) => b.author)).toEqual([
      'Ádám Éva',
      'Czakó Gábor',
      'Csáth Géza',
      'Ottlik Géza',
      'Örkény István',
      'Pál Ádám',
      'Zweig Stefan',
      'Zsolnay Vilmos',
    ]);
  });
  it('uses English collation for en', () => {
    expect(sortBooks(books, 'author', 'en').map((b) => b.author)).toEqual([
      'Ádám Éva',
      'Csáth Géza',
      'Czakó Gábor',
      'Örkény István',
      'Ottlik Géza',
      'Pál Ádám',
      'Zsolnay Vilmos',
      'Zweig Stefan',
    ]);
  });
  it('sorts Western names by family name via authorSort and puts missing authors last', () => {
    const list = [
      book({ title: 'x', author: null }),
      book({ title: 'y', author: 'Elena Ferrante', authorSort: 'ferrante elena' }),
      book({ title: 'z', author: 'Esterházy Péter', authorSort: 'esterhazy peter' }),
    ];
    expect(sortBooks(list, 'author', 'hu').map((b) => b.title)).toEqual(['z', 'y', 'x']);
  });
  it('ignores leading articles for titles', () => {
    const list = ['A Pál utcai fiúk', 'Az ajtó', 'Bóbita', 'The Hobbit', 'Egri csillagok'].map((title) => book({ title }));
    expect(sortBooks(list, 'title', 'hu').map((b) => b.title)).toEqual([
      'Az ajtó',
      'Bóbita',
      'Egri csillagok',
      'The Hobbit',
      'A Pál utcai fiúk',
    ]);
    expect(titleSortName({ title: "L'amica geniale" })).toBe('amica geniale');
    expect(titleSortName({ title: 'A' })).toBe('A');
  });
  it('sorts by year (unknown last), added (newest first), rating (unrated last), shelf', () => {
    const a = book({ title: 'a', firstPublishedYear: 1990, rating: 3, createdAt: '2026-01-02T00:00:00Z', shelfPosition: 2 });
    const b = book({ title: 'b', firstPublishedYear: null, rating: null, createdAt: '2026-01-03T00:00:00Z', shelfPosition: 1 });
    const c = book({ title: 'c', firstPublishedYear: 1850, rating: 5, createdAt: '2026-01-01T00:00:00Z', shelfPosition: 3 });
    expect(sortBooks([a, b, c], 'year', 'hu').map((x) => x.title)).toEqual(['c', 'a', 'b']);
    expect(sortBooks([a, b, c], 'added', 'hu').map((x) => x.title)).toEqual(['b', 'a', 'c']);
    expect(sortBooks([a, b, c], 'rating', 'hu').map((x) => x.title)).toEqual(['c', 'a', 'b']);
    expect(sortBooks([a, b, c], 'shelf', 'hu').map((x) => x.title)).toEqual(['b', 'a', 'c']);
  });
  it('does not mutate the input', () => {
    const copy = [...books];
    sortBooks(books, 'author', 'hu');
    expect(books).toEqual(copy);
  });
});

describe('applyFilters', () => {
  const books = [
    book({ title: 'Egri csillagok', author: 'Gárdonyi Géza', category: 'historical_fiction', topics: ['classics'], firstPublishedYear: 1899, readingStatus: 'read', language: 'hu' }),
    book({ title: 'A Gyűrűk Ura', author: 'J. R. R. Tolkien', category: 'fantasy', firstPublishedYear: 1954, readingStatus: 'reading', favorite: true, language: 'hu' }),
    book({ title: 'Dune', author: 'Frank Herbert', category: 'scifi', firstPublishedYear: 1965, language: 'EN', lentTo: 'Anna' }),
    book({ title: 'Ismeretlen', author: null, category: null, needsReview: true }),
    book({ title: 'Átnézett', author: 'Szerb Antal; Karinthy Frigyes', needsReview: true, reviewed: true, firstPublishedYear: 1958 }),
  ];
  const titles = (list: typeof books) => list.map((b) => b.title);

  it('returns everything for empty filters', () => {
    expect(applyFilters(books, EMPTY_FILTERS)).toHaveLength(books.length);
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  });
  it('filters by topic (category or topics, OR) and "other" for unclassified', () => {
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, topics: ['classics', 'scifi'] }))).toEqual(['Egri csillagok', 'Dune']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, topics: ['other'] }))).toEqual(['Ismeretlen', 'Átnézett']);
  });
  it('filters by status, author (split), language, decade', () => {
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, statuses: ['read', 'reading'] }))).toEqual(['Egri csillagok', 'A Gyűrűk Ura']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, authors: ['Karinthy Frigyes'] }))).toEqual(['Átnézett']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, languages: ['en'] }))).toEqual(['Dune']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, decades: [1950, 1960] }))).toEqual(['A Gyűrűk Ura', 'Dune', 'Átnézett']);
  });
  it('filters needs review (not yet reviewed), favourites, lent, and combines with AND', () => {
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, needsReview: true }))).toEqual(['Ismeretlen']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, favorites: true }))).toEqual(['A Gyűrűk Ura']);
    expect(titles(applyFilters(books, { ...EMPTY_FILTERS, lent: true }))).toEqual(['Dune']);
    const combined = { ...EMPTY_FILTERS, q: 'gyuruk', decades: [1950], favorites: true };
    expect(titles(applyFilters(books, combined))).toEqual(['A Gyűrűk Ura']);
    expect(countActiveFilters(combined)).toBe(3);
    expect(applyFilters(books, { ...combined, q: 'dune' })).toEqual([]);
  });
});

describe('topics & years', () => {
  it('counts topics once per book and puts unclassified books under other', () => {
    const counts = topicCounts([
      book({ title: 'a', category: 'poetry', topics: ['poetry', 'classics'] }),
      book({ title: 'b', category: 'classics' }),
      book({ title: 'c' }),
    ]);
    expect(counts).toEqual([
      { key: 'classics', count: 2 },
      { key: 'other', count: 1 },
      { key: 'poetry', count: 1 },
    ]);
  });
  it('computes decades and centuries', () => {
    expect(decadeOf(1968)).toBe(1960);
    expect(decadeOf(2000)).toBe(2000);
    expect(decadeOf(null)).toBeNull();
    expect(decadeOf(Number.NaN)).toBeNull();
    expect(centuryOf(1968)).toBe(1900);
    expect(centuryNumber(1968)).toBe(20);
    expect(centuryNumber(2000)).toBe(20);
    expect(centuryNumber(2001)).toBe(21);
  });
});

describe('colours', () => {
  it('uses the measured spine colour when valid', () => {
    expect(spineColor(book({ title: 'x', spineColor: '#ABC' }))).toBe('#aabbcc');
    expect(spineColor(book({ title: 'x', spineColor: '7b2d26' }))).toBe('#7b2d26');
  });
  it('is deterministic by author (then title) otherwise', () => {
    const a1 = spineColor(book({ title: 'Egyik', author: 'Szabó Magda', spineColor: 'not-a-colour' }));
    const a2 = spineColor(book({ title: 'Másik', author: 'Szabo Magda' }));
    expect(a1).toBe(a2);
    expect(SPINE_PALETTE).toContain(a1);
    expect(spineColor(book({ title: 'Névtelen' }))).toBe(spineColor(book({ title: 'Névtelen' })));
    const used = new Set(SAMPLE_BOOKS.map((b) => spineColor({ ...b, spineColor: null })));
    expect(used.size).toBeGreaterThan(8);
  });
  it('picks readable text colours', () => {
    expect(readableTextColor('#1f4d3a')).toBe('#fbf6ec');
    expect(readableTextColor('#f1ede4')).toBe('#1e1914');
    expect(readableTextColor('#e5b94c')).toBe('#1e1914');
    for (const c of SPINE_PALETTE) expect(contrastRatio(c, readableTextColor(c))).toBeGreaterThan(4.5);
    expect(parseHexColor('nope')).toBeNull();
  });
});

describe('spineDimensions', () => {
  it('stays in range and is deterministic', () => {
    for (const b of SAMPLE_BOOKS) {
      const d = spineDimensions(b);
      expect(d.heightRatio).toBeGreaterThanOrEqual(0.78);
      expect(d.heightRatio).toBeLessThanOrEqual(1);
      expect(d.widthRatio).toBeGreaterThanOrEqual(0.7);
      expect(d.widthRatio).toBeLessThanOrEqual(1.35);
      expect(spineDimensions({ ...b })).toEqual(d);
    }
  });
  it('gets thicker with more pages or longer titles', () => {
    expect(spineDimensions(book({ title: 'x', pageCount: 1500 })).widthRatio).toBe(1.35);
    expect(spineDimensions(book({ title: 'x', pageCount: 40 })).widthRatio).toBe(0.7);
    const short = spineDimensions(book({ title: 'Vuk' })).widthRatio;
    const long = spineDimensions(book({ title: 'A százéves ember, aki kimászott az ablakon és eltűnt' })).widthRatio;
    expect(long).toBeGreaterThan(short);
  });
});

describe('countries & languages', () => {
  it('builds flag emoji', () => {
    expect(countryFlagEmoji('hu')).toBe('🇭🇺');
    expect(countryFlagEmoji('UK')).toBe('🇬🇧');
    expect(countryFlagEmoji('HUN')).toBe('');
    expect(countryFlagEmoji(null)).toBe('');
  });
  it('names countries and languages via Intl.DisplayNames', () => {
    expect(countryName('HU', 'hu')).toBe('Magyarország');
    expect(countryName('hu', 'en')).toBe('Hungary');
    expect(countryName('XX', 'en')).toBe('XX');
    expect(countryName('', 'en')).toBe('');
    expect(languageName('hu', 'hu')).toBe('Magyar');
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('123', 'en')).toBe('123');
    expect(languageName(null, 'en')).toBe('');
  });
});

describe('seeded randomness', () => {
  it('shuffles deterministically without losing items', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const s1 = shuffle(items, 'seed');
    expect(shuffle(items, 'seed')).toEqual(s1);
    expect(shuffle(items, 'other')).not.toEqual(s1);
    expect([...s1].sort((a, b) => a - b)).toEqual(items);
    expect(items[0]).toBe(0);
  });
  it('picks random elements', () => {
    expect(pickRandom([], 1)).toBeUndefined();
    expect(pickRandom(['a', 'b', 'c'], 42)).toBe(pickRandom(['a', 'b', 'c'], 42));
    expect(['a', 'b']).toContain(pickRandom(['a', 'b']));
  });
});

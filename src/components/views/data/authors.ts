/**
 * Pure grouping logic of the authors view (owner: views-data). Unit-tested in authors.test.ts.
 */
import {
  authorSortName,
  collator,
  compareInitials,
  foldForSearch,
  initialOf,
  splitAuthors,
} from '@/lib/book-utils';
import type { BookDTO, Locale } from '@/lib/types';

export type AuthorSort = 'name' | 'count';
export const AUTHOR_SORTS: readonly AuthorSort[] = ['name', 'count'];

export interface AuthorEntry {
  /** accent-folded name, stable React key */
  key: string;
  /** display name as printed on the books */
  name: string;
  /** family-name-first form (accents kept) used for collation and the index letter */
  sortName: string;
  /** A–Z index letter (Hungarian digraphs when the UI is Hungarian) */
  initial: string;
  count: number;
  /** oldest first (unknown years last), then title */
  books: BookDTO[];
  /** most frequent author country (ISO alpha-2) or null */
  country: string | null;
  /** book languages by frequency (lower-case codes) */
  languages: string[];
}

/** Hungarian alphabet as used in indexes (accented vowels are grouped with their base letter). */
export const HU_INDEX_LETTERS = [
  'A', 'B', 'C', 'Cs', 'D', 'Dz', 'Dzs', 'E', 'F', 'G', 'Gy', 'H', 'I', 'J', 'K', 'L', 'Ly', 'M', 'N', 'Ny', 'O', 'P',
  'Q', 'R', 'S', 'Sz', 'T', 'Ty', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Zs',
] as const;
export const EN_INDEX_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Letters shown on the index rail: the base alphabet plus any other initials present, "#" last. */
export function railLetters(locale: Locale, present: Iterable<string>): { letter: string; enabled: boolean }[] {
  const have = new Set(present);
  const base: string[] = locale === 'hu' ? [...HU_INDEX_LETTERS] : [...EN_INDEX_LETTERS];
  const extra = [...have].filter((l) => l !== '#' && !base.includes(l));
  const letters = [...base, ...extra].sort((a, b) => compareInitials(a, b, locale));
  letters.push('#');
  return letters.map((letter) => ({ letter, enabled: have.has(letter) }));
}

/**
 * Family-name-first form when `authorSort` does not describe this name (co-authors, or books not
 * yet processed): Hungarian authors keep the printed order, other names move the last token to the
 * front ("Terry Pratchett" → "Pratchett Terry"). The author's country decides when it is known –
 * the edition language does not, since a Hungarian translation of Agatha Christie is still
 * "Christie Agatha"; without a country a Hungarian edition suggests a Hungarian name.
 */
export function guessSortName(name: string, book: Pick<BookDTO, 'language' | 'authorCountry'>): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return name.trim();
  const country = book.authorCountry?.trim().toUpperCase();
  const hungarian = country ? country === 'HU' : book.language?.toLowerCase() === 'hu';
  if (hungarian) return tokens.join(' ');
  return [tokens[tokens.length - 1], ...tokens.slice(0, -1)].join(' ');
}

function mostFrequent(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

function compareBooksByYear(locale: Locale) {
  const c = collator(locale);
  return (a: BookDTO, b: BookDTO) => {
    const ay = a.firstPublishedYear;
    const by = b.firstPublishedYear;
    if (ay == null && by != null) return 1;
    if (by == null && ay != null) return -1;
    return (ay ?? 0) - (by ?? 0) || c.compare(a.title, b.title);
  };
}

/**
 * One entry per individual author (multi-author values like "A; B" count for each), plus the
 * books that have no author at all.
 */
export function buildAuthorEntries(
  books: readonly BookDTO[],
  locale: Locale,
): { authors: AuthorEntry[]; anonymous: BookDTO[] } {
  interface Acc {
    name: string;
    sortName: string | null;
    guessedSort: string;
    books: BookDTO[];
    countries: string[];
    languages: string[];
  }
  const map = new Map<string, Acc>();
  const anonymous: BookDTO[] = [];

  for (const book of books) {
    const names = splitAuthors(book.author);
    if (names.length === 0) {
      anonymous.push(book);
      continue;
    }
    names.forEach((name, i) => {
      const key = foldForSearch(name);
      if (!key) return;
      let acc = map.get(key);
      if (!acc) {
        acc = { name, sortName: null, guessedSort: guessSortName(name, book), books: [], countries: [], languages: [] };
        map.set(key, acc);
      }
      if (i === 0 && acc.sortName === null && book.authorSort) acc.sortName = authorSortName(book);
      if (acc.books.includes(book)) return;
      acc.books.push(book);
      if (i === 0 && book.authorCountry?.trim()) acc.countries.push(book.authorCountry.trim().toUpperCase());
      if (book.language?.trim()) acc.languages.push(book.language.trim().toLowerCase());
    });
  }

  const digraphs = locale === 'hu';
  const byYear = compareBooksByYear(locale);
  const authors: AuthorEntry[] = [...map.entries()].map(([key, acc]) => {
    const sortName = acc.sortName ?? acc.guessedSort;
    return {
      key,
      name: acc.name,
      sortName,
      initial: initialOf(sortName, digraphs),
      count: acc.books.length,
      books: [...acc.books].sort(byYear),
      country: mostFrequent(acc.countries)[0] ?? null,
      languages: mostFrequent(acc.languages),
    };
  });
  anonymous.sort((a, b) => collator(locale).compare(a.title, b.title));
  return { authors, anonymous };
}

export function sortAuthorEntries(authors: readonly AuthorEntry[], sort: AuthorSort, locale: Locale): AuthorEntry[] {
  const c = collator(locale);
  const byName = (a: AuthorEntry, b: AuthorEntry) => compareInitials(a.initial, b.initial, locale) || c.compare(a.sortName, b.sortName);
  return [...authors].sort(sort === 'count' ? (a, b) => b.count - a.count || byName(a, b) : byName);
}

export interface AuthorSection {
  letter: string;
  authors: AuthorEntry[];
}

/** Sections per index letter in alphabet order ("#" last); authors inside sorted by name. */
export function groupAuthorsByInitial(authors: readonly AuthorEntry[], locale: Locale): AuthorSection[] {
  const sorted = sortAuthorEntries(authors, 'name', locale);
  const sections: AuthorSection[] = [];
  for (const a of sorted) {
    const last = sections[sections.length - 1];
    if (last && last.letter === a.initial) last.authors.push(a);
    else sections.push({ letter: a.initial, authors: [a] });
  }
  return sections;
}

/** DOM id of a letter section ("Cs" → "authors-letter-Cs", "#" → "authors-letter-other"). */
export function letterSectionId(letter: string): string {
  if (letter === '#') return 'authors-letter-other';
  return `authors-letter-${[...letter].map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : `u${ch.codePointAt(0)?.toString(16)}`)).join('')}`;
}

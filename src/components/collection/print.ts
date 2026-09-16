/**
 * Print catalogue model: books grouped by author (family name first, accents kept), authors in
 * locale collation order, books without an author last. Pure – unit-tested.
 */
import { authorSortName, foldForSearch, sortBooks, splitAuthors } from '@/lib/book-utils';
import type { BookDTO, Locale } from '@/lib/types';

/**
 * Heading of an author group: family name first like a library catalogue ("Berne Eric"), but the
 * printed spelling wins when the name already is family-first ("Bánki M. Csaba" keeps its dot), and
 * the display name is used when only a folded sort key is known ("baroncohen simon" → "Simon Baron-Cohen").
 */
export function printAuthorHeading(book: Pick<BookDTO, 'author' | 'authorSort'>): string | null {
  const display = splitAuthors(book.author)[0]?.replace(/\s+/g, ' ').trim() || null;
  const sortName = authorSortName(book)?.trim() || null;
  if (!display) return sortName;
  if (!sortName) return display;
  if (foldForSearch(display) === foldForSearch(sortName)) return display;
  const foldedFallback = sortName === sortName.toLocaleLowerCase() && display !== display.toLocaleLowerCase();
  return foldedFallback ? display : sortName;
}

export interface PrintAuthorGroup {
  /** stable key (folded author name, "" for the no-author group) */
  key: string;
  /** heading: "Esterházy Péter", "García Márquez Gabriel"; null = books without an author */
  author: string | null;
  books: BookDTO[];
}

export function groupBooksForPrint(books: readonly BookDTO[], locale: Locale): PrintAuthorGroup[] {
  const groups: PrintAuthorGroup[] = [];
  const byKey = new Map<string, PrintAuthorGroup>();
  let noAuthor: PrintAuthorGroup | null = null;

  for (const book of sortBooks(books, 'author', locale)) {
    const name = authorSortName(book)?.trim() || null;
    const key = name ? foldForSearch(name) : '';
    if (!name || !key) {
      noAuthor ??= { key: '', author: null, books: [] };
      noAuthor.books.push(book);
      continue;
    }
    let group = byKey.get(key);
    if (!group) {
      group = { key, author: printAuthorHeading(book) ?? name, books: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.books.push(book);
  }
  if (noAuthor) groups.push(noAuthor);
  return groups;
}

/** Secondary line of a printed entry: "1965 · Európa Könyvkiadó · Dűne-ciklus". */
export function printDetails(book: Pick<BookDTO, 'firstPublishedYear' | 'publisher' | 'series'>): string {
  const parts: string[] = [];
  if (typeof book.firstPublishedYear === 'number' && Number.isFinite(book.firstPublishedYear)) parts.push(String(book.firstPublishedYear));
  if (book.publisher?.trim()) parts.push(book.publisher.trim());
  if (book.series?.trim()) parts.push(book.series.trim());
  return parts.join(' · ');
}

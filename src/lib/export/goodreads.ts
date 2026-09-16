/**
 * Goodreads import CSV (https://www.goodreads.com/review/import).
 * Exact column set of the Goodreads importer, comma separated, UTF-8, CRLF.
 */
import type { BookDTO, ReadingStatus } from '@/lib/types';
import { toCsv, type CsvValue } from './csv';
import { isFamilyNameFirst, isoDate, primaryAuthor, type ExportContext } from './shared';

export const GOODREADS_COLUMNS = [
  'Title',
  'Author',
  'ISBN',
  'My Rating',
  'Average Rating',
  'Publisher',
  'Binding',
  'Year Published',
  'Original Publication Year',
  'Date Read',
  'Date Added',
  'Shelves',
  'Bookshelves',
  'My Review',
] as const;

export type GoodreadsShelf = 'read' | 'currently-reading' | 'to-read';

/** Goodreads' exclusive shelves: read / currently-reading / to-read (everything else). */
export function goodreadsShelf(status: ReadingStatus): GoodreadsShelf {
  switch (status) {
    case 'read':
      return 'read';
    case 'reading':
      return 'currently-reading';
    default:
      return 'to-read';
  }
}

/**
 * Goodreads lists authors in Western order ("Magda Szabó"). Hungarian family-name-first
 * display names ("Szabó Magda") are flipped so the importer can match them.
 */
export function goodreadsAuthor(book: Pick<BookDTO, 'author' | 'authorSort' | 'language' | 'authorCountry'>): string {
  const author = primaryAuthor(book);
  if (!author) return '';
  if (!isFamilyNameFirst(book)) return author;
  const parts = author.split(/\s+/).filter(Boolean);
  const given = parts.pop();
  return given ? [given, ...parts].join(' ') : author;
}

/** ISBN digits (and a trailing X) only; empty when not a plausible ISBN-10/13. */
export function cleanIsbn(isbn: string | null | undefined): string {
  if (!isbn) return '';
  const s = isbn.toUpperCase().replace(/[^0-9X]/g, '');
  if (s.length === 13 && /^\d{13}$/.test(s)) return s;
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) return s;
  return '';
}

/**
 * Every shelf of a book: the exclusive shelf first, then custom shelves. The same list goes into
 * both "Shelves" (import template) and "Bookshelves" (Goodreads' own export format), because
 * importers read one or the other – splitting them would lose either the reading status or the
 * custom shelves.
 */
export function goodreadsShelves(book: Pick<BookDTO, 'readingStatus' | 'favorite'>): string {
  const shelves: string[] = [goodreadsShelf(book.readingStatus)];
  if (book.favorite) shelves.push('favorites');
  if (book.readingStatus === 'abandoned') shelves.push('did-not-finish');
  return shelves.join(', ');
}

export function goodreadsRow(book: BookDTO, ctx: Pick<ExportContext, 'isOwner'>): CsvValue[] {
  const shelves = goodreadsShelves(book);
  const title = book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
  return [
    title,
    goodreadsAuthor(book),
    cleanIsbn(book.isbn),
    book.rating != null && book.rating > 0 ? Math.min(5, Math.round(book.rating)) : 0,
    '',
    book.publisher ?? '',
    '',
    book.editionYear ?? '',
    book.firstPublishedYear ?? '',
    '',
    isoDate(book.createdAt, '/'),
    shelves,
    shelves,
    ctx.isOwner ? book.notes ?? '' : '',
  ];
}

export function buildGoodreadsCsv(ctx: ExportContext): Buffer {
  const rows: CsvValue[][] = [[...GOODREADS_COLUMNS]];
  for (const b of ctx.books) rows.push(goodreadsRow(b, ctx));
  // Goodreads' importer expects plain UTF-8 without BOM, comma separated.
  return toCsv(rows, { delimiter: ',', bom: false });
}

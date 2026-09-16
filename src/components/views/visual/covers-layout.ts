/**
 * Pure helpers of the cover wall: responsive column count, initial-letter groups and the
 * description in the reader's language. No DOM – unit-tested.
 */
import type { SortKey } from '@/components/collection/context';
import { authorInitial, initialOf, titleSortName } from '@/lib/book-utils';
import type { BookDTO, Locale } from '@/lib/types';

export interface CoverGridMetrics {
  columns: number;
  /** width of one card (px) */
  cardWidth: number;
  gap: number;
}

/**
 * Column count for a container: as many cards of at least `minCard` px as fit (≥ 2 on phones),
 * at most `maxColumns`. Gap shrinks on narrow screens.
 */
export function coverGridMetrics(width: number, opts: { minCard?: number; maxColumns?: number } = {}): CoverGridMetrics {
  const gap = width < 520 ? 14 : width < 960 ? 20 : 26;
  const minCard = opts.minCard ?? (width < 520 ? 128 : 150);
  const maxColumns = opts.maxColumns ?? 10;
  if (!(width > 0)) return { columns: 2, cardWidth: 0, gap };
  const columns = Math.max(2, Math.min(maxColumns, Math.floor((width + gap) / (minCard + gap))));
  return { columns, cardWidth: Math.max(0, (width - gap * (columns - 1)) / columns), gap };
}

export interface InitialGroup {
  /** index letter ("A", "Cs", "#") */
  key: string;
  books: BookDTO[];
}

/**
 * Initial-letter groups for author / title sorts (null for other sorts – no headers). Books keep
 * the given order; a letter that shows up again later (collation quirks) joins its first group.
 * Hungarian digraphs (Cs, Gy, Sz…) only for the Hungarian UI, matching its collation.
 */
export function initialGroups(books: readonly BookDTO[], sort: SortKey, locale: Locale): InitialGroup[] | null {
  if (sort !== 'author' && sort !== 'title') return null;
  const digraphs = locale === 'hu';
  const groups: InitialGroup[] = [];
  const byKey = new Map<string, InitialGroup>();
  for (const book of books) {
    const key = sort === 'author' ? authorInitial(book, { digraphs }) : initialOf(titleSortName(book), digraphs);
    let group = byKey.get(key);
    if (!group) {
      group = { key, books: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.books.push(book);
  }
  return groups;
}

/** Splits into consecutive chunks of `size` (last one shorter). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * The description to show: the reader's language first, else the other one (flagged with its
 * language so the markup can carry a `lang` attribute). null when there is none.
 */
export function localizedDescription(
  book: Pick<BookDTO, 'descriptionHu' | 'descriptionEn'>,
  locale: Locale,
): { text: string; lang: Locale; fallback: boolean } | null {
  const hu = book.descriptionHu?.trim() || null;
  const en = book.descriptionEn?.trim() || null;
  if (locale === 'hu') {
    if (hu) return { text: hu, lang: 'hu', fallback: false };
    if (en) return { text: en, lang: 'en', fallback: true };
  } else {
    if (en) return { text: en, lang: 'en', fallback: false };
    if (hu) return { text: hu, lang: 'hu', fallback: true };
  }
  return null;
}

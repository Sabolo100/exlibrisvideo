/**
 * Filter facets and header counts derived from the book list. Pure – unit-tested.
 */
import { READING_STATUSES, type BookDTO, type Locale, type ReadingStatus } from '@/lib/types';
import { decadeOf, isLent, isPendingReview, splitAuthors, foldForSearch, topicCounts, uniqueAuthors } from '@/lib/book-utils';
import { estimatePages } from '@/components/views/data/stats';

export interface FacetCount<K> {
  key: K;
  count: number;
}

export interface CollectionFacets {
  topics: FacetCount<string>[];
  statuses: FacetCount<ReadingStatus>[];
  authors: FacetCount<string>[];
  /** ISO 639-1 codes, lower-case, by count desc */
  languages: FacetCount<string>[];
  /** decade start years, ascending */
  decades: FacetCount<number>[];
  pendingReview: number;
  favorites: number;
  lent: number;
}

export function computeFacets(books: readonly BookDTO[], locale: Locale): CollectionFacets {
  const statusMap = new Map<ReadingStatus, number>();
  const languageMap = new Map<string, number>();
  const decadeMap = new Map<number, number>();
  let pendingReview = 0;
  let favorites = 0;
  let lent = 0;

  for (const book of books) {
    statusMap.set(book.readingStatus, (statusMap.get(book.readingStatus) ?? 0) + 1);
    const lang = book.language?.trim().toLowerCase();
    if (lang) languageMap.set(lang, (languageMap.get(lang) ?? 0) + 1);
    const decade = decadeOf(book.firstPublishedYear);
    if (decade !== null) decadeMap.set(decade, (decadeMap.get(decade) ?? 0) + 1);
    if (isPendingReview(book)) pendingReview += 1;
    if (book.favorite) favorites += 1;
    if (isLent(book)) lent += 1;
  }

  return {
    topics: topicCounts(books),
    statuses: READING_STATUSES.filter((s) => statusMap.has(s)).map((s) => ({ key: s, count: statusMap.get(s) ?? 0 })),
    authors: uniqueAuthors(books, locale).map((a) => ({ key: a.author, count: a.count })),
    languages: [...languageMap.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    decades: [...decadeMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key - b.key),
    pendingReview,
    favorites,
    lent,
  };
}

export interface HeaderCounts {
  books: number;
  authors: number;
  topics: number;
  /** known page counts plus an estimate for the books without one – the same number the Stats view shows */
  pages: number;
  /** true when at least one book had no page count (the number is an estimate) */
  pagesEstimated: boolean;
}

export function headerCounts(books: readonly BookDTO[]): HeaderCounts {
  const authors = new Set<string>();
  const topics = new Set<string>();
  for (const book of books) {
    for (const name of splitAuthors(book.author)) {
      const key = foldForSearch(name);
      if (key) authors.add(key);
    }
    if (book.category) topics.add(book.category);
    for (const topic of book.topics ?? []) if (topic) topics.add(topic);
  }
  // one source of truth with the Stats view, otherwise the header and the statistics disagree
  const pages = estimatePages(books);
  return {
    books: books.length,
    authors: authors.size,
    topics: topics.size,
    pages: pages.total,
    pagesEstimated: pages.isEstimate,
  };
}

/** Case/accent-insensitive author search for the filter list. */
export function filterAuthorFacets(authors: readonly FacetCount<string>[], query: string): FacetCount<string>[] {
  const q = foldForSearch(query);
  if (!q) return [...authors];
  const terms = q.split(' ');
  return authors.filter((a) => {
    const hay = foldForSearch(a.key);
    return terms.every((term) => hay.includes(term));
  });
}

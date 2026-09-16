'use client';

/**
 * Contract: client-side state of the collection page, shared by the shell, every view and
 * the book drawer. The Provider implementation lives in CollectionProvider.tsx (owner: collection-shell).
 * Views and book components only consume `useCollection()`.
 */
import { createContext, useContext } from 'react';
import type {
  BookDTO,
  BookPatch,
  CollectionPatch,
  CollectionWithBooksDTO,
  Locale,
  ReadingStatus,
  ViewKey,
} from '@/lib/types';

export type SortKey = 'shelf' | 'author' | 'title' | 'year' | 'added' | 'rating';

export interface BookFilters {
  /** accent-insensitive search over title, author, series, publisher, original title */
  q: string;
  /** taxonomy keys – matches category or topics */
  topics: string[];
  statuses: ReadingStatus[];
  /** exact `author` display values */
  authors: string[];
  languages: string[];
  /** decade start years, e.g. 1960 */
  decades: number[];
  needsReview: boolean;
  favorites: boolean;
  lent: boolean;
}

export const EMPTY_FILTERS: BookFilters = {
  q: '',
  topics: [],
  statuses: [],
  authors: [],
  languages: [],
  decades: [],
  needsReview: false,
  favorites: false,
  lent: false,
};

export interface CollectionContextValue {
  collection: CollectionWithBooksDTO;
  /** all books (unfiltered) */
  books: BookDTO[];
  /** filtered + sorted */
  visibleBooks: BookDTO[];
  isOwner: boolean;
  locale: Locale;

  view: ViewKey;
  setView: (view: ViewKey) => void;

  filters: BookFilters;
  setFilters: (patch: Partial<BookFilters>) => void;
  resetFilters: () => void;
  activeFilterCount: number;

  sort: SortKey;
  setSort: (sort: SortKey) => void;

  /** book drawer */
  openBookId: string | null;
  openBook: (id: string | null) => void;

  /** multi-select (table view bulk actions) */
  selection: ReadonlySet<string>;
  toggleSelect: (id: string) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  /** mutations – optimistic, roll back + toast on failure, owner only */
  updateBook: (id: string, patch: BookPatch) => Promise<BookDTO | null>;
  deleteBooks: (ids: string[]) => Promise<void>;
  addBook: (input: BookPatch & { title: string }) => Promise<BookDTO | null>;
  mergeBooks: (keepId: string, mergeIds: string[]) => Promise<BookDTO | null>;
  updateCollection: (patch: CollectionPatch) => Promise<void>;
  /** re-fetch collection + books from the API */
  refresh: () => Promise<void>;
}

export const CollectionContext = createContext<CollectionContextValue | null>(null);

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used inside <CollectionProvider>');
  return ctx;
}

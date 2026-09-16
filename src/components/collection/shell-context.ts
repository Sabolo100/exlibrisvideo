'use client';

/**
 * Shell-internal extension of the collection context (owner: collection-shell).
 * Views and book components use only `useCollection()` from context.ts; the header, toolbar,
 * dialogs and bulk bar additionally read this.
 */
import { createContext, useContext } from 'react';
import type { BookDTO, BookPatch, CollectionDTO, CollectionPatch } from '@/lib/types';
import type { CollectionFacets, HeaderCounts } from './facets';

/** id of the toolbar search input ("/" focuses it) */
export const SEARCH_INPUT_ID = 'collection-search';
/** id of the element that contains the active view (tabpanel) */
export const VIEW_PANEL_ID = 'collection-view-panel';

export interface BulkResult {
  ok: number;
  failed: number;
}

export interface CollectionShellValue {
  /** the search text actually applied to visibleBooks (debounced) */
  appliedQuery: string;
  /** facets over all books (filter panel) */
  facets: CollectionFacets;
  counts: HeaderCounts;
  /** books waiting for review (needsReview && !reviewed) */
  pendingReview: number;
  /** owner only: spines that could not be read and wait for the owner to name them */
  unreadSpineCount: number;
  /** a refresh request is in flight */
  refreshing: boolean;
  /** raw owner token remembered on this device (null when unknown / not the owner) */
  ownerToken: string | null;
  /** refresh without error toasts (background refreshes) */
  refreshSilently: () => Promise<void>;
  /** PATCH the collection; throws ApiClientError (caller shows inline errors), updates state on success */
  saveCollection: (patch: CollectionPatch) => Promise<CollectionDTO>;
  /**
   * Optimistic patch of many books with bounded concurrency and one summary toast.
   * `patch` may be computed per book (return null to skip a book).
   */
  bulkUpdate: (ids: readonly string[], patch: BookPatch | ((book: BookDTO) => BookPatch | null)) => Promise<BulkResult>;
  /** records a successful e-mail export address change without another request */
  setCollectionEmail: (email: string | null) => void;
  focusSearch: () => void;
}

export const CollectionShellContext = createContext<CollectionShellValue | null>(null);

export function useCollectionShell(): CollectionShellValue {
  const ctx = useContext(CollectionShellContext);
  if (!ctx) throw new Error('useCollectionShell must be used inside <CollectionProvider>');
  return ctx;
}

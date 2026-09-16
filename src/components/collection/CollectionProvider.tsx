'use client';

/**
 * Client state of the collection page (implements CollectionContextValue from context.ts).
 *
 * - Data: seeded from the Server Component (`initial`), replaced by `refresh()` and by a new
 *   `initial` after `router.refresh()` (claim, locale switch).
 * - View / sort / filters / open book live in React state and are mirrored into the query string
 *   with the History API (Next.js syncs usePathname/useSearchParams with it) – no server round trip
 *   per keystroke. Back/forward (popstate) flows back into the state. Opening a book pushes a history
 *   entry so the phone back button closes the drawer.
 * - Mutations are optimistic and roll back with a toast on failure; owner only.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { applyFilters, countActiveFilters, sortBooks } from '@/lib/book-utils';
import { api, ApiClientError } from '@/lib/client/api';
import { getOwnerToken } from '@/lib/client/my-collections';
import type { BookDTO, BookPatch, CollectionDTO, CollectionPatch, CollectionWithBooksDTO, UnreadSpineDTO, ViewKey } from '@/lib/types';
import { CollectionContext, EMPTY_FILTERS, type BookFilters, type CollectionContextValue, type SortKey } from './context';
import { apiErrorMessage, isAbortError, isApiError } from './errors';
import { computeFacets, headerCounts } from './facets';
import {
  applyBookPatch,
  applyCollectionPatch,
  mergeCollectionDTO,
  pruneSelection,
  removeBooks,
  restoreBooks,
  rollbackBookPatch,
  runPool,
  sameCollectionData,
  upsertBook,
  type RemovedBook,
} from './mutations';
import { CollectionShellContext, SEARCH_INPUT_ID, type BulkResult, type CollectionShellValue } from './shell-context';
import { buildSearch, filtersEqual, hrefWithSearch, parseUrlState, stateKey, type CollectionUrlState } from './url-state';

const SEARCH_DEBOUNCE_MS = 150;
const MUTATION_CONCURRENCY = 4;
/** background refresh when the tab becomes visible again after this long */
const STALE_AFTER_MS = 3 * 60 * 1000;
const NO_UNREAD_SPINES: UnreadSpineDTO[] = [];

export interface CollectionProviderProps {
  initial: CollectionWithBooksDTO;
  children: ReactNode;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay, debounced]);
  return debounced;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function CollectionProvider({ initial, children }: CollectionProviderProps) {
  const { locale, t, tp } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */

  const [collection, setCollection] = useState<CollectionWithBooksDTO>(initial);
  const dataRef = useRef<CollectionWithBooksDTO>(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    // new server render (router.refresh after claim / unlock / locale switch)
    setSeenInitial(initial);
    setCollection(initial);
    dataRef.current = initial;
  }

  /** Synchronous state update through the ref, so async mutations always see the latest data. */
  const commit = useCallback((updater: (current: CollectionWithBooksDTO) => CollectionWithBooksDTO) => {
    const next = updater(dataRef.current);
    if (next === dataRef.current) return;
    dataRef.current = next;
    setCollection(next);
  }, []);

  const collectionId = collection.id;
  const isOwner = collection.isOwner;
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;
  const books = collection.books;
  const unreadSpines = collection.unreadSpines ?? NO_UNREAD_SPINES;

  /* ------------------------------------------------------------------ */
  /* URL-synced UI state                                                 */
  /* ------------------------------------------------------------------ */

  const [urlSeed] = useState<CollectionUrlState>(() => parseUrlState(searchParams, { isOwner: initial.isOwner }));
  const [view, setViewState] = useState<ViewKey>(urlSeed.view);
  const [sort, setSortState] = useState<SortKey>(urlSeed.sort);
  const [filters, setFiltersState] = useState<BookFilters>(urlSeed.filters);
  const seedBook = urlSeed.book && initial.books.some((b) => b.id === urlSeed.book) ? urlSeed.book : null;
  const [openBookId, setOpenBookIdState] = useState<string | null>(seedBook);
  /** latest open book id, updated synchronously (openBook may be called twice before a render) */
  const openBookRef = useRef<string | null>(seedBook);
  const setOpenBookId = useCallback((id: string | null) => {
    openBookRef.current = id;
    setOpenBookIdState(id);
  }, []);

  const appliedQuery = useDebouncedValue(filters.q, SEARCH_DEBOUNCE_MS);
  const effectiveView: ViewKey = view === 'review' && !isOwner ? 'shelf' : view;

  const urlState = useMemo<CollectionUrlState>(
    () => ({ view: effectiveView, sort, filters: { ...filters, q: appliedQuery }, book: openBookId }),
    [effectiveView, sort, filters, appliedQuery, openBookId],
  );
  const urlStateRef = useRef(urlState);
  urlStateRef.current = urlState;
  /**
   * view / sort / filters as they will be after the state updates already scheduled in this tick.
   * `urlStateRef` only catches up on the next render, so a `setFilters(...)` immediately followed by
   * `openBook(null)` (filter from inside the drawer, then close it) used to look like "nothing changed"
   * and went back in history – which undid the new filter.
   */
  const pendingRef = useRef<{ view: ViewKey; sort: SortKey; filters: BookFilters }>({ view: effectiveView, sort, filters });
  pendingRef.current = { view: effectiveView, sort, filters };

  /** 'push' for the next URL write (opening the drawer), otherwise replace */
  const nextHistoryMode = useRef<'push' | 'replace'>('replace');
  /** the drawer entry was pushed by us: closing it goes back instead of replacing */
  const bookEntryPushed = useRef<{ baseKey: string } | null>(null);
  /** history.back() in flight: don't write the URL until popstate lands */
  const awaitingPop = useRef<number | null>(null);

  const writeUrl = useCallback((state: CollectionUrlState, mode: 'push' | 'replace') => {
    const current = new URLSearchParams(window.location.search);
    const search = buildSearch(current, state);
    if (search === current.toString()) return;
    const href = hrefWithSearch(window.location.pathname, search) + window.location.hash;
    try {
      if (mode === 'push') window.history.pushState(null, '', href);
      else window.history.replaceState(null, '', href);
    } catch {
      /* Safari throttles history updates (>100 per 30 s) – the in-memory state is still correct */
    }
  }, []);

  // state -> URL
  useEffect(() => {
    if (awaitingPop.current !== null) return;
    const mode = nextHistoryMode.current;
    nextHistoryMode.current = 'replace';
    writeUrl(urlState, mode);
  }, [urlState, writeUrl]);

  // URL -> state (back / forward)
  useEffect(() => {
    const onPop = () => {
      if (awaitingPop.current !== null) {
        window.clearTimeout(awaitingPop.current);
        awaitingPop.current = null;
      }
      const parsed = parseUrlState(new URLSearchParams(window.location.search), { isOwner: isOwnerRef.current });
      setViewState(parsed.view);
      setSortState(parsed.sort);
      setFiltersState((prev) => (filtersEqual(prev, parsed.filters) ? prev : parsed.filters));
      const exists = parsed.book !== null && dataRef.current.books.some((b) => b.id === parsed.book);
      setOpenBookId(exists ? parsed.book : null);
      bookEntryPushed.current = null;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (awaitingPop.current !== null) window.clearTimeout(awaitingPop.current);
    };
  }, [setOpenBookId]);

  const setView = useCallback((next: ViewKey) => {
    if (next === 'review' && !isOwnerRef.current) return;
    pendingRef.current = { ...pendingRef.current, view: next };
    setViewState(next);
  }, []);

  const setSort = useCallback((next: SortKey) => {
    pendingRef.current = { ...pendingRef.current, sort: next };
    setSortState(next);
  }, []);

  const setFilters = useCallback((patch: Partial<BookFilters>) => {
    pendingRef.current = { ...pendingRef.current, filters: { ...pendingRef.current.filters, ...patch } };
    setFiltersState((prev) => {
      const next = { ...prev, ...patch };
      return filtersEqual(prev, next) ? prev : next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    pendingRef.current = { ...pendingRef.current, filters: EMPTY_FILTERS };
    setFiltersState((prev) => (filtersEqual(prev, EMPTY_FILTERS) ? prev : EMPTY_FILTERS));
  }, []);

  const openBook = useCallback(
    (id: string | null) => {
      const current = openBookRef.current;
      if (id === current) return;
      if (id !== null && !dataRef.current.books.some((b) => b.id === id)) return;
      // compare against the pending state, not the last rendered one (see pendingRef)
      const pending = pendingRef.current;
      const applied = urlStateRef.current;
      // the search box is debounced: a typed-but-not-yet-applied query is a change too
      const queryPending = pending.filters.q !== applied.filters.q;
      const baseKey = stateKey({
        view: pending.view,
        sort: pending.sort,
        filters: { ...pending.filters, q: applied.filters.q },
        book: null,
      });

      if (id !== null && current === null) {
        nextHistoryMode.current = 'push';
        bookEntryPushed.current = { baseKey };
      } else if (id === null && bookEntryPushed.current) {
        const pushed = bookEntryPushed.current;
        bookEntryPushed.current = null;
        // Go back only when nothing else changed since the drawer opened (back would undo that change).
        if (pushed.baseKey === baseKey && !queryPending) {
          awaitingPop.current = window.setTimeout(() => {
            // popstate normally lands within a frame; if it never does, write the state instead
            awaitingPop.current = null;
            writeUrl(urlStateRef.current, 'replace');
          }, 700);
          window.history.back();
        }
      }
      setOpenBookId(id);
    },
    [setOpenBookId, writeUrl],
  );

  // a book that disappeared (deleted, merged away, refreshed) closes the drawer
  useEffect(() => {
    if (openBookId && !books.some((b) => b.id === openBookId)) openBook(null);
  }, [books, openBookId, openBook]);

  /* ------------------------------------------------------------------ */
  /* derived lists                                                       */
  /* ------------------------------------------------------------------ */

  const filtersWithoutQuery = JSON.stringify({ ...filters, q: '' });
  const appliedFilters = useMemo<BookFilters>(
    () => ({ ...filters, q: appliedQuery }),
    // `filters.q` changes on every keystroke – only the debounced text may re-filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtersWithoutQuery, appliedQuery],
  );
  const visibleBooks = useMemo(
    () => sortBooks(applyFilters(books, appliedFilters), sort, locale),
    [books, appliedFilters, sort, locale],
  );
  const activeFilterCount = countActiveFilters(filters);
  const facets = useMemo(() => computeFacets(books, locale), [books, locale]);
  const counts = useMemo(() => headerCounts(books), [books]);

  /* ------------------------------------------------------------------ */
  /* selection                                                           */
  /* ------------------------------------------------------------------ */

  const [rawSelection, setRawSelection] = useState<ReadonlySet<string>>(() => new Set());
  const selection = useMemo(() => pruneSelection(rawSelection, books), [rawSelection, books]);

  const toggleSelect = useCallback((id: string) => {
    setRawSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setSelection = useCallback((ids: string[]) => setRawSelection(new Set(ids)), []);
  const clearSelection = useCallback(() => setRawSelection((prev) => (prev.size ? new Set() : prev)), []);

  /* ------------------------------------------------------------------ */
  /* errors & guards                                                     */
  /* ------------------------------------------------------------------ */

  const requireOwner = useCallback((): boolean => {
    if (isOwnerRef.current) return true;
    toast({ id: 'collection-read-only', title: t('collection.toast.readOnly'), tone: 'error' });
    return false;
  }, [toast, t]);

  /** 403 on a mutation: the owner cookie is gone (cleared, other browser profile) – re-render as viewer. */
  const handleLostOwnership = useCallback(
    (err: unknown) => {
      if (isApiError(err, 'forbidden')) router.refresh();
    },
    [router],
  );

  /* ------------------------------------------------------------------ */
  /* refresh                                                             */
  /* ------------------------------------------------------------------ */

  const [refreshing, setRefreshing] = useState(false);
  const refreshSeq = useRef(0);
  const lastRefreshAt = useRef(Date.now());

  const runRefresh = useCallback(
    async (silent: boolean) => {
      const seq = ++refreshSeq.current;
      setRefreshing(true);
      try {
        const data = await api.getCollection(collectionId);
        if (seq !== refreshSeq.current) return;
        lastRefreshAt.current = Date.now();
        // identical payload (the usual case right after the server render): keep the object identities
        commit((current) => (sameCollectionData(current, data) ? current : data));
      } catch (err) {
        if (seq !== refreshSeq.current || isAbortError(err)) return;
        if (isApiError(err, 'not_found') || isApiError(err, 'needs_pin')) {
          // deleted elsewhere / PIN changed: let the server render the 404 or the PIN gate
          router.refresh();
          return;
        }
        if (!silent) {
          toast({
            id: 'collection-refresh-failed',
            title: t('collection.toast.refreshFailed'),
            description: apiErrorMessage(err, t),
            tone: 'error',
            action: { label: t('common.action.retry'), onClick: () => void runRefresh(false) },
          });
        }
      } finally {
        if (seq === refreshSeq.current) setRefreshing(false);
      }
    },
    [collectionId, commit, router, toast, t],
  );

  const refresh = useCallback(() => runRefresh(false), [runRefresh]);
  const refreshSilently = useCallback(() => runRefresh(true), [runRefresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshAt.current < STALE_AFTER_MS) return;
      const status = dataRef.current.status;
      // the processing panel polls on its own
      if (status === 'ready' || status === 'error') void runRefresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [runRefresh]);

  /* ------------------------------------------------------------------ */
  /* book mutations                                                      */
  /* ------------------------------------------------------------------ */

  const bookRequestSeq = useRef(new Map<string, number>());
  const updateBookRef = useRef<CollectionContextValue['updateBook'] | null>(null);

  const dropBookLocally = useCallback(
    (id: string) => {
      commit((c) => {
        const { books: kept } = removeBooks(c.books, [id]);
        return kept.length === c.books.length ? c : { ...c, books: kept, bookCount: kept.length };
      });
    },
    [commit],
  );

  const updateBook = useCallback<CollectionContextValue['updateBook']>(
    async (id, patch) => {
      if (!requireOwner()) return null;
      const previous = dataRef.current.books.find((b) => b.id === id);
      if (!previous) return null;
      const seq = (bookRequestSeq.current.get(id) ?? 0) + 1;
      bookRequestSeq.current.set(id, seq);
      commit((c) => ({ ...c, books: c.books.map((b) => (b.id === id ? applyBookPatch(b, patch) : b)) }));
      try {
        const saved = await api.updateBook(id, patch);
        if (bookRequestSeq.current.get(id) === seq) {
          commit((c) => (c.books.some((b) => b.id === id) ? { ...c, books: upsertBook(c.books, saved) } : c));
        }
        return saved;
      } catch (err) {
        if (isApiError(err, 'not_found')) {
          dropBookLocally(id);
          toast({ id: `book-gone-${id}`, title: t('collection.toast.deletedElsewhere'), tone: 'info' });
          return null;
        }
        commit((c) => ({ ...c, books: c.books.map((b) => (b.id === id ? rollbackBookPatch(b, previous, patch) : b)) }));
        toast({
          id: `book-update-failed-${id}`,
          title: t('collection.toast.updateFailed'),
          description: apiErrorMessage(err, t),
          tone: 'error',
          action: isApiError(err, 'forbidden')
            ? undefined
            : { label: t('common.action.retry'), onClick: () => void updateBookRef.current?.(id, patch) },
        });
        handleLostOwnership(err);
        return null;
      }
    },
    [commit, dropBookLocally, handleLostOwnership, requireOwner, toast, t],
  );
  updateBookRef.current = updateBook;

  const deleteBooks = useCallback<CollectionContextValue['deleteBooks']>(
    async (ids) => {
      if (!requireOwner()) return;
      const existing = new Set(dataRef.current.books.map((b) => b.id));
      const unique = [...new Set(ids)].filter((id) => existing.has(id));
      if (unique.length === 0) return;

      let removed: RemovedBook[] = [];
      commit((c) => {
        const result = removeBooks(c.books, unique);
        removed = result.removed;
        return { ...c, books: result.books, bookCount: result.books.length };
      });
      setRawSelection((prev) => {
        if (!unique.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        for (const id of unique) next.delete(id);
        return next;
      });

      const results = await runPool(unique, MUTATION_CONCURRENCY, (id) => api.deleteBook(id));
      const failedIds = new Set<string>();
      let firstError: unknown = null;
      results.forEach((r, i) => {
        if (r.status === 'rejected' && !isApiError(r.reason, 'not_found')) {
          failedIds.add(unique[i]);
          firstError ??= r.reason;
        }
      });
      const deleted = unique.length - failedIds.size;

      if (failedIds.size > 0) {
        const back = removed.filter((r) => failedIds.has(r.book.id));
        commit((c) => {
          const restored = restoreBooks(c.books, back);
          return { ...c, books: restored, bookCount: restored.length };
        });
        toast({
          id: 'books-delete-failed',
          title: tp('collection.toast.deleteFailed', failedIds.size),
          description: apiErrorMessage(firstError, t),
          tone: 'error',
        });
        handleLostOwnership(firstError);
      }
      if (deleted > 0) {
        toast({ id: 'books-deleted', title: tp('collection.toast.deleted', deleted), tone: 'success' });
      }
    },
    [commit, handleLostOwnership, requireOwner, toast, t, tp],
  );

  const addBook = useCallback<CollectionContextValue['addBook']>(
    async (input) => {
      if (!requireOwner()) return null;
      try {
        const created = await api.addBook(collectionId, input);
        commit((c) => {
          const next = upsertBook(c.books, created);
          return { ...c, books: next, bookCount: next.length };
        });
        toast({ title: t('collection.toast.added', { title: created.title }), tone: 'success' });
        return created;
      } catch (err) {
        toast({ id: 'book-add-failed', title: t('collection.toast.addFailed'), description: apiErrorMessage(err, t), tone: 'error' });
        handleLostOwnership(err);
        return null;
      }
    },
    [collectionId, commit, handleLostOwnership, requireOwner, toast, t],
  );

  const mergeBooks = useCallback<CollectionContextValue['mergeBooks']>(
    async (keepId, mergeIds) => {
      if (!requireOwner()) return null;
      const existing = new Set(dataRef.current.books.map((b) => b.id));
      if (!existing.has(keepId)) return null;
      const others = [...new Set(mergeIds)].filter((id) => id !== keepId && existing.has(id));
      if (others.length === 0) return null;

      let removed: RemovedBook[] = [];
      commit((c) => {
        const result = removeBooks(c.books, others);
        removed = result.removed;
        return { ...c, books: result.books, bookCount: result.books.length };
      });
      setRawSelection((prev) => {
        if (!others.some((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        for (const id of others) next.delete(id);
        return next;
      });
      if (openBookRef.current && others.includes(openBookRef.current)) setOpenBookId(keepId);

      try {
        const merged = await api.mergeBooks(collectionId, keepId, others);
        commit((c) => {
          const next = upsertBook(c.books, merged);
          return { ...c, books: next, bookCount: next.length };
        });
        toast({ title: t('collection.toast.merged', { title: merged.title }), tone: 'success' });
        return merged;
      } catch (err) {
        commit((c) => {
          const restored = restoreBooks(c.books, removed);
          return { ...c, books: restored, bookCount: restored.length };
        });
        toast({ id: 'books-merge-failed', title: t('collection.toast.mergeFailed'), description: apiErrorMessage(err, t), tone: 'error' });
        handleLostOwnership(err);
        return null;
      }
    },
    [collectionId, commit, handleLostOwnership, requireOwner, setOpenBookId, toast, t],
  );

  /* ------------------------------------------------------------------ */
  /* unread spines                                                       */
  /* ------------------------------------------------------------------ */

  /** Removes an unread spine from the list, remembering where it was. */
  const takeUnreadSpine = useCallback(
    (id: string): { spine: UnreadSpineDTO; index: number } | null => {
      let taken: { spine: UnreadSpineDTO; index: number } | null = null;
      commit((c) => {
        const list = c.unreadSpines ?? [];
        const index = list.findIndex((s) => s.id === id);
        if (index < 0) return c;
        taken = { spine: list[index], index };
        return { ...c, unreadSpines: [...list.slice(0, index), ...list.slice(index + 1)] };
      });
      return taken;
    },
    [commit],
  );

  const putBackUnreadSpine = useCallback(
    (taken: { spine: UnreadSpineDTO; index: number }) => {
      commit((c) => {
        const list = c.unreadSpines ?? [];
        if (list.some((s) => s.id === taken.spine.id)) return c;
        const next = [...list];
        next.splice(Math.min(taken.index, next.length), 0, taken.spine);
        return { ...c, unreadSpines: next };
      });
    },
    [commit],
  );

  const resolveUnreadSpine = useCallback<CollectionContextValue['resolveUnreadSpine']>(
    async (id, input) => {
      if (!requireOwner()) return null;
      const taken = takeUnreadSpine(id);
      if (!taken) return null;
      try {
        const created = await api.resolveUnreadSpine(collectionId, id, input);
        commit((c) => {
          const next = upsertBook(c.books, created);
          return { ...c, books: next, bookCount: next.length };
        });
        toast({ title: t('collection.toast.added', { title: created.title }), tone: 'success' });
        return created;
      } catch (err) {
        // named or discarded in another tab meanwhile: it stays gone
        if (isApiError(err, 'not_found')) return null;
        putBackUnreadSpine(taken);
        toast({ id: `spine-add-failed-${id}`, title: t('collection.toast.addFailed'), description: apiErrorMessage(err, t), tone: 'error' });
        handleLostOwnership(err);
        return null;
      }
    },
    [collectionId, commit, handleLostOwnership, putBackUnreadSpine, requireOwner, takeUnreadSpine, toast, t],
  );

  const dismissUnreadSpine = useCallback<CollectionContextValue['dismissUnreadSpine']>(
    async (id) => {
      if (!requireOwner()) return false;
      const taken = takeUnreadSpine(id);
      if (!taken) return false;
      try {
        await api.dismissUnreadSpine(collectionId, id);
        return true;
      } catch (err) {
        if (isApiError(err, 'not_found')) return true;
        putBackUnreadSpine(taken);
        toast({
          id: `spine-dismiss-failed-${id}`,
          title: t('collection.toast.spineDismissFailed'),
          description: apiErrorMessage(err, t),
          tone: 'error',
        });
        handleLostOwnership(err);
        return false;
      }
    },
    [collectionId, handleLostOwnership, putBackUnreadSpine, requireOwner, takeUnreadSpine, toast, t],
  );

  const bulkUpdate = useCallback<CollectionShellValue['bulkUpdate']>(
    async (ids, patchOrFn) => {
      if (!requireOwner()) return { ok: 0, failed: 0 };
      const byId = new Map(dataRef.current.books.map((b) => [b.id, b]));
      const jobs: { id: string; patch: BookPatch; previous: BookDTO; seq: number }[] = [];
      for (const id of new Set(ids)) {
        const book = byId.get(id);
        if (!book) continue;
        const patch = typeof patchOrFn === 'function' ? patchOrFn(book) : patchOrFn;
        if (!patch || Object.keys(patch).length === 0) continue;
        const seq = (bookRequestSeq.current.get(id) ?? 0) + 1;
        bookRequestSeq.current.set(id, seq);
        jobs.push({ id, patch, previous: book, seq });
      }
      if (jobs.length === 0) return { ok: 0, failed: 0 };

      const jobById = new Map(jobs.map((j) => [j.id, j]));
      commit((c) => ({
        ...c,
        books: c.books.map((b) => {
          const job = jobById.get(b.id);
          return job ? applyBookPatch(b, job.patch) : b;
        }),
      }));

      const results = await runPool(jobs, MUTATION_CONCURRENCY, (job) => api.updateBook(job.id, job.patch));
      const saved: BookDTO[] = [];
      const failed: typeof jobs = [];
      const gone: string[] = [];
      let firstError: unknown = null;
      results.forEach((r, i) => {
        const job = jobs[i];
        if (r.status === 'fulfilled') {
          if (bookRequestSeq.current.get(job.id) === job.seq) saved.push(r.value);
        } else if (isApiError(r.reason, 'not_found')) {
          gone.push(job.id);
        } else {
          failed.push(job);
          firstError ??= r.reason;
        }
      });

      commit((c) => {
        let next = c.books;
        for (const book of saved) if (next.some((b) => b.id === book.id)) next = upsertBook(next, book);
        if (failed.length) {
          const failedById = new Map(failed.map((j) => [j.id, j]));
          next = next.map((b) => {
            const job = failedById.get(b.id);
            return job ? rollbackBookPatch(b, job.previous, job.patch) : b;
          });
        }
        if (gone.length) next = removeBooks(next, gone).books;
        return next === c.books ? c : { ...c, books: next, bookCount: next.length };
      });

      const ok = jobs.length - failed.length - gone.length;
      if (failed.length) {
        toast({
          id: 'books-bulk-failed',
          title: tp('collection.toast.bulkFailed', failed.length),
          description: apiErrorMessage(firstError, t),
          tone: 'error',
        });
        handleLostOwnership(firstError);
      }
      if (ok > 0) toast({ id: 'books-bulk-updated', title: tp('collection.bulk.updated', ok), tone: 'success' });
      return { ok, failed: failed.length } satisfies BulkResult;
    },
    [commit, handleLostOwnership, requireOwner, toast, t, tp],
  );

  /* ------------------------------------------------------------------ */
  /* collection mutations                                                */
  /* ------------------------------------------------------------------ */

  const restoreCollectionFields = useCallback(
    (previous: CollectionDTO, patch: CollectionPatch) => {
      commit((c) => {
        const next = { ...c };
        if (patch.title !== undefined) next.title = previous.title;
        if (patch.description !== undefined) next.description = previous.description;
        if (patch.ownerName !== undefined) next.ownerName = previous.ownerName;
        if (patch.email !== undefined) next.email = previous.email;
        if (patch.locale !== undefined) next.locale = previous.locale;
        if (patch.visibility !== undefined || patch.pin !== undefined) next.visibility = previous.visibility;
        return next;
      });
    },
    [commit],
  );

  const saveCollection = useCallback<CollectionShellValue['saveCollection']>(
    async (patch) => {
      if (!isOwnerRef.current) throw new ApiClientError(t('errors.forbidden'), 403, 'forbidden');
      const previous = dataRef.current;
      commit((c) => applyCollectionPatch(c, patch));
      try {
        const dto = await api.updateCollection(previous.id, patch);
        commit((c) => mergeCollectionDTO(c, dto));
        return dto;
      } catch (err) {
        restoreCollectionFields(previous, patch);
        handleLostOwnership(err);
        throw err;
      }
    },
    [commit, handleLostOwnership, restoreCollectionFields, t],
  );

  const updateCollection = useCallback<CollectionContextValue['updateCollection']>(
    async (patch) => {
      if (!requireOwner()) return;
      try {
        await saveCollection(patch);
      } catch (err) {
        toast({
          id: 'collection-update-failed',
          title: t('collection.toast.collectionFailed'),
          description: apiErrorMessage(err, t),
          tone: 'error',
        });
      }
    },
    [requireOwner, saveCollection, toast, t],
  );

  const setCollectionEmail = useCallback(
    (email: string | null) => commit((c) => (c.email === email ? c : { ...c, email })),
    [commit],
  );

  /* ------------------------------------------------------------------ */
  /* owner token (this device) & keyboard                                */
  /* ------------------------------------------------------------------ */

  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  useEffect(() => {
    if (!isOwner) {
      setOwnerToken(null);
      return;
    }
    const read = () => setOwnerToken(getOwnerToken(collectionId));
    read();
    window.addEventListener('exl-my-collections', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('exl-my-collections', read);
      window.removeEventListener('storage', read);
    };
  }, [collectionId, isOwner]);

  const focusSearch = useCallback(() => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!document.getElementById(SEARCH_INPUT_ID)) return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);

  /* ------------------------------------------------------------------ */
  /* context values                                                      */
  /* ------------------------------------------------------------------ */

  const value = useMemo<CollectionContextValue>(
    () => ({
      collection,
      books,
      unreadSpines,
      visibleBooks,
      isOwner,
      locale,
      view: effectiveView,
      setView,
      filters,
      setFilters,
      resetFilters,
      activeFilterCount,
      sort,
      setSort,
      openBookId,
      openBook,
      selection,
      toggleSelect,
      setSelection,
      clearSelection,
      updateBook,
      deleteBooks,
      addBook,
      mergeBooks,
      resolveUnreadSpine,
      dismissUnreadSpine,
      updateCollection,
      refresh,
    }),
    [
      collection,
      books,
      unreadSpines,
      visibleBooks,
      isOwner,
      locale,
      effectiveView,
      setView,
      filters,
      setFilters,
      resetFilters,
      activeFilterCount,
      sort,
      setSort,
      openBookId,
      openBook,
      selection,
      toggleSelect,
      setSelection,
      clearSelection,
      updateBook,
      deleteBooks,
      addBook,
      mergeBooks,
      resolveUnreadSpine,
      dismissUnreadSpine,
      updateCollection,
      refresh,
    ],
  );

  const shell = useMemo<CollectionShellValue>(
    () => ({
      appliedQuery,
      facets,
      counts,
      pendingReview: facets.pendingReview,
      unreadSpineCount: isOwner ? unreadSpines.length : 0,
      refreshing,
      ownerToken,
      refreshSilently,
      saveCollection,
      bulkUpdate,
      setCollectionEmail,
      focusSearch,
    }),
    [appliedQuery, facets, counts, isOwner, unreadSpines.length, refreshing, ownerToken, refreshSilently, saveCollection, bulkUpdate, setCollectionEmail, focusSearch],
  );

  return (
    <CollectionContext.Provider value={value}>
      <CollectionShellContext.Provider value={shell}>{children}</CollectionShellContext.Provider>
    </CollectionContext.Provider>
  );
}

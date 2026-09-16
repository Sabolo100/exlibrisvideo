/**
 * URL <-> collection page state (view, sort, filters, open book). Pure – no DOM, no React.
 *
 *   /334345435?view=table&sort=author&q=esterhazy&topic=poetry,history&status=read
 *             &author=Esterházy%20Péter&author=Szabó%20Magda&lang=hu&decade=1960,1970
 *             &review=1&fav=1&lent=1&book=<uuid>
 *
 * Defaults are omitted (view=shelf, sort=shelf, empty filters), so a plain `/<id>` stays clean.
 * Parameters this module does not manage (e.g. `k`, `r`, utm_*) are preserved in place.
 * Author names may contain commas, so authors are repeated parameters; the other list values
 * are comma separated (repeated parameters are accepted too).
 */
import { READING_STATUSES, VIEW_KEYS, type ReadingStatus, type ViewKey } from '@/lib/types';
import { isTopicKey } from '@/lib/taxonomy';
import { EMPTY_FILTERS, type BookFilters, type SortKey } from './context';

export const SORT_KEYS: readonly SortKey[] = ['shelf', 'author', 'title', 'year', 'added', 'rating'];
export const DEFAULT_VIEW: ViewKey = 'shelf';
export const DEFAULT_SORT: SortKey = 'shelf';

/** Query parameter names owned by the collection page. */
export const URL_KEYS = {
  view: 'view',
  sort: 'sort',
  q: 'q',
  topics: 'topic',
  statuses: 'status',
  authors: 'author',
  languages: 'lang',
  decades: 'decade',
  needsReview: 'review',
  favorites: 'fav',
  lent: 'lent',
  book: 'book',
} as const;

const MANAGED = new Set<string>(Object.values(URL_KEYS));

/** Search text longer than this is cut (keeps URLs sane). */
export const MAX_QUERY_LENGTH = 200;
const MAX_LIST_VALUES = 50;
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;
const BOOK_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export interface CollectionUrlState {
  view: ViewKey;
  sort: SortKey;
  filters: BookFilters;
  /** book open in the drawer */
  book: string | null;
}

export const DEFAULT_URL_STATE: CollectionUrlState = {
  view: DEFAULT_VIEW,
  sort: DEFAULT_SORT,
  filters: EMPTY_FILTERS,
  book: null,
};

/** Anything with URLSearchParams' read API (also Next's ReadonlyURLSearchParams). */
export interface SearchParamsLike {
  get(name: string): string | null;
  getAll(name: string): string[];
  forEach(cb: (value: string, key: string) => void): void;
}

export function isViewKey(v: unknown): v is ViewKey {
  return typeof v === 'string' && (VIEW_KEYS as readonly string[]).includes(v);
}

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

function isReadingStatus(v: string): v is ReadingStatus {
  return (READING_STATUSES as readonly string[]).includes(v);
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)].slice(0, MAX_LIST_VALUES);
}

/** Values of a list parameter: repeated params and comma separated values, trimmed, empty dropped. */
function listValues(params: SearchParamsLike, name: string, split: boolean): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(name)) {
    const parts = split ? raw.split(',') : [raw];
    for (const part of parts) {
      const v = part.trim();
      if (v) out.push(v);
    }
  }
  return out;
}

function flag(params: SearchParamsLike, name: string): boolean {
  const v = params.get(name);
  return v !== null && ['1', 'true', 'yes', 'on', ''].includes(v.trim().toLowerCase());
}

/**
 * Reads the page state from query parameters. Invalid values are dropped silently
 * (unknown view/sort → defaults, unknown topic keys / statuses / decades ignored).
 * `review` view is only honoured for owners.
 */
export function parseUrlState(params: SearchParamsLike, opts: { isOwner?: boolean } = {}): CollectionUrlState {
  const rawView = params.get(URL_KEYS.view);
  let view: ViewKey = isViewKey(rawView) ? rawView : DEFAULT_VIEW;
  if (view === 'review' && !opts.isOwner) view = DEFAULT_VIEW;

  const rawSort = params.get(URL_KEYS.sort);
  const sort: SortKey = isSortKey(rawSort) ? rawSort : DEFAULT_SORT;

  const q = (params.get(URL_KEYS.q) ?? '').slice(0, MAX_QUERY_LENGTH);

  const topics = uniq(listValues(params, URL_KEYS.topics, true).filter(isTopicKey));
  const statuses = uniq(listValues(params, URL_KEYS.statuses, true).filter(isReadingStatus));
  const authors = uniq(listValues(params, URL_KEYS.authors, false).map((a) => a.slice(0, 200)));
  const languages = uniq(
    listValues(params, URL_KEYS.languages, true)
      .filter((l) => LANGUAGE_RE.test(l))
      .map((l) => l.toLowerCase()),
  );
  const decades = uniq(
    listValues(params, URL_KEYS.decades, true)
      .filter((d) => /^-?\d{1,4}$/.test(d))
      .map((d) => Number.parseInt(d, 10))
      .filter((d) => Number.isInteger(d) && d % 10 === 0),
  );

  const rawBook = params.get(URL_KEYS.book)?.trim() ?? '';
  const book = BOOK_ID_RE.test(rawBook) ? rawBook : null;

  return {
    view,
    sort,
    filters: {
      q,
      topics,
      statuses,
      authors,
      languages,
      decades,
      needsReview: flag(params, URL_KEYS.needsReview),
      favorites: flag(params, URL_KEYS.favorites),
      lent: flag(params, URL_KEYS.lent),
    },
    book,
  };
}

/**
 * Writes the state into a copy of `current` (unmanaged params keep their position) and returns
 * the query string without "?" (empty string when nothing is left).
 */
export function buildSearch(current: SearchParamsLike | null, state: CollectionUrlState): string {
  const out = new URLSearchParams();
  current?.forEach((value, key) => {
    if (!MANAGED.has(key)) out.append(key, value);
  });

  if (state.view !== DEFAULT_VIEW) out.set(URL_KEYS.view, state.view);
  if (state.sort !== DEFAULT_SORT) out.set(URL_KEYS.sort, state.sort);

  const f = state.filters;
  const q = f.q.trim().slice(0, MAX_QUERY_LENGTH);
  if (q) out.set(URL_KEYS.q, q);
  if (f.topics.length) out.set(URL_KEYS.topics, uniq(f.topics).join(','));
  if (f.statuses.length) out.set(URL_KEYS.statuses, uniq(f.statuses).join(','));
  for (const a of uniq(f.authors)) out.append(URL_KEYS.authors, a);
  if (f.languages.length) out.set(URL_KEYS.languages, uniq(f.languages).join(','));
  if (f.decades.length) out.set(URL_KEYS.decades, uniq([...f.decades].sort((a, b) => a - b)).join(','));
  if (f.needsReview) out.set(URL_KEYS.needsReview, '1');
  if (f.favorites) out.set(URL_KEYS.favorites, '1');
  if (f.lent) out.set(URL_KEYS.lent, '1');
  if (state.book) out.set(URL_KEYS.book, state.book);

  return out.toString();
}

/** Removes the given parameters (e.g. `k`, `r` after claiming) and returns the query string without "?". */
export function withoutParams(current: SearchParamsLike, names: readonly string[]): string {
  const drop = new Set(names);
  const out = new URLSearchParams();
  current.forEach((value, key) => {
    if (!drop.has(key)) out.append(key, value);
  });
  return out.toString();
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** Value equality of two filter objects (list order matters – it is the order the user picked). */
export function filtersEqual(a: BookFilters, b: BookFilters): boolean {
  return (
    a.q === b.q &&
    a.needsReview === b.needsReview &&
    a.favorites === b.favorites &&
    a.lent === b.lent &&
    sameList(a.topics, b.topics) &&
    sameList(a.statuses, b.statuses) &&
    sameList(a.authors, b.authors) &&
    sameList(a.languages, b.languages) &&
    sameList(a.decades, b.decades)
  );
}

/** Canonical string of the managed part only – equal strings mean equal page state. */
export function stateKey(state: CollectionUrlState): string {
  return buildSearch(null, state);
}

/** Canonical managed-state key of a query string (unmanaged params ignored). */
export function searchStateKey(params: SearchParamsLike, opts: { isOwner?: boolean } = {}): string {
  return stateKey(parseUrlState(params, opts));
}

/** Path + "?" + query (no "?" for an empty query). */
export function hrefWithSearch(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

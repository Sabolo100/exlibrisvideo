/**
 * Pure helpers behind the optimistic mutations of CollectionProvider (apply, roll back, restore,
 * bounded concurrency). No React – unit-tested in mutations.test.ts.
 */
import type { BookDTO, BookPatch, CollectionDTO, CollectionPatch, CollectionWithBooksDTO } from '@/lib/types';

/** BookPatch keys that exist on BookDTO (every key of BookPatch does). */
type PatchKey = keyof BookPatch & keyof BookDTO;

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return false;
}

/** The keys actually present in a patch (undefined values are "not sent"). */
export function patchKeys(patch: BookPatch): PatchKey[] {
  return (Object.keys(patch) as PatchKey[]).filter((k) => patch[k] !== undefined);
}

/** Optimistic view of a book after a patch. */
export function applyBookPatch(book: BookDTO, patch: BookPatch): BookDTO {
  const next: BookDTO = { ...book };
  const target = next as unknown as Record<string, unknown>;
  for (const key of patchKeys(patch)) {
    const value = patch[key];
    target[key] = Array.isArray(value) ? [...value] : value;
  }
  return next;
}

/**
 * Rolls back the fields of `patch` on `current` to their values in `previous` – but only fields that
 * still hold the optimistic value (a newer edit of the same field wins).
 */
export function rollbackBookPatch(current: BookDTO, previous: BookDTO, patch: BookPatch): BookDTO {
  const next: BookDTO = { ...current };
  const target = next as unknown as Record<string, unknown>;
  for (const key of patchKeys(patch)) {
    if (sameValue(current[key], patch[key])) target[key] = previous[key];
  }
  return next;
}

/** Replaces the book with the same id (keeps position) or appends it. */
export function upsertBook(books: readonly BookDTO[], book: BookDTO): BookDTO[] {
  const idx = books.findIndex((b) => b.id === book.id);
  if (idx < 0) return [...books, book];
  const next = [...books];
  next[idx] = book;
  return next;
}

export interface RemovedBook {
  book: BookDTO;
  index: number;
}

/** Removes books by id, remembering where they were. */
export function removeBooks(books: readonly BookDTO[], ids: Iterable<string>): { books: BookDTO[]; removed: RemovedBook[] } {
  const drop = new Set(ids);
  const kept: BookDTO[] = [];
  const removed: RemovedBook[] = [];
  books.forEach((book, index) => {
    if (drop.has(book.id)) removed.push({ book, index });
    else kept.push(book);
  });
  return { books: kept, removed };
}

/** Puts removed books back at their original positions (books that reappeared meanwhile are skipped). */
export function restoreBooks(books: readonly BookDTO[], removed: readonly RemovedBook[]): BookDTO[] {
  const present = new Set(books.map((b) => b.id));
  const next = [...books];
  for (const { book, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (present.has(book.id)) continue;
    next.splice(Math.min(index, next.length), 0, book);
    present.add(book.id);
  }
  return next;
}

/** CollectionPatch fields that are visible on the DTO (the PIN never is). */
export function applyCollectionPatch<C extends CollectionDTO>(collection: C, patch: CollectionPatch): C {
  const next = { ...collection };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.ownerName !== undefined) next.ownerName = patch.ownerName;
  if (patch.email !== undefined) next.email = patch.email;
  if (patch.locale !== undefined) next.locale = patch.locale;
  if (patch.visibility !== undefined) next.visibility = patch.visibility;
  else if (patch.pin === null) next.visibility = 'link';
  else if (typeof patch.pin === 'string' && patch.pin !== '') next.visibility = 'pin';
  return next;
}

/**
 * Deep equality of two API payloads of the same collection. Both come from the same DTO builders, so
 * key order is stable and a JSON comparison is exact (and fast enough for thousands of books).
 */
export function sameCollectionData(a: CollectionWithBooksDTO, b: CollectionWithBooksDTO): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.books.length !== b.books.length || a.updatedAt !== b.updatedAt || a.isOwner !== b.isOwner) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Merges a CollectionDTO answer (no books) into the with-books state, keeping the books array. */
export function mergeCollectionDTO(state: CollectionWithBooksDTO, dto: CollectionDTO): CollectionWithBooksDTO {
  return { ...state, ...dto, books: state.books, bookCount: state.books.length };
}

/**
 * Runs `fn` over `items` with at most `limit` in flight; results keep the input order.
 * Never rejects – every item yields a PromiseSettledResult.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** Keeps only ids that still exist. Returns the same Set instance when nothing changed. */
export function pruneSelection(selection: ReadonlySet<string>, books: readonly BookDTO[]): ReadonlySet<string> {
  if (selection.size === 0) return selection;
  const ids = new Set(books.map((b) => b.id));
  let changed = false;
  const next = new Set<string>();
  for (const id of selection) {
    if (ids.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selection;
}

/** Patch that makes `key` the main topic without listing it twice among the secondary topics. */
export function mainTopicPatch(book: Pick<BookDTO, 'category' | 'topics'>, key: string): BookPatch | null {
  const topics = (book.topics ?? []).filter((topic) => topic !== key);
  const topicsChanged = topics.length !== (book.topics ?? []).length;
  if (book.category === key && !topicsChanged) return null;
  return topicsChanged ? { category: key, topics } : { category: key };
}

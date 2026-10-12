/**
 * Collections remembered in this browser (localStorage "exl_my_collections"). Client-only.
 * Every access is wrapped: storage can be unavailable (private mode, blocked site data).
 */
export interface MyCollectionEntry {
  id: string;
  /** raw owner token (lets this device re-claim ownership); null when only visited */
  token: string | null;
  title: string | null;
  bookCount?: number;
  createdAt: string;
  lastOpenedAt: string;
}

const KEY = 'exl_my_collections';

export function listMyCollections(): MyCollectionEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as MyCollectionEntry[]) : [];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)) : [];
  } catch {
    return [];
  }
}

function save(entries: MyCollectionEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
    window.dispatchEvent(new Event('exl-my-collections'));
  } catch {
    /* storage unavailable */
  }
}

/** Insert or merge (a known token is never overwritten with null). */
export function rememberCollection(entry: Partial<MyCollectionEntry> & { id: string }): void {
  const now = new Date().toISOString();
  const all = listMyCollections();
  const existing = all.find((e) => e.id === entry.id);
  if (existing) {
    Object.assign(existing, {
      ...entry,
      token: entry.token ?? existing.token,
      title: entry.title ?? existing.title,
      lastOpenedAt: now,
    });
  } else {
    all.push({
      id: entry.id,
      token: entry.token ?? null,
      title: entry.title ?? null,
      bookCount: entry.bookCount,
      createdAt: entry.createdAt ?? now,
      lastOpenedAt: now,
    });
  }
  save(all);
}

export function forgetCollection(id: string): void {
  save(listMyCollections().filter((e) => e.id !== id));
}

/** A catalogue made on this device is a candidate for "my filmed shelf" for this long. */
const GUEST_CLAIM_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/**
 * The link-only catalogue this device made most recently (an owner token is remembered): what a visitor who
 * signs in after filming as a guest most likely wants in their new library. The server decides whether it can
 * really be adopted (owner cookie, not yet an account's library, the account has no library yet).
 */
export function latestOwnedGuestId(now = Date.now()): string | null {
  const own = listMyCollections().find((e) => e.token && now - Date.parse(e.createdAt) <= GUEST_CLAIM_MAX_AGE_MS);
  return own?.id ?? null;
}

export function getOwnerToken(id: string): string | null {
  return listMyCollections().find((e) => e.id === id)?.token ?? null;
}

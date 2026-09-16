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

export function getOwnerToken(id: string): string | null {
  return listMyCollections().find((e) => e.id === id)?.token ?? null;
}

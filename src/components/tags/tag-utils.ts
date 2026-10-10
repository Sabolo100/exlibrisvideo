/**
 * Owner's tags on the client: case-insensitive identity, adding / removing, and the tags a library already
 * uses (most used first) – offered when a new recording or book is tagged. Pure.
 */
import type { BookDTO, VideoDTO } from '@/lib/types';

/** server limits (src/lib/collections/validation.ts LIMITS) */
export const MAX_TAGS = 30;
export const MAX_TAG_LENGTH = 60;

const fold = (tag: string) => tag.trim().toLocaleLowerCase('hu');

export function sameTag(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

/** `tags` plus `tag` (trimmed, inner whitespace collapsed); the same array when nothing changes. */
export function addTag(tags: readonly string[], tag: string): string[] {
  const clean = tag.replace(/\s+/g, ' ').trim().replace(/^#+/, '').slice(0, MAX_TAG_LENGTH);
  if (!clean || tags.length >= MAX_TAGS || tags.some((t) => sameTag(t, clean))) return tags as string[];
  return [...tags, clean];
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => !sameTag(t, tag));
}

/** Every tag of the library with the number of books carrying it, most used first (then A–Z). */
export function libraryTags(
  books: readonly Pick<BookDTO, 'tags'>[],
  videos: readonly Pick<VideoDTO, 'tags'>[] = [],
): { tag: string; count: number }[] {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const b of books) {
    for (const tag of new Set(b.tags ?? [])) {
      const k = fold(tag);
      const e = byKey.get(k);
      if (e) e.count += 1;
      else byKey.set(k, { tag, count: 1 });
    }
  }
  for (const v of videos) for (const tag of v.tags ?? []) if (!byKey.has(fold(tag))) byKey.set(fold(tag), { tag, count: 0 });
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'hu'));
}

/** Tag names for a TagPicker's suggestions. */
export function tagSuggestions(books: readonly Pick<BookDTO, 'tags'>[], videos: readonly Pick<VideoDTO, 'tags'>[] = []): string[] {
  return libraryTags(books, videos).map((e) => e.tag);
}

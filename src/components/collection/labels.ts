/**
 * Display labels of the collection shell (titles, owner line, decades, sources). Pure – no React,
 * usable from Server Components (metadata, OG image) and client components alike.
 */
import type { MessageKey, Vars } from '@/i18n';
import type { BookDTO, Locale, VideoDTO } from '@/lib/types';

type T = (key: MessageKey, vars?: Vars) => string;
type TP = (key: MessageKey, count: number, vars?: Vars) => string;

export interface TitleSource {
  id: string;
  title: string | null;
  ownerName: string | null;
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** "Kovács Anna könyvtára" / "Anna Smith’s library", or null without an owner name. */
export function ownerLibraryLabel(ownerName: string | null | undefined, t: T): string | null {
  const name = clean(ownerName);
  return name ? t('collection.title.ownerLibrary', { name }) : null;
}

/** Title shown for a collection: its title, else "<owner>’s library", else "Library #<id>". */
export function collectionTitle(c: TitleSource, t: T): string {
  return clean(c.title) || ownerLibraryLabel(c.ownerName, t) || t('collection.title.fallback', { id: c.id });
}

/** Owner line under the title – null when there is no owner name or the title already says it. */
export function ownerLine(c: TitleSource, t: T): string | null {
  const line = ownerLibraryLabel(c.ownerName, t);
  if (!line) return null;
  return collectionTitle(c, t) === line ? null : line;
}

/**
 * Hungarian suffix of a decade ("1960-as", "1970-es", "1900-as", "2000-es"): vowel harmony follows
 * the last spoken number word – tíz/negyven/ötven/hetven/kilencven/ezer take -es, the rest -as.
 */
export function hungarianDecadeSuffix(decade: number): 'as' | 'es' {
  const d = Math.abs(Math.trunc(decade));
  const tens = Math.floor(d / 10) % 10;
  if (tens !== 0) return [1, 4, 5, 7, 9].includes(tens) ? 'es' : 'as';
  const hundreds = Math.floor(d / 100) % 10;
  if (hundreds !== 0) return 'as'; // száz
  if (d >= 1000) return 'es'; // ezer
  return 'as'; // nullás
}

/** "1960-as évek" / "1960s". */
export function decadeLabel(decade: number, locale: Locale, t: T): string {
  const suffix = locale === 'hu' ? hungarianDecadeSuffix(decade) : 'as';
  return t(suffix === 'as' ? 'collection.filter.decade.as' : 'collection.filter.decade.es', { decade });
}

/** Uploaded source counts (failed / unfinished uploads are not sources). */
export function sourceCounts(videos: readonly Pick<VideoDTO, 'kind' | 'uploadStatus'>[]): { videos: number; photos: number } {
  let v = 0;
  let ph = 0;
  for (const s of videos) {
    if (s.uploadStatus !== 'uploaded') continue;
    if (s.kind === 'image') ph += 1;
    else v += 1;
  }
  return { videos: v, photos: ph };
}

/** "3 videóból és 2 fotóból" / "from 3 videos and 2 photos" / null when there are no sources. */
export function sourcesLabel(videos: readonly Pick<VideoDTO, 'kind' | 'uploadStatus'>[], t: T, tp: TP): string | null {
  const { videos: v, photos } = sourceCounts(videos);
  const parts: string[] = [];
  if (v > 0) parts.push(tp('collection.header.videos', v));
  if (photos > 0) parts.push(tp('collection.header.photos', photos));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  // English: "from 3 videos and from 2 photos" reads badly – drop the second "from"
  const second = parts[1].replace(/^from\s+/i, '');
  return t('collection.header.sourcesAnd', { a: parts[0], b: second });
}

/** File-name friendly slug for downloads (QR PNG). */
export function downloadName(prefix: string, id: string, ext: string): string {
  return `${prefix}-${id}.${ext}`;
}

/** A title in the typographic quotes of the locale: „Abigél” / “Dune”. */
export function quoteTitle(title: string, locale: Locale): string {
  return locale === 'hu' ? `„${title}”` : `“${title}”`;
}

/** Up to `max` titles for the delete confirmation, "…" appended when there are more. */
export function titleSample(books: readonly Pick<BookDTO, 'title'>[], locale: Locale, max = 3): string {
  const titles = books.slice(0, max).map((b) => quoteTitle(b.title, locale));
  return books.length > max ? `${titles.join(', ')} …` : titles.join(', ');
}

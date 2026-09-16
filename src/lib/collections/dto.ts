/**
 * Row → DTO mappers (dates → ISO strings, storage paths → /api/media URLs, owner-only fields nulled).
 * Owner: api. Pure functions (no DB access).
 */
import type { BookRow, CollectionRow, FrameRow, UnreadSpineRow, VideoRow } from '@/db/schema';
import { publicCollectionUrl } from '@/lib/env';
import { mediaUrl } from '@/lib/storage';
import {
  READING_STATUSES,
  UNREAD_SPINE_REASONS,
  VIDEO_STAGES,
  type BBox,
  type BookDTO,
  type BookSource,
  type CollectionDTO,
  type CollectionStatus,
  type FrameDTO,
  type Locale,
  type ReadingStatus,
  type SourceKind,
  type UnreadSpineDTO,
  type UploadStatus,
  type VideoDTO,
  type VideoStage,
  type VideoStatus,
  type Visibility,
} from '@/lib/types';

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const isoRequired = (d: Date | string): string => iso(d) ?? new Date(0).toISOString();

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Validated BBox from a jsonb value, or null. */
export function toBBox(v: unknown): BBox | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const nums = [b.x0, b.y0, b.x1, b.y1];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number };
}

/** Only http(s) URLs may reach an <img src>. */
function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function clampProgress(p: number | null | undefined): number {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

const BOOK_SOURCES: BookSource[] = ['video', 'image', 'manual'];
const VIDEO_STATUSES: VideoStatus[] = ['pending', 'queued', 'processing', 'done', 'error'];
const UPLOAD_STATUSES: UploadStatus[] = ['uploading', 'uploaded', 'failed'];
const COLLECTION_STATUSES: CollectionStatus[] = ['draft', 'processing', 'ready', 'error'];

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** How enrichment found the cover ('title' | 'original_title' | 'isbn' ...), or null. */
function coverVia(enrichment: unknown): string | null {
  if (!enrichment || typeof enrichment !== 'object') return null;
  const cover = (enrichment as Record<string, unknown>).cover;
  if (!cover || typeof cover !== 'object') return null;
  const via = (cover as Record<string, unknown>).via;
  return typeof via === 'string' ? via : null;
}

export function toBookDTO(row: BookRow, opts: { isOwner: boolean }): BookDTO {
  const owner = opts.isOwner;
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    spineAuthor: row.spineAuthor,
    spineTitle: row.spineTitle,
    authorSort: row.authorSort,
    titleSort: row.titleSort,
    originalTitle: row.originalTitle,
    series: row.series,
    publisher: row.publisher,
    language: row.language,
    originalLanguage: row.originalLanguage,
    authorCountry: row.authorCountry,
    firstPublishedYear: row.firstPublishedYear,
    editionYear: row.editionYear,
    isbn: row.isbn,
    pageCount: row.pageCount,
    category: row.category,
    topics: stringArray(row.topics),
    tags: stringArray(row.tags),
    descriptionHu: row.descriptionHu,
    descriptionEn: row.descriptionEn,
    coverImage: mediaUrl(row.coverPath) ?? safeExternalUrl(row.coverUrl) ?? null,
    coverFromOriginalEdition: coverVia(row.enrichment) === 'original_title',
    spineImage: mediaUrl(row.spinePath),
    spineColor: row.spineColor,
    source: oneOf(row.source, BOOK_SOURCES, 'video'),
    confidence: typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : 0,
    needsReview: row.needsReview,
    reviewed: row.reviewed,
    bestFrameId: row.bestFrameId,
    bestBbox: toBBox(row.bestBbox),
    firstVideoId: row.firstVideoId,
    firstTimeSec: row.firstTimeSec,
    shelfPosition: row.shelfPosition,
    detectionCount: row.detectionCount,
    readingStatus: oneOf<ReadingStatus>(row.readingStatus, READING_STATUSES, 'unknown'),
    rating: row.rating,
    favorite: row.favorite,
    notes: owner ? row.notes : null,
    lentTo: owner ? row.lentTo : null,
    lentAt: owner ? row.lentAt : null,
    enriched: !!row.enrichedAt,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toVideoDTO(row: VideoRow): VideoDTO {
  return {
    id: row.id,
    kind: oneOf<SourceKind>(row.kind, ['video', 'image'], 'video'),
    sortOrder: row.sortOrder,
    originalFilename: row.originalFilename,
    sizeBytes: Number(row.sizeBytes),
    uploadStatus: oneOf(row.uploadStatus, UPLOAD_STATUSES, 'uploading'),
    status: oneOf(row.status, VIDEO_STATUSES, 'pending'),
    stage: row.stage ? oneOf<VideoStage>(row.stage, VIDEO_STAGES, 'probe') : null,
    progress: clampProgress(row.progress),
    durationSec: row.durationSec,
    framesTotal: row.framesTotal,
    framesAnalyzed: row.framesAnalyzed,
    booksFound: row.booksFound,
    error: row.error,
    createdAt: isoRequired(row.createdAt),
    processedAt: iso(row.processedAt),
  };
}

export function toFrameDTO(row: FrameRow): FrameDTO {
  return {
    id: row.id,
    videoId: row.videoId,
    idx: row.idx,
    timeSec: row.timeSec,
    width: row.width,
    height: row.height,
    image: mediaUrl(row.storagePath) ?? '',
    thumb: mediaUrl(row.thumbPath),
  };
}

/** Owner only: a spine that could not be read (the owner names the book or discards it). */
export function toUnreadSpineDTO(row: UnreadSpineRow): UnreadSpineDTO {
  return {
    id: row.id,
    videoId: row.videoId,
    frameId: row.frameId,
    bbox: toBBox(row.bbox),
    spineImage: mediaUrl(row.spinePath),
    spineColor: row.spineColor,
    reason: oneOf(row.reason, UNREAD_SPINE_REASONS, 'illegible'),
    guessAuthor: row.guessAuthor,
    guessTitle: row.guessTitle,
  };
}

/** Videos in upload order (sortOrder, then creation time). */
export function sortVideos<T extends Pick<VideoRow, 'sortOrder' | 'createdAt'>>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function toCollectionDTO(
  row: CollectionRow,
  extra: { isOwner: boolean; bookCount: number; videos: VideoRow[] },
): CollectionDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ownerName: row.ownerName,
    locale: oneOf<Locale>(row.locale, ['hu', 'en'], 'hu'),
    visibility: oneOf<Visibility>(row.visibility, ['link', 'pin'], 'link'),
    status: oneOf(row.status, COLLECTION_STATUSES, 'draft'),
    isOwner: extra.isOwner,
    email: extra.isOwner ? row.email : null,
    publicUrl: publicCollectionUrl(row.id),
    bookCount: extra.bookCount,
    videos: sortVideos(extra.videos).map(toVideoDTO),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    emailSentAt: iso(row.emailSentAt),
  };
}

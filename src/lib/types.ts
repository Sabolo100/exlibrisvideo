/**
 * Shared domain types – the contract between DB, worker, API and UI.
 * Keep this file dependency-free (imported by both server and client code).
 */

export type Locale = 'hu' | 'en';

export type Visibility = 'link' | 'pin';
export type CollectionStatus = 'draft' | 'processing' | 'ready' | 'error';

export type SourceKind = 'video' | 'image';
export type UploadStatus = 'uploading' | 'uploaded' | 'failed';
export type VideoStatus = 'pending' | 'queued' | 'processing' | 'done' | 'error';
/** processing stages of one source, in order */
export type VideoStage = 'probe' | 'frames' | 'vision' | 'merge' | 'crops' | 'enrich' | 'done';
export const VIDEO_STAGES: VideoStage[] = ['probe', 'frames', 'vision', 'merge', 'crops', 'enrich', 'done'];

export type BookSource = 'video' | 'image' | 'manual';
export type ReadingStatus = 'unknown' | 'read' | 'reading' | 'to_read' | 'abandoned';
export const READING_STATUSES: ReadingStatus[] = ['unknown', 'read', 'reading', 'to_read', 'abandoned'];

export type JobType = 'process_video' | 'enrich_collection' | 'finalize_collection' | 'send_email' | 'cleanup';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type EmailKind = 'collection_ready' | 'export' | 'recover_links';

export type ExportFormat = 'xlsx' | 'csv' | 'json' | 'pdf' | 'goodreads';
export const EXPORT_FORMATS: ExportFormat[] = ['xlsx', 'csv', 'json', 'pdf', 'goodreads'];

export type ViewKey = 'shelf' | 'covers' | 'table' | 'authors' | 'topics' | 'timeline' | 'stats' | 'frames' | 'review';
export const VIEW_KEYS: ViewKey[] = ['shelf', 'covers', 'table', 'authors', 'topics', 'timeline', 'stats', 'frames', 'review'];

export type AiProviderName = 'anthropic' | 'deepseek' | 'mock';

/** Pixel bounding box in the coordinate space of the analysed frame (frames.width × frames.height). */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * The exact, possibly tilted spine rectangle (spine recognition only). x0..y1 is its axis-aligned
   * bounding box; crops use `rect` to cut the spine upright without its neighbours.
   */
  rect?: RotatedRect;
}

/** A rectangle rotated around its centre: `deg` > 0 turns its vertical axis like "\" (top to the left). */
export interface RotatedRect {
  cx: number;
  cy: number;
  /** across the spine */
  width: number;
  /** along the spine */
  height: number;
  deg: number;
}

export interface UsageTotals {
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd?: number;
  byModel?: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
}

/* ------------------------------------------------------------------ */
/* API DTOs (JSON over the wire). Dates are ISO strings.               */
/* ------------------------------------------------------------------ */

export interface BookDTO {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  spineAuthor: string | null;
  spineTitle: string | null;
  authorSort: string | null;
  titleSort: string | null;
  originalTitle: string | null;
  series: string | null;
  publisher: string | null;
  language: string | null;
  originalLanguage: string | null;
  authorCountry: string | null;
  firstPublishedYear: number | null;
  editionYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  category: string | null;
  topics: string[];
  tags: string[];
  descriptionHu: string | null;
  descriptionEn: string | null;
  /** best available cover image URL (local /api/media/... preferred, else external) or null */
  coverImage: string | null;
  /** the cover belongs to the original-language edition, not to this (translated) one */
  coverFromOriginalEdition: boolean;
  /** /api/media/... URL of the cropped spine photo or null */
  spineImage: string | null;
  spineColor: string | null;
  source: BookSource;
  confidence: number;
  needsReview: boolean;
  reviewed: boolean;
  bestFrameId: string | null;
  bestBbox: BBox | null;
  firstVideoId: string | null;
  firstTimeSec: number | null;
  shelfPosition: number;
  detectionCount: number;
  readingStatus: ReadingStatus;
  rating: number | null;
  favorite: boolean;
  /** owner-only fields are null for non-owners */
  notes: string | null;
  lentTo: string | null;
  lentAt: string | null;
  enriched: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VideoDTO {
  id: string;
  kind: SourceKind;
  sortOrder: number;
  originalFilename: string;
  sizeBytes: number;
  uploadStatus: UploadStatus;
  status: VideoStatus;
  stage: VideoStage | null;
  progress: number;
  durationSec: number | null;
  framesTotal: number;
  framesAnalyzed: number;
  booksFound: number;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface FrameDTO {
  id: string;
  videoId: string;
  idx: number;
  timeSec: number;
  width: number;
  height: number;
  /** /api/media/... */
  image: string;
  thumb: string | null;
}

export interface CollectionDTO {
  id: string;
  title: string | null;
  description: string | null;
  ownerName: string | null;
  locale: Locale;
  visibility: Visibility;
  status: CollectionStatus;
  /** true when the current request carries a valid owner cookie */
  isOwner: boolean;
  /** only for the owner */
  email: string | null;
  publicUrl: string;
  bookCount: number;
  videos: VideoDTO[];
  createdAt: string;
  updatedAt: string;
  emailSentAt: string | null;
}

export interface CollectionWithBooksDTO extends CollectionDTO {
  books: BookDTO[];
}

export interface CollectionStatusDTO {
  id: string;
  status: CollectionStatus;
  /** overall 0..100 across all sources */
  progress: number;
  bookCount: number;
  videos: VideoDTO[];
  updatedAt: string;
}

export interface CreateCollectionResponse {
  id: string;
  ownerToken: string;
  publicUrl: string;
  /** publicUrl + "?k=<ownerToken>" – lets the owner edit from any device */
  ownerUrl: string;
}

export interface InitUploadResponse {
  videoId: string;
  chunkSize: number;
  bytesReceived: number;
}

export interface ApiError {
  error: string;
  /** machine readable code, e.g. 'not_found', 'forbidden', 'needs_pin', 'rate_limited', 'too_large', 'invalid' */
  code: string;
  details?: unknown;
}

/** Editable fields accepted by PATCH /api/books/:id (owner) */
export interface BookPatch {
  title?: string;
  subtitle?: string | null;
  author?: string | null;
  originalTitle?: string | null;
  series?: string | null;
  publisher?: string | null;
  language?: string | null;
  firstPublishedYear?: number | null;
  editionYear?: number | null;
  isbn?: string | null;
  pageCount?: number | null;
  category?: string | null;
  topics?: string[];
  tags?: string[];
  readingStatus?: ReadingStatus;
  rating?: number | null;
  favorite?: boolean;
  notes?: string | null;
  lentTo?: string | null;
  lentAt?: string | null;
  reviewed?: boolean;
  needsReview?: boolean;
}

export interface CollectionPatch {
  title?: string | null;
  description?: string | null;
  ownerName?: string | null;
  email?: string | null;
  locale?: Locale;
  visibility?: Visibility;
  /** required when switching to visibility 'pin' (4–8 digits) */
  pin?: string | null;
}

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
  /** physical copies the owner has (≥ 1) */
  copies: number;
  /**
   * The catalogue already had this book when a later recording / photo found it again elsewhere: the owner
   * decides (review) whether it is the same book, another copy, or a different book. Owner only (null otherwise).
   */
  duplicateOfId: string | null;
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
  /** owner's tags for this recording; the books found in it carry them too */
  tags: string[];
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
  /** true when the current request carries a valid owner cookie (or the owner's sign-in) */
  isOwner: boolean;
  /** the library of a signed-in user (Google account) rather than a link-only catalogue */
  isAccountLibrary: boolean;
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
  /** owner only (absent for visitors): spines of the recordings that could not be read, in shelf order */
  unreadSpines?: UnreadSpineDTO[];
}

/**
 * Why a spine is waiting for the owner: nothing legible on it, a guess that an independent second look
 * could not confirm, or the reading request itself failed.
 */
export type UnreadSpineReason = 'illegible' | 'unconfirmed' | 'unread';
export const UNREAD_SPINE_REASONS: UnreadSpineReason[] = ['illegible', 'unconfirmed', 'unread'];

/** A spine found in a recording that could not be turned into a book: the owner names it or discards it. */
export interface UnreadSpineDTO {
  id: string;
  videoId: string;
  /** the frame the photo was cut from (with `bbox`, in its pixels) */
  frameId: string | null;
  bbox: BBox | null;
  /** /api/media/... URL of the upright spine photo */
  spineImage: string | null;
  spineColor: string | null;
  reason: UnreadSpineReason;
  /** what could still be made out: an author without a title, or the unconfirmed first reading */
  guessAuthor: string | null;
  guessTitle: string | null;
}

/** POST /api/collections/:id/unread-spines/:spineId – the book the owner recognised on the spine. */
export interface ResolveUnreadSpineInput {
  title: string;
  author?: string | null;
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
  copies?: number;
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

/** The signed-in user (Google account) as the UI sees it. */
export interface SessionUserDTO {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  /** id of the user's library (created at the first sign-in) */
  libraryId: string | null;
}

/**
 * POST /api/books/:bookId/duplicate – the owner's answer to "this book was already in the catalogue":
 * `same` merges it into the earlier book, `copy` merges it and counts one more copy, `different` keeps both.
 */
export type DuplicateResolution = 'same' | 'copy' | 'different';

/** What a single-book photo shows: the spine, the front cover, or the ISBN barcode on the back. */
export type BookPhotoKind = 'spine' | 'cover' | 'isbn';

/** A book identified from a photo (fields the owner confirms or corrects before adding it). */
export interface IdentifiedBookDTO {
  title: string;
  subtitle: string | null;
  author: string | null;
  publisher: string | null;
  /** valid ISBN-13 or null */
  isbn: string | null;
  editionYear: number | null;
  pageCount: number | null;
  language: string | null;
  /** cover of the ISBN's edition (Google Books / Open Library), shown in the confirmation */
  coverUrl: string | null;
  /** 0..1 (1 when the ISBN was found in a book database) */
  confidence: number;
}

/** POST /api/collections/:id/identify-photo */
export interface IdentifyBookResponse {
  /** a title or an author could be told */
  found: boolean;
  /** how: the barcode, the AI reading the photo, or only the ISBN database */
  via: 'barcode' | 'ai' | 'lookup' | 'none';
  candidate: IdentifiedBookDTO;
  /** keeps the spine / cover photo for the new book (send it back with the book) */
  photoToken: string | null;
  /** the photo does not show a book */
  notBook: boolean;
  /** the ISBN is valid but no book database knows it */
  isbnUnknown: boolean;
  /** books of the library that look the same – another copy? */
  similar: { id: string; title: string; author: string | null; copies: number }[];
}

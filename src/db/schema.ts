/**
 * Ex Libris Video – database schema (PostgreSQL 16, Drizzle ORM).
 *
 * Contract file: every module reads/writes through these tables. Change it only
 * together with a new migration (`npm run db:generate`).
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  bigint,
} from 'drizzle-orm/pg-core';
import type {
  BBox,
  BookSource,
  CollectionStatus,
  EmailKind,
  JobStatus,
  JobType,
  ReadingStatus,
  SourceKind,
  UploadStatus,
  UsageTotals,
  VideoStage,
  VideoStatus,
  Visibility,
} from '@/lib/types';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A user's library. Public id is a 9-digit number used in the URL: exlibrisvideo.hu/334345435 */
export const collections = pgTable(
  'collections',
  {
    id: varchar('id', { length: 12 }).primaryKey(),
    /** sha256(ownerToken) hex – the raw token is only ever shown to the owner (link + email). */
    ownerTokenHash: text('owner_token_hash').notNull(),
    title: text('title'),
    description: text('description'),
    ownerName: text('owner_name'),
    email: text('email'),
    /** UI/email language chosen at creation: 'hu' | 'en' */
    locale: varchar('locale', { length: 5 }).notNull().default('hu'),
    visibility: varchar('visibility', { length: 16 }).$type<Visibility>().notNull().default('link'),
    /** scrypt hash "salt:hash" when visibility = 'pin' */
    pinHash: text('pin_hash'),
    status: varchar('status', { length: 16 }).$type<CollectionStatus>().notNull().default('draft'),
    /** accumulated AI usage for cost tracking */
    usage: jsonb('usage').$type<UsageTotals>().notNull().default(sql`'{}'::jsonb`),
    viewCount: integer('view_count').notNull().default(0),
    emailSentAt: ts('email_sent_at'),
    lastViewedAt: ts('last_viewed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collections_email_idx').on(t.email), index('collections_created_idx').on(t.createdAt)],
);

/** An uploaded source: a shelf video (or a still photo). One collection can have many. */
export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: varchar('collection_id', { length: 12 })
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 8 }).$type<SourceKind>().notNull().default('video'),
    /** order the user added the sources in (shelf order across videos) */
    sortOrder: integer('sort_order').notNull().default(0),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    bytesReceived: bigint('bytes_received', { mode: 'number' }).notNull().default(0),
    uploadStatus: varchar('upload_status', { length: 16 }).$type<UploadStatus>().notNull().default('uploading'),
    /** path relative to STORAGE_DIR; null after the source file was deleted (retention) */
    storagePath: text('storage_path'),
    status: varchar('status', { length: 16 }).$type<VideoStatus>().notNull().default('pending'),
    stage: varchar('stage', { length: 16 }).$type<VideoStage>(),
    /** 0..100 progress of the current processing run */
    progress: smallint('progress').notNull().default(0),
    durationSec: real('duration_sec'),
    width: integer('width'),
    height: integer('height'),
    framesTotal: integer('frames_total').notNull().default(0),
    framesAnalyzed: integer('frames_analyzed').notNull().default(0),
    booksFound: integer('books_found').notNull().default(0),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
    sourceDeletedAt: ts('source_deleted_at'),
  },
  (t) => [index('videos_collection_idx').on(t.collectionId, t.sortOrder)],
);

/** Key frames selected from a video (sharp, non-redundant) – kept as JPEG evidence. */
export const frames = pgTable(
  'frames',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    collectionId: varchar('collection_id', { length: 12 })
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    timeSec: real('time_sec').notNull(),
    sharpness: real('sharpness'),
    /** full-resolution analysed frame (relative to STORAGE_DIR) */
    storagePath: text('storage_path').notNull(),
    /** small thumbnail for the "frames" view */
    thumbPath: text('thumb_path'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    analyzed: boolean('analyzed').notNull().default(false),
  },
  (t) => [uniqueIndex('frames_video_idx_uq').on(t.videoId, t.idx)],
);

/** A catalogued book (after merging detections across frames and videos). */
export const books = pgTable(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: varchar('collection_id', { length: 12 })
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),

    // --- identity (what is printed / canonical) ---
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    /** display author(s), "; " separated, canonical form ("Esterházy Péter", "Elena Ferrante") */
    author: text('author'),
    /** exactly as read from the spine (evidence) */
    spineAuthor: text('spine_author'),
    spineTitle: text('spine_title'),
    /** sort keys: family name first, lower-case, accents folded */
    authorSort: text('author_sort'),
    titleSort: text('title_sort'),
    originalTitle: text('original_title'),
    series: text('series'),
    publisher: text('publisher'),

    // --- enrichment ---
    /** ISO 639-1 language of this edition, e.g. 'hu' */
    language: varchar('language', { length: 8 }),
    originalLanguage: varchar('original_language', { length: 8 }),
    /** ISO 3166-1 alpha-2 of the (first) author's nationality */
    authorCountry: varchar('author_country', { length: 2 }),
    firstPublishedYear: integer('first_published_year'),
    editionYear: integer('edition_year'),
    isbn: text('isbn'),
    pageCount: integer('page_count'),
    /** primary taxonomy key – see src/lib/taxonomy.ts */
    category: varchar('category', { length: 40 }),
    /** additional taxonomy keys */
    topics: jsonb('topics').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** free-form keywords (original language) */
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    descriptionHu: text('description_hu'),
    descriptionEn: text('description_en'),
    /** external cover URL (Open Library / Google Books) */
    coverUrl: text('cover_url'),
    /** local cached cover (relative to STORAGE_DIR) */
    coverPath: text('cover_path'),
    enrichment: jsonb('enrichment').$type<Record<string, unknown>>(),
    enrichedAt: ts('enriched_at'),

    // --- evidence from the video ---
    source: varchar('source', { length: 8 }).$type<BookSource>().notNull().default('video'),
    /** 0..1 recognition confidence */
    confidence: real('confidence').notNull().default(1),
    needsReview: boolean('needs_review').notNull().default(false),
    reviewed: boolean('reviewed').notNull().default(false),
    /** cropped spine photo (relative to STORAGE_DIR) */
    spinePath: text('spine_path'),
    /** dominant spine colour "#rrggbb" */
    spineColor: varchar('spine_color', { length: 9 }),
    bestFrameId: uuid('best_frame_id').references(() => frames.id, { onDelete: 'set null' }),
    bestBbox: jsonb('best_bbox').$type<BBox>(),
    firstVideoId: uuid('first_video_id').references(() => videos.id, { onDelete: 'set null' }),
    firstTimeSec: real('first_time_sec'),
    /** global shelf order: video.sortOrder * 100000 + order within the video */
    shelfPosition: doublePrecision('shelf_position').notNull().default(0),
    detectionCount: integer('detection_count').notNull().default(1),

    // --- owner's personal data ---
    readingStatus: varchar('reading_status', { length: 16 }).$type<ReadingStatus>().notNull().default('unknown'),
    rating: smallint('rating'),
    favorite: boolean('favorite').notNull().default(false),
    notes: text('notes'),
    lentTo: text('lent_to'),
    lentAt: date('lent_at', { mode: 'string' }),

    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('books_collection_idx').on(t.collectionId, t.shelfPosition),
    index('books_collection_author_idx').on(t.collectionId, t.authorSort),
  ],
);

/** Raw per-frame observations returned by the vision model (kept for audit / re-merge). */
export const detections = pgTable(
  'detections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: varchar('collection_id', { length: 12 })
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    frameId: uuid('frame_id').references(() => frames.id, { onDelete: 'set null' }),
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'set null' }),
    rawAuthor: text('raw_author'),
    rawTitle: text('raw_title').notNull(),
    publisher: text('publisher'),
    confidence: real('confidence').notNull(),
    bbox: jsonb('bbox').$type<BBox>(),
    /** left→right order of the spine inside its frame */
    orderInFrame: integer('order_in_frame'),
    provider: varchar('provider', { length: 16 }).notNull(),
    model: text('model').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('detections_video_idx').on(t.videoId), index('detections_book_idx').on(t.bookId)],
);

/** Postgres-backed job queue (SELECT … FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: varchar('type', { length: 32 }).$type<JobType>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: varchar('status', { length: 16 }).$type<JobStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('jobs_pick_idx').on(t.status, t.runAt)],
);

export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: varchar('collection_id', { length: 12 }).references(() => collections.id, { onDelete: 'cascade' }),
    toAddress: text('to_address').notNull(),
    kind: varchar('kind', { length: 24 }).$type<EmailKind>().notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('email_log_to_idx').on(t.toAddress, t.createdAt)],
);

/** Fixed-window rate limiting shared by all web instances. key e.g. "upload:ip:1.2.3.4" */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull().default(0),
});

export type CollectionRow = typeof collections.$inferSelect;
export type VideoRow = typeof videos.$inferSelect;
export type FrameRow = typeof frames.$inferSelect;
export type BookRow = typeof books.$inferSelect;
export type NewBookRow = typeof books.$inferInsert;
export type DetectionRow = typeof detections.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

/**
 * zod schemas for API request bodies (owner: api). Text is trimmed; empty strings become null.
 */
import { z } from 'zod';
import { isTopicKey } from '@/lib/taxonomy';
import { EXPORT_FORMATS, READING_STATUSES, type ExportFormat, type ReadingStatus } from '@/lib/types';
import { isUuid } from '@/lib/security/tokens';

/** Trimmed text with a max length; '' → null; null allowed; undefined = "not provided". */
export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s): string | null => (s === '' ? null : s))
    .nullable()
    .optional();

const year = z.number().int().min(1000).max(2100).nullable().optional();

const topicKey = z.string().refine((k) => isTopicKey(k), { message: 'Unknown taxonomy key' });

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export const LIMITS = {
  title: 500,
  subtitle: 500,
  author: 500,
  originalTitle: 500,
  series: 300,
  publisher: 300,
  notes: 5000,
  lentTo: 200,
  tag: 60,
  tags: 30,
  topics: 12,
  collectionTitle: 200,
  collectionDescription: 2000,
  ownerName: 120,
} as const;

/** Editable book fields (PATCH /api/books/:id). Unknown keys are ignored. */
export const bookPatchSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title).optional(),
  subtitle: nullableText(LIMITS.subtitle),
  author: nullableText(LIMITS.author),
  originalTitle: nullableText(LIMITS.originalTitle),
  series: nullableText(LIMITS.series),
  publisher: nullableText(LIMITS.publisher),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .refine((s) => s === '' || /^[a-z]{2,3}$/.test(s), { message: 'Expected an ISO 639 language code' })
    .transform((s): string | null => (s === '' ? null : s))
    .nullable()
    .optional(),
  firstPublishedYear: year,
  editionYear: year,
  isbn: z
    .string()
    .trim()
    .max(32)
    .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
    .refine((s) => s === '' || /^[0-9]{9,12}[0-9X]$/.test(s), { message: 'Invalid ISBN' })
    .transform((s): string | null => (s === '' ? null : s))
    .nullable()
    .optional(),
  pageCount: z.number().int().min(1).max(100_000).nullable().optional(),
  category: topicKey.nullable().optional(),
  topics: z.array(topicKey).max(LIMITS.topics).transform(dedupe).optional(),
  tags: z
    .array(z.string().trim().max(LIMITS.tag))
    .max(LIMITS.tags)
    .transform((tags) => dedupe(tags.filter((t) => t !== '')))
    .optional(),
  readingStatus: z.enum(READING_STATUSES as [ReadingStatus, ...ReadingStatus[]]).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  favorite: z.boolean().optional(),
  notes: nullableText(LIMITS.notes),
  lentTo: nullableText(LIMITS.lentTo),
  lentAt: z
    .string()
    .trim()
    .transform((s) => (/^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s))
    .refine((s) => s === '' || isValidIsoDate(s), { message: 'Expected YYYY-MM-DD' })
    .transform((s): string | null => (s === '' ? null : s))
    .nullable()
    .optional(),
  reviewed: z.boolean().optional(),
  needsReview: z.boolean().optional(),
});

export type ValidBookPatch = z.output<typeof bookPatchSchema>;

/** POST /api/collections/:id/books */
export const newBookSchema = bookPatchSchema.extend({
  title: z.string().trim().min(1).max(LIMITS.title),
});

/** POST /api/collections/:id/unread-spines/:spineId – the book the owner recognised on an unread spine. */
export const resolveUnreadSpineSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  author: nullableText(LIMITS.author),
});

/** POST /api/collections */
export const createCollectionSchema = z.object({
  title: nullableText(LIMITS.collectionTitle),
  ownerName: nullableText(LIMITS.ownerName),
  email: z.string().max(320).nullable().optional(),
  locale: z.enum(['hu', 'en']).optional(),
});

/** PATCH /api/collections/:id */
export const collectionPatchSchema = z.object({
  title: nullableText(LIMITS.collectionTitle),
  description: nullableText(LIMITS.collectionDescription),
  ownerName: nullableText(LIMITS.ownerName),
  email: z.string().max(320).nullable().optional(),
  locale: z.enum(['hu', 'en']).optional(),
  visibility: z.enum(['link', 'pin']).optional(),
  pin: z.string().max(64).nullable().optional(),
});

export const claimSchema = z.union([
  z.object({ token: z.string().min(1).max(256) }),
  z.object({ recovery: z.string().min(1).max(128) }),
]);

export const unlockSchema = z.object({ pin: z.string().max(64) });

export const initUploadSchema = z.object({
  filename: z.string().max(1024),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** may be empty when the browser does not know the type – the extension decides then */
  mimeType: z.string().trim().max(255).optional().default(''),
});

export const mergeBooksSchema = z.object({
  keepId: z.string().refine(isUuid, { message: 'Expected a UUID' }),
  mergeIds: z
    .array(z.string().refine(isUuid, { message: 'Expected a UUID' }))
    .min(1)
    .max(200),
});

export const exportFormatSchema = z.enum(EXPORT_FORMATS as [ExportFormat, ...ExportFormat[]]);

export const emailExportSchema = z.object({
  email: z.string().max(320).nullable().optional(),
  formats: z.array(exportFormatSchema).min(1).max(EXPORT_FORMATS.length).transform(dedupe).optional(),
});

export const recoverSchema = z.object({ email: z.string().max(320) });

const emailSyntax = z.email();

/**
 * Normalises an e-mail address (trim + lower-case). '' / null / undefined → null.
 * Returns `false` when the address is syntactically invalid.
 */
export function normalizeEmail(raw: string | null | undefined): string | null | false {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  // Characters that could smuggle extra recipients or headers are refused before the syntax check.
  if (s.length > 254 || /[\s,;<>"\\]/.test(s)) return false;
  return emailSyntax.safeParse(s).success ? s : false;
}

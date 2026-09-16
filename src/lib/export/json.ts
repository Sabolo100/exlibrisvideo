/**
 * JSON export – a stable, documented, machine-readable snapshot of the catalogue.
 * Schema id "exlibrisvideo/1"; owner-only fields are present only for owners.
 */
import { topicLabel } from '@/lib/taxonomy';
import type { BookDTO } from '@/lib/types';
import { absoluteUrl, type ExportContext } from './shared';

export const JSON_SCHEMA_ID = 'exlibrisvideo/1';

export interface JsonExportBook {
  id: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  authors: string[];
  authorSort: string | null;
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
  categoryLabel: string | null;
  topics: string[];
  topicLabels: string[];
  tags: string[];
  description: { hu: string | null; en: string | null };
  coverImage: string | null;
  spineImage: string | null;
  spineColor: string | null;
  source: BookDTO['source'];
  confidence: number;
  needsReview: boolean;
  reviewed: boolean;
  shelfPosition: number;
  detectionCount: number;
  readingStatus: BookDTO['readingStatus'];
  rating: number | null;
  favorite: boolean;
  notes?: string | null;
  lentTo?: string | null;
  lentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JsonExport {
  schema: typeof JSON_SCHEMA_ID;
  exportedAt: string;
  generator: string;
  language: string;
  collection: {
    id: string;
    title: string | null;
    displayTitle: string;
    description: string | null;
    ownerName: string | null;
    url: string;
    locale: string;
    status: string;
    bookCount: number;
    createdAt: string;
    updatedAt: string;
  };
  books: JsonExportBook[];
}

export function buildJsonObject(ctx: ExportContext): JsonExport {
  const c = ctx.collection;
  const books = [...ctx.books].sort((a, b) => (a.shelfPosition ?? 0) - (b.shelfPosition ?? 0));
  return {
    schema: JSON_SCHEMA_ID,
    exportedAt: ctx.now.toISOString(),
    generator: 'Ex Libris Video',
    language: ctx.locale,
    collection: {
      id: c.id,
      title: c.title,
      displayTitle: ctx.title,
      description: c.description,
      ownerName: c.ownerName,
      url: c.publicUrl,
      locale: c.locale,
      status: c.status,
      bookCount: books.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    },
    books: books.map((b) => {
      const topics = [...new Set(b.topics ?? [])];
      const out: JsonExportBook = {
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        author: b.author,
        authors: (b.author ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
        authorSort: b.authorSort,
        originalTitle: b.originalTitle,
        series: b.series,
        publisher: b.publisher,
        language: b.language,
        originalLanguage: b.originalLanguage,
        authorCountry: b.authorCountry,
        firstPublishedYear: b.firstPublishedYear,
        editionYear: b.editionYear,
        isbn: b.isbn,
        pageCount: b.pageCount,
        category: b.category,
        categoryLabel: b.category ? topicLabel(b.category, ctx.locale) : null,
        topics,
        topicLabels: topics.map((k) => topicLabel(k, ctx.locale)),
        tags: b.tags ?? [],
        description: { hu: b.descriptionHu, en: b.descriptionEn },
        coverImage: absoluteUrl(b.coverImage, ctx.origin),
        spineImage: absoluteUrl(b.spineImage, ctx.origin),
        spineColor: b.spineColor,
        source: b.source,
        confidence: Math.round((b.confidence ?? 0) * 1000) / 1000,
        needsReview: b.needsReview,
        reviewed: b.reviewed,
        shelfPosition: b.shelfPosition,
        detectionCount: b.detectionCount,
        readingStatus: b.readingStatus,
        rating: b.rating,
        favorite: b.favorite,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
      if (ctx.isOwner) {
        out.notes = b.notes;
        out.lentTo = b.lentTo;
        out.lentAt = b.lentAt;
      }
      return out;
    }),
  };
}

export function buildJson(ctx: ExportContext): Buffer {
  return Buffer.from(`${JSON.stringify(buildJsonObject(ctx), null, 2)}\n`, 'utf8');
}

/**
 * One book from one phone photo (its spine, its front cover, or the barcode area of its back cover):
 * prompt, wire schema and the tolerant JSON coercion shared by the providers.
 */
import { z } from 'zod';
import type { BookPhotoKind, BookPhotoReading } from './types';

const WHAT: Record<BookPhotoKind, string> = {
  spine: 'the SPINE of one book (it may be photographed on its side – read the text in whichever direction it runs)',
  cover: 'the FRONT COVER of one book',
  isbn: 'the BACK of one book around its barcode',
};

export function bookPhotoSystemPrompt(kind: BookPhotoKind): string {
  return `You identify one printed book from a single phone photo taken by its owner, who adds the book to the catalogue of their home library (mostly Hungarian books, many translations). The photo shows ${WHAT[kind]}.

Return these fields:
- status: "book" when author or title can be read; "unreadable" when the photo shows a book but nothing useful is legible (blur, glare, too far); "not_book" when it is not a book at all.
- author: the author(s) as printed, keeping Hungarian accents ("Esterházy Péter"); several authors separated by "; "; null when no author is printed. You may correct an obvious misprint-like reading only when you clearly recognise the book.
- title: the title as printed (on a cover: the main, largest title text; never the author, the publisher, a series name or a slogan); "" when no title is legible.
- subtitle: the subtitle when one is printed, else null.
- publisher: the publisher or imprint mark if visible (e.g. "Európa", "Magvető"), else null.
- isbn: the ISBN digits exactly as printed – 13 digits starting with 978 or 979, or a 10-character ISBN-10 – without spaces or hyphens; read them from the human-readable digits under or above the barcode or from an "ISBN" line. null when they are not clearly legible. Never guess or complete digits.
- language: ISO 639-1 code of the language of the title text ("hu", "en", "de"), or null.
- confidence: 0..1, how sure you are of author and title together.

Transcribe; never invent a book that is not shown. Answer with JSON only.`;
}

export const BOOK_PHOTO_JSON_SHAPE = `JSON shape: {"status": "book" | "unreadable" | "not_book", "author": string | null, "title": string, "subtitle": string | null, "publisher": string | null, "isbn": string | null, "language": string | null, "confidence": number}`;

export function bookPhotoUserText(kind: BookPhotoKind): string {
  return kind === 'isbn'
    ? 'Read the ISBN of this book (and its author and title if they are printed here too).'
    : 'Which book is this?';
}

export const BookPhotoWireSchema = z.object({
  status: z.enum(['book', 'unreadable', 'not_book']),
  author: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  publisher: z.string().nullable(),
  isbn: z.string().nullable(),
  language: z.string().nullable(),
  confidence: z.number(),
});
export type BookPhotoWire = z.infer<typeof BookPhotoWireSchema>;

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** Tolerant reading of a JSON reply (field aliases, a wrapping object, numbers as strings). */
export function coerceBookPhoto(root: unknown): BookPhotoWire | null {
  if (!root || typeof root !== 'object') return null;
  let rec = root as Record<string, unknown>;
  for (const key of ['book', 'result', 'reading']) {
    const inner = rec[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) rec = inner as Record<string, unknown>;
  }
  const rawStatus = clean(rec.status, 20)?.toLowerCase().replace(/[\s-]+/g, '_');
  const title = clean(rec.title, 300) ?? '';
  const author = clean(rec.author ?? rec.authors, 300);
  const status: BookPhotoWire['status'] =
    rawStatus === 'not_book' || rawStatus === 'unreadable' || rawStatus === 'book' ? rawStatus : title || author ? 'book' : 'unreadable';
  const conf = typeof rec.confidence === 'number' ? rec.confidence : Number.parseFloat(String(rec.confidence ?? ''));
  return {
    status,
    author,
    title,
    subtitle: clean(rec.subtitle, 300),
    publisher: clean(rec.publisher, 200),
    isbn: clean(rec.isbn, 40),
    language: clean(rec.language, 8),
    confidence: Number.isFinite(conf) ? conf : 0.5,
  };
}

export function toBookPhotoReading(w: BookPhotoWire): BookPhotoReading {
  const lang = w.language?.trim().toLowerCase() ?? null;
  return {
    status: w.status,
    author: clean(w.author, 300),
    title: clean(w.title, 300) ?? '',
    subtitle: clean(w.subtitle, 300),
    publisher: clean(w.publisher, 200),
    isbn: w.isbn ? w.isbn.replace(/[^0-9Xx]/g, '').toUpperCase() || null : null,
    language: lang && /^[a-z]{2,3}$/.test(lang) ? lang : null,
    confidence: Math.min(1, Math.max(0, w.confidence)),
  };
}

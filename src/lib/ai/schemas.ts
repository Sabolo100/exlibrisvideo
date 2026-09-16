/**
 * Zod schemas for model outputs (snake_case wire names) + mappers to the camelCase contract types.
 *
 * The wire schemas are structured-output friendly (Anthropic `output_config.format`): plain
 * objects, strings, numbers, booleans, arrays and `.nullable()` only – no numeric bounds, no
 * regexes, no other unions. All clamping / validation of values happens in the mappers.
 *
 * JSON-mode providers (DeepSeek) additionally go through the lenient `coerce*` functions, which
 * repair the usual deviations (numbers as strings, missing nullable keys, bbox arrays…) before
 * the strict schema is applied.
 */
import { distance } from 'fastest-levenshtein';
import { z } from 'zod';
import { isTopicKey, TOPICS } from '@/lib/taxonomy';
import type { BBox } from '@/lib/types';
import { KNOWN_PUBLISHER_MARKS } from './prompts';
import type { BookClassification, SpineObservation, SpineReading, SpineReadingStatus } from './types';

/* ------------------------------------------------------------------ */
/* Wire schemas                                                        */
/* ------------------------------------------------------------------ */

export const BBoxWireSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

export const SpineObservationWireSchema = z.object({
  frame: z.number(),
  order: z.number(),
  author: z.string().nullable(),
  title: z.string(),
  canonical_author: z.string().nullable(),
  canonical_title: z.string().nullable(),
  publisher: z.string().nullable(),
  confidence: z.number(),
  bbox: BBoxWireSchema.nullable(),
});

export const VisionOutputSchema = z.object({
  observations: z.array(SpineObservationWireSchema),
});

export const SpineReadingWireSchema = z.object({
  id: z.number(),
  part: z.number(),
  status: z.enum(['book', 'illegible', 'not_book']),
  author: z.string().nullable(),
  title: z.string(),
  canonical_author: z.string().nullable(),
  canonical_title: z.string().nullable(),
  publisher: z.string().nullable(),
  confidence: z.number(),
});

export const SpineReadingOutputSchema = z.object({
  spines: z.array(SpineReadingWireSchema),
});

export const BookClassificationWireSchema = z.object({
  id: z.string(),
  known_book: z.boolean(),
  category: z.string(),
  topics: z.array(z.string()),
  author: z.string().nullable(),
  original_title: z.string().nullable(),
  language: z.string().nullable(),
  original_language: z.string().nullable(),
  author_country: z.string().nullable(),
  first_published_year: z.number().nullable(),
  description_hu: z.string().nullable(),
  description_en: z.string().nullable(),
});

export const ClassificationOutputSchema = z.object({
  books: z.array(BookClassificationWireSchema),
});

export const DuplicateAnswerWireSchema = z.object({
  id: z.string(),
  same: z.boolean(),
});

export const DuplicateOutputSchema = z.object({
  answers: z.array(DuplicateAnswerWireSchema),
});

export type BBoxWire = z.infer<typeof BBoxWireSchema>;
export type SpineObservationWire = z.infer<typeof SpineObservationWireSchema>;
export type VisionOutput = z.infer<typeof VisionOutputSchema>;
export type SpineReadingWire = z.infer<typeof SpineReadingWireSchema>;
export type SpineReadingOutput = z.infer<typeof SpineReadingOutputSchema>;
export type BookClassificationWire = z.infer<typeof BookClassificationWireSchema>;
export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;
export type DuplicateOutput = z.infer<typeof DuplicateOutputSchema>;

/* ------------------------------------------------------------------ */
/* Small text helpers                                                  */
/* ------------------------------------------------------------------ */

/** C0/C1 control characters and zero-width spaces (the \s class already covers the Unicode spaces). */
function isControlOrInvisible(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x200b || code === 0x2060;
}

/** NFC, trimmed, whitespace collapsed, wrapping quotes removed; empty → null. */
export function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  let s = Array.from(value.normalize('NFC'), (ch) => (isControlOrInvisible(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const quoted = /^["'„“”«»‚‘’](.*)["'“”«»‘’]$/.exec(s);
  if (quoted) s = quoted[1].trim();
  return s.length > 0 ? s : null;
}

/** lower-case, accents stripped, punctuation removed – for internal comparisons only. */
export function foldLoose(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const PUBLISHER_FOLDS = new Set(KNOWN_PUBLISHER_MARKS.map((p) => foldLoose(p)));

export function isKnownPublisherMark(value: string | null | undefined): boolean {
  const f = foldLoose(value);
  if (!f) return false;
  if (PUBLISHER_FOLDS.has(f)) return true;
  // "Európa Könyvkiadó", "Magvető Kiadó", "Park Kiadó"…
  const stripped = f.replace(/\b(konyvkiado|kiado|konyvek|konyvtar|kft|zrt|books|press|verlag|publishing)\b/g, '').trim();
  return stripped.length > 0 && stripped !== f && PUBLISHER_FOLDS.has(stripped);
}

/** Cuts to at most `max` characters at a word boundary, adding an ellipsis when shortened. */
export function clampText(value: string | null | undefined, max: number): string | null {
  const s = cleanText(value);
  if (!s) return null;
  if (s.length <= max) return s;
  const hard = s.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace >= max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.replace(/[\s,;:.–-]+$/u, '')}…`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ */
/* Bounding boxes                                                      */
/* ------------------------------------------------------------------ */

/** True when every coordinate is within ±1.5 – the model answered in normalised 0..1 units. */
export function looksNormalized(b: BBoxWire): boolean {
  return [b.x0, b.y0, b.x1, b.y1].every((v) => Math.abs(v) <= 1.5);
}

/**
 * Converts a model bbox to a pixel box inside the frame: detects normalised 0..1 answers and
 * scales them, orders the corners, clamps to the frame and rejects degenerate boxes.
 * `scale` maps the coordinate space the model saw to the stored frame (e.g. when the image was
 * downscaled before sending).
 */
export function normalizeBBox(
  raw: BBoxWire | null | undefined,
  width: number,
  height: number,
  scale: { x: number; y: number } = { x: 1, y: 1 },
): BBox | null {
  if (!raw || !(width > 0) || !(height > 0)) return null;
  const vals = [raw.x0, raw.y0, raw.x1, raw.y1];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  let { x0, y0, x1, y1 } = raw;
  if (looksNormalized(raw)) {
    x0 *= width;
    x1 *= width;
    y0 *= height;
    y1 *= height;
  } else {
    x0 *= scale.x;
    x1 *= scale.x;
    y0 *= scale.y;
    y1 *= scale.y;
  }
  const left = clamp(Math.min(x0, x1), 0, width);
  const right = clamp(Math.max(x0, x1), 0, width);
  const top = clamp(Math.min(y0, y1), 0, height);
  const bottom = clamp(Math.max(y0, y1), 0, height);
  if (right - left < 2 || bottom - top < 2) return null;
  return { x0: Math.round(left), y0: Math.round(top), x1: Math.round(right), y1: Math.round(bottom) };
}

/* ------------------------------------------------------------------ */
/* Vision mapper                                                       */
/* ------------------------------------------------------------------ */

export interface MapFrameInfo {
  /** frame number reported to the caller (VisionFrame.index) */
  index: number;
  width: number;
  height: number;
  /** multiplier from the coordinate space shown to the model to the stored frame (default 1) */
  scaleX?: number;
  scaleY?: number;
}

/** 0..1 similarity of two folded strings: best of Levenshtein ratio and token overlap (containment). */
export function looseSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const fa = foldLoose(a);
  const fb = foldLoose(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  const lev = 1 - distance(fa, fb) / Math.max(fa.length, fb.length);
  const ta = new Set(fa.split(' ').filter((t) => t.length >= 3 || /^\d+$/.test(t)));
  const tb = new Set(fb.split(' ').filter((t) => t.length >= 3 || /^\d+$/.test(t)));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const overlap = ta.size > 0 && tb.size > 0 ? shared / Math.min(ta.size, tb.size) : 0;
  return Math.max(lev, overlap);
}

/**
 * Keeps a canonical value only when it plausibly corrects the printed reading. A canonical title
 * with nothing in common with the spine (e.g. the original-language title "La brillante amica"
 * for a spine reading "Briliáns barátnőm") or a different author is dropped. Without a reading
 * there is nothing to contradict, so the canonical value is kept.
 */
export function plausibleCanonical(reading: string | null, canonical: string | null, kind: 'title' | 'author'): string | null {
  if (!canonical || !reading) return canonical;
  if (kind === 'author') {
    // "Asimov" → "Isaac Asimov", "H. Perruchot" → "Henri Perruchot", "Esterhazy Peter" → "Esterházy Péter"
    const readTokens = foldLoose(reading).split(' ').filter((t) => t.length >= 3);
    const canonTokens = foldLoose(canonical).split(' ').filter((t) => t.length >= 3);
    if (readTokens.length === 0) return canonical;
    const close = readTokens.some((r) => canonTokens.some((c) => 1 - distance(r, c) / Math.max(r.length, c.length) >= 0.75));
    return close ? canonical : null;
  }
  return looseSimilarity(reading, canonical) >= 0.5 ? canonical : null;
}

/**
 * Maps wire observations to the contract type. `frames[k-1]` is the frame labelled "Frame k"
 * in the request. Drops observations for unknown frames and without a usable title, moves
 * publisher marks out of the author field, dedupes repeated readings in a frame and renumbers
 * `order` 1..n left→right per frame.
 */
export function mapVisionOutput(wire: VisionOutput, frames: MapFrameInfo[]): SpineObservation[] {
  interface Draft extends SpineObservation {
    rawOrder: number;
    pos: number;
  }
  const drafts: Draft[] = [];
  wire.observations.forEach((o, pos) => {
    const k = Math.round(o.frame);
    const info = Number.isFinite(k) ? frames[k - 1] : undefined;
    if (!info) return;

    let author = cleanText(o.author);
    let publisher = cleanText(o.publisher);
    let title = cleanText(o.title);
    // canonical values must be spelling fixes of what is printed, not translations or other books
    const canonicalAuthor = plausibleCanonical(author, cleanText(o.canonical_author), 'author');
    const canonicalTitle = plausibleCanonical(title, cleanText(o.canonical_title), 'title');

    if (author && isKnownPublisherMark(author)) {
      publisher = publisher ?? author;
      author = null;
    }
    if (title && isKnownPublisherMark(title)) {
      publisher = publisher ?? title;
      title = null;
    }
    // an author-only reading is useful only when the model recognised the book
    if (!title) title = canonicalTitle;
    if (!title) return;

    let confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0.5;
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    confidence = Math.round(clamp(confidence, 0, 1) * 1000) / 1000;

    drafts.push({
      frame: info.index,
      order: 0,
      rawOrder: Number.isFinite(o.order) ? o.order : Number.MAX_SAFE_INTEGER,
      pos,
      author,
      title,
      canonicalAuthor,
      canonicalTitle,
      publisher,
      confidence,
      bbox: normalizeBBox(o.bbox, info.width, info.height, { x: info.scaleX ?? 1, y: info.scaleY ?? 1 }),
    });
  });

  const byFrame = new Map<number, Draft[]>();
  for (const d of drafts) {
    const list = byFrame.get(d.frame) ?? [];
    list.push(d);
    byFrame.set(d.frame, list);
  }

  const out: SpineObservation[] = [];
  const frameOrder = [...byFrame.keys()].sort((a, b) => a - b);
  for (const frame of frameOrder) {
    const list = byFrame.get(frame)!;
    // dedupe identical readings within the frame (keep the most confident)
    const unique = new Map<string, Draft>();
    for (const d of list) {
      const key = `${foldLoose(d.author)}|${foldLoose(d.title)}|${d.bbox ? Math.round((d.bbox.x0 + d.bbox.x1) / 40) : d.rawOrder}`;
      const prev = unique.get(key);
      if (!prev || d.confidence > prev.confidence) unique.set(key, d);
    }
    const sorted = [...unique.values()].sort((a, b) => {
      if (a.rawOrder !== b.rawOrder) return a.rawOrder - b.rawOrder;
      const ax = a.bbox ? a.bbox.x0 + a.bbox.x1 : Number.MAX_SAFE_INTEGER;
      const bx = b.bbox ? b.bbox.x0 + b.bbox.x1 : Number.MAX_SAFE_INTEGER;
      if (ax !== bx) return ax - bx;
      return a.pos - b.pos;
    });
    sorted.forEach((d, i) => {
      out.push({
        frame: d.frame,
        order: i + 1,
        author: d.author,
        title: d.title,
        canonicalAuthor: d.canonicalAuthor,
        canonicalTitle: d.canonicalTitle,
        publisher: d.publisher,
        confidence: d.confidence,
        bbox: d.bbox,
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Spine reading mapper                                                */
/* ------------------------------------------------------------------ */

const STATUS_RANK: Record<SpineReadingStatus, number> = { book: 2, illegible: 1, not_book: 0 };

/**
 * Maps wire readings of cut-out spines to the contract: unknown ids are dropped, text is cleaned, publisher
 * marks move out of author / title, canonical values must plausibly correct the reading, confidence is
 * clamped to 0..1 and every (id, part) is kept once (the best reading). A "book" with nothing legible
 * becomes "illegible"; "not_book" entries carry no text.
 */
export function mapSpineReadingOutput(wire: SpineReadingOutput, spineIds: readonly number[]): SpineReading[] {
  const known = new Set(spineIds);
  const best = new Map<string, SpineReading>();
  for (const w of wire.spines) {
    const id = Math.round(w.id);
    if (!known.has(id)) continue;
    const part = Number.isFinite(w.part) && w.part >= 1 ? Math.round(w.part) : 1;
    let author = cleanText(w.author);
    let title = cleanText(w.title);
    let publisher = cleanText(w.publisher);
    const canonicalAuthor = plausibleCanonical(author, cleanText(w.canonical_author), 'author');
    const canonicalTitle = plausibleCanonical(title, cleanText(w.canonical_title), 'title');
    if (author && isKnownPublisherMark(author)) {
      publisher = publisher ?? author;
      author = null;
    }
    if (title && isKnownPublisherMark(title)) {
      publisher = publisher ?? title;
      title = null;
    }
    let status: SpineReadingStatus = w.status;
    if (status === 'book' && !title && !author && !canonicalTitle && !canonicalAuthor) status = 'illegible';
    let confidence = Number.isFinite(w.confidence) ? w.confidence : 0.5;
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    confidence = Math.round(clamp(confidence, 0, 1) * 1000) / 1000;
    const isBook = status === 'book';
    const reading: SpineReading = {
      id,
      part,
      status,
      author: status === 'not_book' ? null : author,
      title: isBook ? (title ?? '') : '',
      canonicalAuthor: isBook ? canonicalAuthor : null,
      canonicalTitle: isBook ? canonicalTitle : null,
      publisher: status === 'not_book' ? null : publisher,
      confidence,
    };
    const key = `${id}:${part}`;
    const prev = best.get(key);
    if (!prev || STATUS_RANK[reading.status] > STATUS_RANK[prev.status] || (reading.status === prev.status && reading.confidence > prev.confidence)) {
      best.set(key, reading);
    }
  }
  return [...best.values()].sort((a, b) => a.id - b.id || a.part - b.part);
}

/* ------------------------------------------------------------------ */
/* Classification mapper                                               */
/* ------------------------------------------------------------------ */

const LANGUAGE_ALIASES: Record<string, string> = {
  hun: 'hu', hungarian: 'hu', magyar: 'hu',
  eng: 'en', english: 'en', angol: 'en',
  ger: 'de', deu: 'de', german: 'de', nemet: 'de',
  fre: 'fr', fra: 'fr', french: 'fr', francia: 'fr',
  ita: 'it', italian: 'it', olasz: 'it',
  spa: 'es', spanish: 'es', spanyol: 'es',
  rus: 'ru', russian: 'ru', orosz: 'ru',
  pol: 'pl', polish: 'pl', lengyel: 'pl',
  cze: 'cs', ces: 'cs', czech: 'cs',
  slo: 'sk', slk: 'sk', slovak: 'sk',
  lat: 'la', latin: 'la',
  gre: 'el', ell: 'el', greek: 'el',
  jpn: 'ja', japanese: 'ja',
  swe: 'sv', swedish: 'sv',
  nor: 'no', norwegian: 'no',
  dan: 'da', danish: 'da',
  dut: 'nl', nld: 'nl', dutch: 'nl',
  por: 'pt', portuguese: 'pt',
  heb: 'he', hebrew: 'he',
  rum: 'ro', ron: 'ro', romanian: 'ro',
  chi: 'zh', zho: 'zh', chinese: 'zh',
  fin: 'fi', finnish: 'fi',
  tur: 'tr', turkish: 'tr',
};

export function normalizeLanguage(value: string | null | undefined): string | null {
  // "en-GB" / "hu_HU" / "Hungarian" → first token
  const base = foldLoose(value).split(/[\s_]+/)[0];
  if (!base) return null;
  if (/^[a-z]{2}$/.test(base)) return base;
  return LANGUAGE_ALIASES[base] ?? null;
}

export function normalizeCountry(value: string | null | undefined): string | null {
  const s = (value ?? '').trim().toUpperCase();
  if (s === 'UK') return 'GB';
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export function normalizeYear(value: number | null | undefined, now = new Date()): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const y = Math.round(value);
  if (y === 0 || y < -3000 || y > now.getUTCFullYear() + 1) return null;
  return y;
}

const TOPIC_LABEL_LOOKUP = new Map<string, string>();
for (const t of TOPICS) {
  TOPIC_LABEL_LOOKUP.set(foldLoose(t.key), t.key);
  TOPIC_LABEL_LOOKUP.set(foldLoose(t.en), t.key);
  TOPIC_LABEL_LOOKUP.set(foldLoose(t.hu), t.key);
}

/** Maps a model answer to a taxonomy key ("crime-thriller", "Science fiction" → key), else null. */
export function toTopicKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isTopicKey(direct)) return direct;
  return TOPIC_LABEL_LOOKUP.get(foldLoose(value)) ?? null;
}

export const DESCRIPTION_MAX_CHARS = 200;

export function mapClassification(wire: BookClassificationWire): BookClassification {
  // facts about the book itself are only kept when the model says it knows this specific book
  const known = wire.known_book !== false;
  const category = toTopicKey(wire.category) ?? 'other';
  const topics: string[] = [];
  for (const t of wire.topics) {
    const key = toTopicKey(t);
    if (key && key !== category && !topics.includes(key)) topics.push(key);
    if (topics.length === 3) break;
  }
  return {
    id: wire.id.trim(),
    category,
    topics,
    author: cleanText(wire.author),
    originalTitle: known ? cleanText(wire.original_title) : null,
    language: normalizeLanguage(wire.language),
    originalLanguage: normalizeLanguage(wire.original_language),
    authorCountry: normalizeCountry(wire.author_country),
    firstPublishedYear: known ? normalizeYear(wire.first_published_year) : null,
    descriptionHu: known ? clampText(wire.description_hu, DESCRIPTION_MAX_CHARS) : null,
    descriptionEn: known ? clampText(wire.description_en, DESCRIPTION_MAX_CHARS) : null,
  };
}

/** Maps all entries whose id is one of `ids` (first answer per id wins). */
export function mapClassificationOutput(wire: ClassificationOutput, ids: Iterable<string>): BookClassification[] {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  const out: BookClassification[] = [];
  for (const entry of wire.books) {
    const mapped = mapClassification(entry);
    if (!wanted.has(mapped.id) || seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    out.push(mapped);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Duplicate mapper                                                    */
/* ------------------------------------------------------------------ */

/** Answer for every asked id; ids the model skipped count as "not the same" (never merge on doubt). */
export function mapDuplicateOutput(wire: DuplicateOutput, ids: Iterable<string>): Record<string, boolean> {
  const answers = new Map<string, boolean>();
  for (const a of wire.answers) {
    const id = a.id.trim();
    if (!answers.has(id)) answers.set(id, a.same === true);
  }
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = answers.get(id) ?? false;
  return out;
}

/* ------------------------------------------------------------------ */
/* Lenient coercion for JSON-mode providers                            */
/* ------------------------------------------------------------------ */

/** Parses the first JSON object/array in a model reply (tolerates ``` fences and chatter). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const values = scanJsonValues(trimmed);
    if (values.length === 0) throw err instanceof SyntaxError ? err : new SyntaxError('no JSON value in model reply');
    if (values.length === 1) return values[0];
    // several top-level objects (e.g. one per frame): merge their list properties
    if (values.every(isRec)) {
      const merged: Rec = {};
      for (const v of values as Rec[]) {
        for (const [k, val] of Object.entries(v)) {
          if (Array.isArray(val) && Array.isArray(merged[k])) merged[k] = [...(merged[k] as unknown[]), ...val];
          else if (!(k in merged)) merged[k] = val;
        }
      }
      return merged;
    }
    if (values.every(Array.isArray)) return (values as unknown[][]).flat();
    return values[0];
  }
}

/** Finds and parses every balanced top-level {...} / [...] value in `text` (string-aware). */
function scanJsonValues(text: string): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break; // unterminated (truncated) value
    try {
      out.push(JSON.parse(text.slice(i, end + 1)));
      i = end + 1;
    } catch {
      i++;
    }
  }
  return out;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Largest coordinate (+2 % tolerance) still read as thousandths when 'per_mille' was requested. */
const PER_MILLE_LIMIT = 1020;
/** Frame sides up to this many px differ from the 0..1000 grid by ≤ 10 %: pixels vs thousandths is a guess there. */
const NEAR_GRID_SIDE = 1100;

/**
 * Decides how the boxes of one JSON-mode reply must be scaled to the stored frames.
 * - every coordinate of a box within ±1.5 → 0..1 fractions (handled per box by normalizeBBox)
 * - requested 'pixels' → scale 1
 * - requested 'per_mille' → decided per axis over the whole reply. An axis with a coordinate
 *   above 1000 (+2 %) is in pixels. Otherwise it is read as thousandths of W (x) / H (y) –
 *   except when the other axis is clearly in pixels and this frame side is close to 1000 px
 *   anyway (≤ 1100): then the model most likely answered in pixels throughout, and a wrong guess
 *   costs at most 10 %.
 *   Live DeepSeek replies on portrait 1080 × 1920 frames sometimes mix units (x in pixels up to
 *   1080, y still in thousandths); a single decision for both axes squashed those boxes into the
 *   upper half of the frame.
 */
export function resolveBoxScale(
  observations: SpineObservationWire[],
  frames: { width: number; height: number }[],
  requested: 'pixels' | 'per_mille',
): { scaleX: number; scaleY: number }[] {
  if (requested === 'pixels') return frames.map(() => ({ scaleX: 1, scaleY: 1 }));
  let maxX = 0;
  let maxY = 0;
  for (const o of observations) {
    const b = o.bbox;
    if (!b || looksNormalized(b)) continue;
    for (const v of [b.x0, b.x1]) if (Number.isFinite(v)) maxX = Math.max(maxX, Math.abs(v));
    for (const v of [b.y0, b.y1]) if (Number.isFinite(v)) maxY = Math.max(maxY, Math.abs(v));
  }
  const xPixels = maxX > PER_MILLE_LIMIT;
  const yPixels = maxY > PER_MILLE_LIMIT;
  return frames.map((f) => {
    const xInPixels = xPixels || (yPixels && f.width <= NEAR_GRID_SIDE);
    const yInPixels = yPixels || (xPixels && f.height <= NEAR_GRID_SIDE);
    return { scaleX: xInPixels ? 1 : f.width / 1000, scaleY: yInPixels ? 1 : f.height / 1000 };
  });
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function pick(o: Rec, ...keys: string[]): unknown {
  for (const k of keys) if (k in o && o[k] !== undefined) return o[k];
  return undefined;
}

/** Finds the list of items: {key: [...]}, a bare array, or the only array-valued property. */
function findItems(root: unknown, key: string): unknown[] | null {
  if (Array.isArray(root)) return root;
  if (!isRec(root)) return null;
  if (Array.isArray(root[key])) return root[key] as unknown[];
  const arrays = Object.values(root).filter(Array.isArray);
  if (arrays.length === 1) return arrays[0] as unknown[];
  // a single object answer instead of a list
  return null;
}

function coerceBBox(v: unknown): BBoxWire | null {
  if (Array.isArray(v) && v.length === 4) {
    const [x0, y0, x1, y1] = v.map(num);
    return x0 !== null && y0 !== null && x1 !== null && y1 !== null ? { x0, y0, x1, y1 } : null;
  }
  if (!isRec(v)) return null;
  const x0 = num(pick(v, 'x0', 'left', 'xmin', 'x_min'));
  const y0 = num(pick(v, 'y0', 'top', 'ymin', 'y_min'));
  let x1 = num(pick(v, 'x1', 'right', 'xmax', 'x_max'));
  let y1 = num(pick(v, 'y1', 'bottom', 'ymax', 'y_max'));
  const w = num(pick(v, 'width', 'w'));
  const h = num(pick(v, 'height', 'h'));
  if (x1 === null && x0 !== null && w !== null) x1 = x0 + w;
  if (y1 === null && y0 !== null && h !== null) y1 = y0 + h;
  return x0 !== null && y0 !== null && x1 !== null && y1 !== null ? { x0, y0, x1, y1 } : null;
}

/**
 * Lenient conversion of a JSON-mode reply into VisionOutput. Returns null when the top-level
 * shape is unusable (→ caller retries); individual broken items are dropped.
 */
export function coerceVisionOutput(root: unknown, frameCount: number): VisionOutput | null {
  const items = findItems(root, 'observations');
  if (!items) return null;
  const observations: SpineObservationWire[] = [];
  items.forEach((item, i) => {
    if (!isRec(item)) return;
    const frame = num(pick(item, 'frame', 'frame_index', 'frame_number')) ?? (frameCount === 1 ? 1 : null);
    if (frame === null) return;
    const candidate = {
      frame,
      order: num(pick(item, 'order', 'position', 'index')) ?? i + 1,
      author: str(pick(item, 'author')),
      title: str(pick(item, 'title')) ?? '',
      canonical_author: str(pick(item, 'canonical_author', 'canonicalAuthor')),
      canonical_title: str(pick(item, 'canonical_title', 'canonicalTitle')),
      publisher: str(pick(item, 'publisher', 'series')),
      confidence: num(pick(item, 'confidence')) ?? 0.5,
      bbox: coerceBBox(pick(item, 'bbox', 'box', 'bounding_box')),
    };
    const parsed = SpineObservationWireSchema.safeParse(candidate);
    if (parsed.success) observations.push(parsed.data);
  });
  return { observations };
}

const SPINE_STATUS_ALIASES: Record<string, SpineReadingStatus> = {
  book: 'book',
  legible: 'book',
  partial: 'book',
  partly_legible: 'book',
  illegible: 'illegible',
  unreadable: 'illegible',
  blank: 'illegible',
  not_book: 'not_book',
  notbook: 'not_book',
  no_book: 'not_book',
  none: 'not_book',
  other: 'not_book',
};

/**
 * Lenient conversion of a JSON-mode reply about cut-out spines. Returns null when the top-level shape is
 * unusable (→ caller retries); broken items are dropped. A missing status is inferred from the text.
 */
export function coerceSpineReadingOutput(root: unknown): SpineReadingOutput | null {
  const items = findItems(root, 'spines');
  if (!items) return null;
  const spines: SpineReadingWire[] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const id = num(pick(item, 'id', 'spine', 'spine_id', 'number'));
    if (id === null) continue;
    const title = str(pick(item, 'title')) ?? '';
    const author = str(pick(item, 'author'));
    const rawStatus = str(pick(item, 'status', 'kind', 'type'));
    const status = rawStatus ? SPINE_STATUS_ALIASES[rawStatus.trim().toLowerCase().replace(/[\s-]+/g, '_')] : undefined;
    const candidate = {
      id,
      part: num(pick(item, 'part', 'book', 'index')) ?? 1,
      status: status ?? (title.trim() || author?.trim() ? 'book' : 'illegible'),
      author,
      title,
      canonical_author: str(pick(item, 'canonical_author', 'canonicalAuthor')),
      canonical_title: str(pick(item, 'canonical_title', 'canonicalTitle')),
      publisher: str(pick(item, 'publisher', 'series')),
      confidence: num(pick(item, 'confidence')) ?? 0.5,
    };
    const parsed = SpineReadingWireSchema.safeParse(candidate);
    if (parsed.success) spines.push(parsed.data);
  }
  return { spines };
}

export function coerceClassificationOutput(root: unknown): ClassificationOutput | null {
  const items = findItems(root, 'books');
  if (!items) return null;
  const books: BookClassificationWire[] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const id = str(pick(item, 'id'));
    if (!id) continue;
    const rawTopics = pick(item, 'topics');
    const rawKnown = pick(item, 'known_book', 'knownBook', 'known');
    const candidate = {
      id,
      // a missing flag is not treated as "unknown": the model simply forgot the key
      known_book: typeof rawKnown === 'boolean' ? rawKnown : typeof rawKnown === 'string' ? !/^(false|no|nem)$/i.test(rawKnown.trim()) : true,
      category: str(pick(item, 'category')) ?? 'other',
      topics: Array.isArray(rawTopics)
        ? rawTopics.map(str).filter((t): t is string => t !== null)
        : typeof rawTopics === 'string'
          ? rawTopics.split(/[,;]/)
          : [],
      author: str(pick(item, 'author')),
      original_title: str(pick(item, 'original_title', 'originalTitle')),
      language: str(pick(item, 'language')),
      original_language: str(pick(item, 'original_language', 'originalLanguage')),
      author_country: str(pick(item, 'author_country', 'authorCountry')),
      first_published_year: num(pick(item, 'first_published_year', 'firstPublishedYear', 'year')),
      description_hu: str(pick(item, 'description_hu', 'descriptionHu')),
      description_en: str(pick(item, 'description_en', 'descriptionEn')),
    };
    const parsed = BookClassificationWireSchema.safeParse(candidate);
    if (parsed.success) books.push(parsed.data);
  }
  return { books };
}

export function coerceDuplicateOutput(root: unknown): DuplicateOutput | null {
  const items = findItems(root, 'answers');
  if (!items) {
    // {"q1": true, "q2": false}
    if (isRec(root) && Object.values(root).every((v) => typeof v === 'boolean')) {
      return { answers: Object.entries(root).map(([id, same]) => ({ id, same: same as boolean })) };
    }
    return null;
  }
  const answers: DuplicateOutput['answers'] = [];
  for (const item of items) {
    if (!isRec(item)) continue;
    const id = str(pick(item, 'id'));
    const raw = pick(item, 'same', 'is_same', 'duplicate');
    const same = typeof raw === 'boolean' ? raw : typeof raw === 'string' ? /^(true|yes|igen)$/i.test(raw.trim()) : null;
    if (id && same !== null) answers.push({ id, same });
  }
  return { answers };
}

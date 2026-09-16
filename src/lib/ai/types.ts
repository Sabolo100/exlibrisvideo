/**
 * AI provider contracts (complete – implementations live in src/lib/ai/{anthropic,deepseek,mock}.ts).
 */
import type { AiProviderName, BBox, Locale } from '@/lib/types';

/** One spine seen in one frame. */
export interface SpineObservation {
  /** 1-based index of the frame inside the batch */
  frame: number;
  /** left→right order of the spine inside that frame (1-based) */
  order: number;
  author: string | null;
  title: string;
  canonicalAuthor: string | null;
  canonicalTitle: string | null;
  publisher: string | null;
  /** 0..1 legibility / certainty */
  confidence: number;
  /** pixel box in that frame's coordinate space, or null */
  bbox: BBox | null;
}

export interface VisionFrame {
  /** 1-based index inside the batch */
  index: number;
  frameId: string;
  jpeg: Buffer;
  width: number;
  height: number;
  timeSec: number;
}

export interface VisionContext {
  collectionId: string;
  videoId: string;
  originalFilename: string;
  /** sha1 hex of the first 4 MiB of the source file (mock fixture matching) */
  sourceSha1: string | null;
  batchIndex: number;
  totalBatches: number;
  locale: Locale;
}

export interface AiUsage {
  provider: AiProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

export interface VisionProvider {
  readonly name: AiProviderName;
  readonly model: string;
  readSpines(frames: VisionFrame[], ctx: VisionContext): Promise<{ observations: SpineObservation[]; usage: AiUsage }>;
}

export interface BookForClassification {
  id: string;
  author: string | null;
  title: string;
  spineAuthor: string | null;
  spineTitle: string | null;
  publisher: string | null;
}

export interface BookClassification {
  id: string;
  /** taxonomy key */
  category: string;
  /** 0–3 extra taxonomy keys */
  topics: string[];
  /** canonical full author name, or null to keep the current value */
  author: string | null;
  originalTitle: string | null;
  /** ISO 639-1 */
  language: string | null;
  originalLanguage: string | null;
  /** ISO 3166-1 alpha-2 */
  authorCountry: string | null;
  firstPublishedYear: number | null;
  descriptionHu: string | null;
  descriptionEn: string | null;
}

export interface DuplicateQuestion {
  id: string;
  a: { author: string | null; title: string };
  b: { author: string | null; title: string };
}

export interface TextProvider {
  readonly name: AiProviderName;
  readonly model: string;
  classifyBooks(
    books: BookForClassification[],
    ctx: { locale: Locale },
  ): Promise<{ results: BookClassification[]; usage: AiUsage }>;
  /** answers whether each pair is the same book (edition differences count as the same) */
  judgeDuplicates(questions: DuplicateQuestion[]): Promise<{ same: Record<string, boolean>; usage: AiUsage }>;
}

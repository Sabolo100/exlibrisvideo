/**
 * Deterministic AI providers for development, tests and demos (AI_MOCK=true or no API keys).
 *
 * Vision: for the sample videos (SPEC §8) the verified ground truth
 * `fixtures/sample-shelf/ground-truth.json` is replayed – a fixture book is "visible" in a frame
 * when |frame.timeSec − (best_frame − 1) × 0.5| ≤ 1.25 s. Sources are matched by original
 * filename (basename without extension) or by the sha1 of the first 4 MiB of the sample file.
 * Unknown sources get a fixed list of well-known books spread along a virtual shelf.
 *
 * Text: keyword → taxonomy rules, simple language detection, null for every fact we cannot know.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authorsCompatible, titleSimilarity } from '@/lib/pipeline/text';
import type { BBox } from '@/lib/types';
import { foldLoose } from './schemas';
import type {
  AiUsage,
  BookClassification,
  BookForClassification,
  DuplicateQuestion,
  SpineObservation,
  TextProvider,
  VisionContext,
  VisionFrame,
  VisionProvider,
} from './types';

export const MOCK_VISION_MODEL = 'mock-fixture';
export const MOCK_TEXT_MODEL = 'mock-rules';

/** seconds a fixture book stays visible around its best frame */
export const FIXTURE_VISIBILITY_WINDOW_SEC = 1.25;
const FIXTURE_FRAME_STEP_SEC = 0.5;
const STRIP_WIDTH_FRACTION = 0.09;
const SHA1_PREFIX_BYTES = 4 * 1024 * 1024;

export interface MockOptions {
  /** simulated latency range; false disables it (tests). Default 200–600 ms. */
  latency?: false | { minMs: number; maxMs: number };
  /** project root used to locate fixtures/ and Mintavideok/ (default process.cwd()) */
  rootDir?: string;
}

const zeroUsage = (model: string): AiUsage => ({ provider: 'mock', model, inputTokens: 0, outputTokens: 0, estCostUsd: 0 });

function hashNumber(input: string): number {
  return createHash('sha1').update(input).digest().readUInt32BE(0);
}

async function simulateLatency(opts: MockOptions, seed: string): Promise<void> {
  if (opts.latency === false) return;
  const { minMs, maxMs } = opts.latency ?? { minMs: 200, maxMs: 600 };
  const span = Math.max(0, maxMs - minMs);
  const ms = minMs + (span > 0 ? hashNumber(seed) % (span + 1) : 0);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Ground-truth fixture                                                */
/* ------------------------------------------------------------------ */

export interface FixtureBook {
  author: string | null;
  title: string;
  canonical_author: string | null;
  canonical_title: string | null;
  legibility: 'clear' | 'partial' | 'guess' | string;
  /** 2 fps frame index, 1-based */
  best_frame: number;
  /** 0..1 horizontal centre in the best frame */
  x_center: number;
}

export interface FixtureVideo {
  video: string;
  books: FixtureBook[];
}

export interface GroundTruth {
  videos: FixtureVideo[];
}

function isFixtureBook(b: unknown): b is FixtureBook {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  return typeof o.title === 'string' && typeof o.best_frame === 'number' && typeof o.x_center === 'number';
}

/** Validates the parts of the fixture the mock relies on; malformed entries are skipped. */
export function parseGroundTruth(raw: unknown): GroundTruth | null {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { videos?: unknown }).videos)) return null;
  const videos: FixtureVideo[] = [];
  for (const v of (raw as { videos: unknown[] }).videos) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.video !== 'string' || !Array.isArray(o.books)) continue;
    videos.push({
      video: o.video,
      books: o.books.filter(isFixtureBook).map((b) => ({
        author: typeof b.author === 'string' && b.author.trim() ? b.author : null,
        title: b.title,
        canonical_author: typeof b.canonical_author === 'string' && b.canonical_author.trim() ? b.canonical_author : null,
        canonical_title: typeof b.canonical_title === 'string' && b.canonical_title.trim() ? b.canonical_title : null,
        legibility: typeof b.legibility === 'string' ? b.legibility : 'clear',
        best_frame: b.best_frame,
        x_center: b.x_center,
      })),
    });
  }
  return { videos };
}

export function legibilityConfidence(legibility: string): number {
  if (legibility === 'clear') return 0.95;
  if (legibility === 'partial') return 0.7;
  return 0.45;
}

/** Vertical strip centred on x_center, 9 % of the frame wide, from 5 % to 95 % of the height. */
export function stripBBox(xCenter: number, width: number, height: number): BBox {
  const cx = Math.min(1, Math.max(0, xCenter)) * width;
  const half = (STRIP_WIDTH_FRACTION * width) / 2;
  return {
    x0: Math.round(Math.max(0, cx - half)),
    y0: Math.round(height * 0.05),
    x1: Math.round(Math.min(width, cx + half)),
    y1: Math.round(height * 0.95),
  };
}

export function isVisibleAt(book: Pick<FixtureBook, 'best_frame'>, timeSec: number): boolean {
  const bookTime = (book.best_frame - 1) * FIXTURE_FRAME_STEP_SEC;
  return Math.abs(timeSec - bookTime) <= FIXTURE_VISIBILITY_WINDOW_SEC + 1e-9;
}

/** Observations the fixture predicts for a batch of frames (pure). */
export function fixtureObservations(video: FixtureVideo, frames: VisionFrame[]): SpineObservation[] {
  const out: SpineObservation[] = [];
  frames.forEach((frame, i) => {
    const visible = video.books
      .map((book, idx) => ({ book, idx }))
      .filter(({ book }) => isVisibleAt(book, frame.timeSec))
      .sort((a, b) => a.book.x_center - b.book.x_center || a.idx - b.idx);
    visible.forEach(({ book }, pos) => {
      out.push({
        frame: frame.index ?? i + 1,
        order: pos + 1,
        author: book.author,
        title: book.title,
        canonicalAuthor: book.canonical_author,
        canonicalTitle: book.canonical_title,
        publisher: null,
        confidence: legibilityConfidence(book.legibility),
        bbox: stripBBox(book.x_center, frame.width, frame.height),
      });
    });
  });
  return out;
}

/** The fixed demo shelf for sources that are not sample videos. */
export const DEMO_BOOKS: ReadonlyArray<{ author: string; title: string }> = [
  { author: 'Szabó Magda', title: 'Az ajtó' },
  { author: 'Márai Sándor', title: 'A gyertyák csonkig égnek' },
  { author: 'Kosztolányi Dezső', title: 'Édes Anna' },
  { author: 'Molnár Ferenc', title: 'A Pál utcai fiúk' },
  { author: 'Gárdonyi Géza', title: 'Egri csillagok' },
  { author: 'Karinthy Frigyes', title: 'Így írtok ti' },
  { author: 'George Orwell', title: '1984' },
  { author: 'Jane Austen', title: 'Büszkeség és balítélet' },
  { author: 'Gabriel García Márquez', title: 'Száz év magány' },
  { author: 'J. R. R. Tolkien', title: 'A hobbit' },
  { author: 'Agatha Christie', title: 'Tíz kicsi néger' },
  { author: 'Antoine de Saint-Exupéry', title: 'A kis herceg' },
];
const DEMO_SPACING_SEC = 0.75;

/** Demo shelf: book i is centred at t = i × 0.75 s and visible ±1.25 s, drifting left as time passes. */
export function demoObservations(frames: VisionFrame[]): SpineObservation[] {
  const out: SpineObservation[] = [];
  frames.forEach((frame, i) => {
    const visible = DEMO_BOOKS.map((book, idx) => ({ book, idx, dt: idx * DEMO_SPACING_SEC - frame.timeSec }))
      .filter(({ dt }) => Math.abs(dt) <= FIXTURE_VISIBILITY_WINDOW_SEC + 1e-9)
      .sort((a, b) => a.dt - b.dt);
    visible.forEach(({ book, idx, dt }, pos) => {
      const xCenter = 0.5 + (dt / FIXTURE_VISIBILITY_WINDOW_SEC) * 0.4;
      out.push({
        frame: frame.index ?? i + 1,
        order: pos + 1,
        author: book.author,
        title: book.title,
        canonicalAuthor: book.author,
        canonicalTitle: book.title,
        publisher: null,
        confidence: idx % 4 === 3 ? 0.7 : 0.95,
        bbox: stripBBox(xCenter, frame.width, frame.height),
      });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Vision provider                                                     */
/* ------------------------------------------------------------------ */

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock' as const;
  readonly model = MOCK_VISION_MODEL;
  private groundTruth: GroundTruth | null = null;
  private sampleSha1: Map<string, string> | null = null;
  private readonly opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
  }

  private root(): string {
    return this.opts.rootDir ?? process.cwd();
  }

  /** Loads the fixture lazily; retries on later calls while it does not exist yet. */
  private async loadGroundTruth(): Promise<GroundTruth | null> {
    if (this.groundTruth) return this.groundTruth;
    const file = path.join(this.root(), 'fixtures', 'sample-shelf', 'ground-truth.json');
    try {
      const parsed = parseGroundTruth(JSON.parse(await fs.readFile(file, 'utf8')));
      if (parsed) this.groundTruth = parsed;
      else console.warn('[ai] mock: ground-truth.json has an unexpected shape – using the demo shelf');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn('[ai] mock: could not read ground-truth.json', { error: String(err).slice(0, 200) });
    }
    return this.groundTruth;
  }

  /** sha1 of the first 4 MiB of each sample video present in Mintavideok/ (computed once). */
  private async sampleHashes(videos: FixtureVideo[]): Promise<Map<string, string>> {
    if (this.sampleSha1) return this.sampleSha1;
    const map = new Map<string, string>();
    for (const v of videos) {
      const file = path.join(this.root(), 'Mintavideok', `${v.video}.mp4`);
      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(file, 'r');
        const buf = Buffer.alloc(SHA1_PREFIX_BYTES);
        let offset = 0;
        while (offset < buf.length) {
          const { bytesRead } = await handle.read(buf, offset, buf.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        map.set(createHash('sha1').update(buf.subarray(0, offset)).digest('hex'), v.video);
      } catch {
        // sample file not available (e.g. production image) – filename matching still works
      } finally {
        await handle?.close();
      }
    }
    this.sampleSha1 = map;
    return map;
  }

  async findFixtureVideo(ctx: Pick<VisionContext, 'originalFilename' | 'sourceSha1'>): Promise<FixtureVideo | null> {
    const gt = await this.loadGroundTruth();
    if (!gt) return null;
    const id = videoIdFromFilename(ctx.originalFilename);
    const byName = gt.videos.find((v) => v.video === id);
    if (byName) return byName;
    if (ctx.sourceSha1) {
      const hashes = await this.sampleHashes(gt.videos);
      const video = hashes.get(ctx.sourceSha1.toLowerCase());
      if (video) return gt.videos.find((v) => v.video === video) ?? null;
    }
    return null;
  }

  async readSpines(frames: VisionFrame[], ctx: VisionContext): Promise<{ observations: SpineObservation[]; usage: AiUsage }> {
    await simulateLatency(this.opts, `${ctx.videoId}:${ctx.batchIndex}:${frames.map((f) => f.frameId).join(',')}`);
    const video = await this.findFixtureVideo(ctx);
    const observations = video ? fixtureObservations(video, frames) : demoObservations(frames);
    return { observations, usage: zeroUsage(this.model) };
  }
}

/** "C:\\clips\\20260912_212903.MP4" → "20260912_212903" */
export function videoIdFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[^.]+$/, '').trim();
}

/* ------------------------------------------------------------------ */
/* Text provider                                                       */
/* ------------------------------------------------------------------ */

const HUNGARIAN_AUTHORS = [
  'jokai', 'mikszath', 'moricz', 'kosztolanyi', 'karinthy', 'marai', 'szabo magda', 'esterhazy', 'orkeny',
  'petofi', 'arany janos', 'ady', 'jozsef attila', 'radnoti', 'babits', 'gardonyi', 'molnar ferenc', 'rejto',
  'heltai', 'krudy', 'nemeth laszlo', 'kertesz imre', 'nadas', 'krasznahorkai', 'szerb antal', 'wass albert',
  'fekete istvan', 'lengyel denes', 'rath vegh', 'vaszary', 'kornis', 'erdody', 'tamasi aron', 'madach',
  'vorosmarty', 'weores', 'pilinszky', 'spiro gyorgy', 'darvasi', 'bodor adam', 'totth benedek', 'grecso',
  'moldova', 'berkesi', 'szilvasi', 'lazar ervin', 'nemes nagy', 'mandy', 'bartis', 'dragoman', 'hay janos',
];

interface Rule {
  re: RegExp;
  category: string;
}

const RULES: Rule[] = [
  { re: /\b(szakacskonyv|recept|konyha|cookbook|cooking|recipes?|suti|etelek)\b/, category: 'cooking' },
  { re: /\b(szotar|lexikon|enciklopedia|dictionary|encyclopedia|atlasz|kezikonyv)\b/, category: 'reference' },
  { re: /\b(nyelvkonyv|grammar|nyelvtan|phrasebook|tanuljunk)\b/, category: 'language_learning' },
  { re: /\b(tankonyv|textbook|feladatgyujtemeny|erettsegi)\b/, category: 'education' },
  { re: /\b(versek|osszes versei|poems|poetry|koltemenyek|antologia)\b/, category: 'poetry' },
  { re: /\b(asimov|alapitvany|galaktika|robot|dune|clarke|lem|bradbury|science fiction|sci fi|urhajo|bolygo)\b/, category: 'scifi' },
  { re: /\b(tolkien|hobbit|gyuruk ura|harry potter|fantasy|sarkany|dragon|narnia|martin)\b/, category: 'fantasy' },
  { re: /\b(krimi|gyilkossag|gyilkos|detektiv|holmes|christie|poirot|grisham|nesbo|murder|thriller|brown)\b/, category: 'crime_thriller' },
  { re: /\b(mese|mesek|mondak|mitosz|legendak|fairy tales?|myths?)\b/, category: 'folk_tales' },
  { re: /\b(eletrajz|elete|memoar|visszaemlekezes|biography|memoir|naplo|jobs|musk)\b/, category: 'biography' },
  { re: /\b(filozofia|philosophy|nietzsche|platon|kant)\b/, category: 'philosophy' },
  { re: /\b(pszichologia|psychology|lelek|tudattalan|rabeszelo)\b/, category: 'psychology' },
  { re: /\b(biblia|bible|vallas|religion|isten|buddh|spiritual)\b/, category: 'religion' },
  { re: /\b(tortenelem|history|haboru|war|csata|birodalom|forradalom|romai|kozepkor)\b/, category: 'history' },
  { re: /\b(fizika|kemia|biologia|matematika|relativitas|evolucio|physics|science|agy|genetika|immunologia|kozmosz)\b/, category: 'science' },
  { re: /\b(madarai|novenyek|allatok|termeszet|nature|foldrajz|geography)\b/, category: 'nature' },
  { re: /\b(programozas|computer|szamitogep|informatika|software|internet|digital)\b/, category: 'technology' },
  { re: /\b(kozgazdasag|economics|business|uzlet|marketing|penz|capital|toke|mikrookonomia)\b/, category: 'business_economics' },
  { re: /\b(utazas|travel|utikonyv|kalauz)\b/, category: 'travel' },
  { re: /\b(festeszet|muveszet|art|cezanne|gauguin|leonardo|festo)\b/, category: 'art' },
  { re: /\b(zene|music|mozart|beethoven|opera)\b/, category: 'music' },
  { re: /\b(film|mozi|szinhaz|fellini|spielberg|cinema|theatre)\b/, category: 'film_theatre' },
  { re: /\b(drama|dramak|tragedia|szinmu|plays?|shakespeare)\b/, category: 'drama' },
  { re: /\b(novellak|elbeszelesek|short stories|stories|tortenetek)\b/, category: 'short_stories' },
  { re: /\b(humor|szatira|parodia|rejto)\b/, category: 'humor' },
  { re: /\b(egeszseg|dieta|joga|health|fitness)\b/, category: 'health_lifestyle' },
  { re: /\b(ferrante|regeny|novel|austen|tolsztoj|dosztojevszkij|rushdie|marquez|fitzgerald|dickens)\b/, category: 'literary_fiction' },
];

/** Very rough edition-language guess for the mock: Hungarian letters first, then stop words. */
export function guessLanguage(text: string): string | null {
  if (/[áéíóöőúüű]/i.test(text)) return 'hu';
  if (/\b(the|and|of|to|in|with|my|your|a|an)\b/i.test(text)) return 'en';
  if (/\b(az|egy|es|hogy)\b/i.test(text)) return 'hu';
  return null;
}

export function mockClassify(book: BookForClassification): BookClassification {
  const raw = [book.author, book.title, book.spineAuthor, book.spineTitle, book.publisher].filter(Boolean).join(' ');
  const folded = foldLoose(raw);
  const foldedAuthor = foldLoose(book.author ?? book.spineAuthor);
  const hungarianAuthor = foldedAuthor.length > 0 && HUNGARIAN_AUTHORS.some((a) => foldedAuthor.includes(a));

  let category = RULES.find((r) => r.re.test(folded))?.category ?? null;
  if (!category) category = hungarianAuthor ? 'hungarian_literature' : 'other';

  const topics: string[] = [];
  const fictionish = ['literary_fiction', 'crime_thriller', 'scifi', 'fantasy', 'poetry', 'drama', 'short_stories', 'humor', 'historical_fiction'];
  if (hungarianAuthor && category !== 'hungarian_literature' && fictionish.includes(category)) topics.push('hungarian_literature');
  const secondary = RULES.filter((r) => r.category !== category && !topics.includes(r.category) && r.re.test(folded));
  for (const r of secondary) {
    if (topics.length >= 3) break;
    topics.push(r.category);
  }

  const titleText = `${book.title} ${book.spineTitle ?? ''}`;
  const language = guessLanguage(titleText) ?? (hungarianAuthor ? 'hu' : null);

  return {
    id: book.id,
    category,
    topics,
    author: null,
    originalTitle: null,
    language,
    originalLanguage: hungarianAuthor ? 'hu' : null,
    authorCountry: hungarianAuthor ? 'HU' : null,
    firstPublishedYear: null,
    descriptionHu: null,
    descriptionEn: null,
  };
}

const NUMBER_TOKENS = /\b(\d+|[ivxlc]+)\b/g;

/** Mock duplicate judgement: similar titles, compatible authors and identical volume numbers. */
export function mockSameBook(a: DuplicateQuestion['a'], b: DuplicateQuestion['b']): boolean {
  const numsA = (foldLoose(a.title).match(NUMBER_TOKENS) ?? []).join(' ');
  const numsB = (foldLoose(b.title).match(NUMBER_TOKENS) ?? []).join(' ');
  if (numsA !== numsB) return false;
  try {
    return titleSimilarity(a.title, b.title) >= 0.75 && authorsCompatible(a.author, b.author);
  } catch {
    // text helpers not available: exact folded comparison
    const ta = foldLoose(a.title);
    const tb = foldLoose(b.title);
    if (!ta || ta !== tb) return false;
    const aa = foldLoose(a.author);
    const ab = foldLoose(b.author);
    return !aa || !ab || aa === ab;
  }
}

export class MockTextProvider implements TextProvider {
  readonly name = 'mock' as const;
  readonly model = MOCK_TEXT_MODEL;
  private readonly opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
  }

  async classifyBooks(
    books: BookForClassification[],
    ctx: { locale: 'hu' | 'en' },
  ): Promise<{ results: BookClassification[]; usage: AiUsage }> {
    void ctx;
    await simulateLatency(this.opts, `classify:${books.map((b) => b.id).join(',')}`);
    const seen = new Set<string>();
    const results: BookClassification[] = [];
    for (const b of books) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      results.push(mockClassify(b));
    }
    return { results, usage: zeroUsage(this.model) };
  }

  async judgeDuplicates(questions: DuplicateQuestion[]): Promise<{ same: Record<string, boolean>; usage: AiUsage }> {
    await simulateLatency(this.opts, `dupes:${questions.map((q) => q.id).join(',')}`);
    const same: Record<string, boolean> = {};
    for (const q of questions) if (!(q.id in same)) same[q.id] = mockSameBook(q.a, q.b);
    return { same, usage: zeroUsage(this.model) };
  }
}

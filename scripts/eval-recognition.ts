/**
 * Recognition evaluation against the verified sample-shelf ground truth (SPEC §8).
 *
 * Runs the REAL pipeline (probe → frames → vision → merge → crops, `processVideo`) on the sample
 * clips in Mintavideok/ with the configured AI provider, one temporary collection per clip, and
 * compares the resulting books with fixtures/sample-shelf/ground-truth.json:
 *   precision  = predicted books that match a ground-truth book / predicted books
 *   recall     = ground-truth books found / ground-truth books (also for "clear" spines only)
 *   exact title = matched books whose title equals the spine or canonical title
 *                (case, punctuation and spacing ignored, accents significant)
 *
 * Usage (from the project root; .env.local / .env are loaded automatically):
 *   npm run eval:recognition -- [--provider auto|mock|deepseek|anthropic] [--videos 20260912_212903,...]
 *                               [--keep] [--out report.json]
 *
 *   --provider  overrides AI_PROVIDER + AI_TEXT_PROVIDER for this run ("mock" sets AI_MOCK=true);
 *               without it the normal resolution applies (AI_MOCK, AI_PROVIDER, available API keys)
 *   --videos    comma-separated ground-truth video ids (default: all five sample clips)
 *   --keep      keep the temporary collections (printed as /<id>) instead of deleting them
 *   --out       also write the full JSON report (per-video pairs, misses, spurious books, usage)
 *
 * Examples:
 *   AI_MOCK=true npm run eval:recognition                      (bash; PowerShell: $env:AI_MOCK='true'; npm run eval:recognition)
 *   npm run eval:recognition -- --provider mock                  pipeline smoke test, no API calls
 *   npm run eval:recognition -- --provider deepseek --videos 20260912_213052 --out eval.json
 *
 * Expected results: the mock provider replays the fixture, so it scores precision 100 %, exact titles
 * 100 % and recall 156/158 = 98.7 % – the two ground-truth spines with only an author legible
 * (empty title) are dropped by merge by design. Reference run with deepseek-flash (2026-09-13, all
 * five clips, 5 min 15 s): precision 54.4 %, recall 70.3 % (clear spines 79.0 %), exact titles 88.3 %.
 * With spine recognition (SPINE_RECOGNITION=auto, 2026-09-16, deepseek-flash, 2 min 50 s): precision 77.7 %,
 * recall 68.4 % (clear spines 81.5 %), exact titles 93.5 % – compare with SPINE_RECOGNITION=off.
 *
 * Needs the database (DATABASE_URL, migrations applied) and ffmpeg/ffprobe; the sample clips are
 * copied into STORAGE_DIR for processing. Temporary collections (ids 900000000–999999999, owner
 * hash "eval-recognition") and their files are deleted afterwards unless --keep.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorsCompatible, titleSimilarity } from '@/lib/pipeline/text';

/* ------------------------------------------------------------------ */
/* Scoring (pure)                                                      */
/* ------------------------------------------------------------------ */

export interface GroundTruthBook {
  author: string | null;
  title: string;
  canonical_author?: string | null;
  canonical_title?: string | null;
  legibility?: string;
}

export interface PredictedBook {
  title: string;
  author: string | null;
  spineTitle?: string | null;
  spineAuthor?: string | null;
}

export interface MatchPair {
  gt: string;
  predicted: string;
  similarity: number;
  exactTitle: boolean;
}

export interface VideoScore {
  gtCount: number;
  gtClearCount: number;
  predictedCount: number;
  matched: number;
  matchedClear: number;
  exactTitles: number;
  precision: number;
  recall: number;
  recallClear: number;
  exactTitleRate: number;
  pairs: MatchPair[];
  missed: string[];
  spurious: string[];
}

export const MATCH_THRESHOLD = 0.8;

/** lower-case NFC, punctuation → space, whitespace collapsed; accents are kept */
export function exactTitleKey(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('hu')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const nonEmpty = (xs: Array<string | null | undefined>): string[] =>
  [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];

function pairSimilarity(g: GroundTruthBook, p: PredictedBook): number {
  const gAuthors = nonEmpty([g.author, g.canonical_author]);
  const pAuthors = nonEmpty([p.author, p.spineAuthor]);
  if (gAuthors.length > 0 && pAuthors.length > 0 && !gAuthors.some((a) => pAuthors.some((b) => authorsCompatible(a, b)))) return 0;
  let best = 0;
  for (const gt of nonEmpty([g.title, g.canonical_title])) {
    for (const pt of nonEmpty([p.title, p.spineTitle])) best = Math.max(best, titleSimilarity(gt, pt));
  }
  return best;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
const describeGt = (g: GroundTruthBook) => `${g.author ?? '?'} – ${g.title}`;
const describePred = (p: PredictedBook) => `${p.author ?? '?'} – ${p.title}`;

/** Greedy one-to-one matching by descending similarity (≥ MATCH_THRESHOLD, authors compatible). */
export function scoreVideo(gt: GroundTruthBook[], predicted: PredictedBook[]): VideoScore {
  const candidates: Array<{ gi: number; pi: number; sim: number }> = [];
  gt.forEach((g, gi) =>
    predicted.forEach((p, pi) => {
      const sim = pairSimilarity(g, p);
      if (sim >= MATCH_THRESHOLD) candidates.push({ gi, pi, sim });
    }),
  );
  candidates.sort((a, b) => b.sim - a.sim || a.gi - b.gi || a.pi - b.pi);
  const gtUsed = new Set<number>();
  const predUsed = new Set<number>();
  const pairs: MatchPair[] = [];
  let matchedClear = 0;
  let exactTitles = 0;
  for (const c of candidates) {
    if (gtUsed.has(c.gi) || predUsed.has(c.pi)) continue;
    gtUsed.add(c.gi);
    predUsed.add(c.pi);
    const g = gt[c.gi];
    const p = predicted[c.pi];
    const exact = nonEmpty([g.title, g.canonical_title]).map(exactTitleKey).includes(exactTitleKey(p.title));
    if (exact) exactTitles++;
    if (g.legibility === 'clear') matchedClear++;
    pairs.push({ gt: describeGt(g), predicted: describePred(p), similarity: Math.round(c.sim * 1000) / 1000, exactTitle: exact });
  }
  const gtClearCount = gt.filter((g) => g.legibility === 'clear').length;
  return {
    gtCount: gt.length,
    gtClearCount,
    predictedCount: predicted.length,
    matched: pairs.length,
    matchedClear,
    exactTitles,
    precision: ratio(pairs.length, predicted.length),
    recall: ratio(pairs.length, gt.length),
    recallClear: ratio(matchedClear, gtClearCount),
    exactTitleRate: ratio(exactTitles, pairs.length),
    pairs,
    missed: gt.filter((_, i) => !gtUsed.has(i)).map(describeGt),
    spurious: predicted.filter((_, i) => !predUsed.has(i)).map(describePred),
  };
}

/** Micro-averaged totals over several videos. */
export function totalScore(scores: VideoScore[]) {
  const sum = (k: 'gtCount' | 'gtClearCount' | 'predictedCount' | 'matched' | 'matchedClear' | 'exactTitles') =>
    scores.reduce((acc, s) => acc + s[k], 0);
  return {
    gtCount: sum('gtCount'),
    predictedCount: sum('predictedCount'),
    matched: sum('matched'),
    precision: ratio(sum('matched'), sum('predictedCount')),
    recall: ratio(sum('matched'), sum('gtCount')),
    recallClear: ratio(sum('matchedClear'), sum('gtClearCount')),
    exactTitleRate: ratio(sum('exactTitles'), sum('matched')),
  };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

interface CliOptions {
  provider: string | null;
  videos: string[] | null;
  keep: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { provider: null, videos: null, keep: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--provider') opts.provider = value().toLowerCase();
    else if (a === '--videos') opts.videos = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--keep') opts.keep = true;
    else if (a === '--out') opts.out = value();
    else if (a === '--help' || a === '-h') {
      console.log('npm run eval:recognition -- [--provider auto|mock|deepseek|anthropic] [--videos id1,id2] [--keep] [--out report.json]');
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (opts.provider && !['auto', 'mock', 'deepseek', 'anthropic'].includes(opts.provider)) {
    throw new Error(`--provider must be auto, mock, deepseek or anthropic`);
  }
  return opts;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
  const opts = parseArgs(process.argv.slice(2));
  if (opts.provider) {
    process.env.AI_MOCK = opts.provider === 'mock' ? 'true' : 'false';
    process.env.AI_PROVIDER = opts.provider;
    process.env.AI_TEXT_PROVIDER = opts.provider;
  }

  // modules that read env() are imported only after the environment is prepared
  const { eq } = await import('drizzle-orm');
  const { db, pool } = await import('@/db');
  const { books, collections, videos } = await import('@/db/schema');
  const { abs, ensureDirFor, rel, removeCollectionFiles } = await import('@/lib/storage');
  const { processVideo } = await import('@/lib/pipeline/process-video');
  const { getVisionProvider } = await import('@/lib/ai');

  const gtRaw = JSON.parse(await fs.readFile(path.join('fixtures', 'sample-shelf', 'ground-truth.json'), 'utf8')) as {
    videos: Array<{ video: string; books: GroundTruthBook[] }>;
  };
  const selected = gtRaw.videos.filter((v) => !opts.videos || opts.videos.includes(v.video));
  if (selected.length === 0) throw new Error('no matching videos in the ground truth');

  const vision = getVisionProvider();
  console.info(`[eval] provider ${vision.name} (${vision.model}), ${selected.length} video(s)`);

  const report: Array<{ video: string; seconds: number; status: string; usage: unknown; score: VideoScore }> = [];
  try {
    for (const v of selected) {
      const source = path.join('Mintavideok', `${v.video}.mp4`);
      const stat = await fs.stat(source);
      let collectionId = '';
      for (let attempt = 0; attempt < 10 && !collectionId; attempt++) {
        const candidate = String(900_000_000 + Math.floor(Math.random() * 99_999_999));
        const clash = await db().select({ id: collections.id }).from(collections).where(eq(collections.id, candidate));
        if (clash.length === 0) collectionId = candidate;
      }
      if (!collectionId) throw new Error('could not allocate a collection id');
      const videoId = randomUUID();
      const storagePath = rel.upload(collectionId, videoId, '.mp4');
      try {
        await db().insert(collections).values({ id: collectionId, ownerTokenHash: 'eval-recognition', title: `eval ${v.video}`, status: 'processing' });
        await fs.copyFile(source, await ensureDirFor(storagePath));
        await db().insert(videos).values({
          id: videoId,
          collectionId,
          kind: 'video',
          sortOrder: 0,
          originalFilename: `${v.video}.mp4`,
          mimeType: 'video/mp4',
          sizeBytes: stat.size,
          bytesReceived: stat.size,
          uploadStatus: 'uploaded',
          storagePath,
          status: 'queued',
        });

        const t0 = Date.now();
        const result = await processVideo(videoId);
        const seconds = (Date.now() - t0) / 1000;
        const rows = await db()
          .select({ title: books.title, author: books.author, spineTitle: books.spineTitle, spineAuthor: books.spineAuthor })
          .from(books)
          .where(eq(books.collectionId, collectionId));
        const [col] = await db().select({ usage: collections.usage }).from(collections).where(eq(collections.id, collectionId));
        const score = scoreVideo(v.books, rows);
        report.push({ video: v.video, seconds, status: result.status, usage: col?.usage ?? null, score });

        console.info(
          `[eval] ${v.video}: ${result.status} in ${seconds.toFixed(1)} s – books ${score.predictedCount} / truth ${score.gtCount}, ` +
            `precision ${pct(score.precision)}, recall ${pct(score.recall)} (clear ${pct(score.recallClear)}), exact titles ${pct(score.exactTitleRate)}`,
        );
        for (const p of score.pairs.filter((x) => !x.exactTitle)) console.info(`    ~ ${p.gt}  ⇐  ${p.predicted} (${p.similarity})`);
        for (const m of score.missed) console.info(`    - missed: ${m}`);
        for (const s of score.spurious) console.info(`    + spurious: ${s}`);
        if (opts.keep) console.info(`    kept collection /${collectionId}`);
      } finally {
        if (!opts.keep) {
          await db().delete(collections).where(eq(collections.id, collectionId));
          await removeCollectionFiles(collectionId);
          await fs.rm(path.dirname(abs(storagePath)), { recursive: true, force: true });
        }
      }
    }

    const total = totalScore(report.map((r) => r.score));
    console.info(
      `[eval] TOTAL books ${total.predictedCount} / truth ${total.gtCount}: precision ${pct(total.precision)}, recall ${pct(total.recall)} ` +
        `(clear ${pct(total.recallClear)}), exact titles ${pct(total.exactTitleRate)}`,
    );
    if (opts.out) {
      await fs.writeFile(opts.out, JSON.stringify({ provider: vision.name, model: vision.model, total, videos: report }, null, 2));
      console.info(`[eval] report written to ${opts.out}`);
    }
  } finally {
    await pool().end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error('[eval] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

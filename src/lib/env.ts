/**
 * Server-side configuration. Import only from server code (API routes, worker, lib).
 * All values come from environment variables – see .env.example.
 * (No `server-only` import: the tsx worker shares this module.)
 */
import path from 'node:path';
import { z } from 'zod';
import type { AiProviderName } from './types';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int());
const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));
const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const schema = z.object({
  NODE_ENV: str('development'),
  DATABASE_URL: str('postgres://postgres:postgres@localhost:5432/exlibris'),
  /** public base URL without trailing slash, e.g. https://www.exlibrisvideo.hu */
  APP_URL: str('http://localhost:3000'),
  STORAGE_DIR: str('./storage'),
  /** secret for signing access cookies (PIN unlock) – long random string in production */
  APP_SECRET: str('dev-secret-change-me-please-0123456789'),

  // --- AI providers ---
  /** 'auto' → anthropic if ANTHROPIC_API_KEY, else deepseek if DEEPSEEK_API_KEY, else mock */
  AI_PROVIDER: str('auto'),
  /** optional override for text-only steps (merge/classify); defaults to AI_PROVIDER resolution */
  AI_TEXT_PROVIDER: str('auto'),
  AI_MOCK: bool(false),
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_VISION_MODEL: str('claude-opus-5'),
  ANTHROPIC_TEXT_MODEL: str('claude-opus-5'),
  /** effort for vision calls: low | medium | high | xhigh | max */
  ANTHROPIC_VISION_EFFORT: str('medium'),
  ANTHROPIC_TEXT_EFFORT: str('low'),
  DEEPSEEK_API_KEY: optStr,
  DEEPSEEK_BASE_URL: str('https://api.deepseek.com'),
  DEEPSEEK_VISION_MODEL: str('deepseek-flash'),
  DEEPSEEK_TEXT_MODEL: str('deepseek-flash'),

  // --- video pipeline ---
  FFMPEG_PATH: str('ffmpeg'),
  FFPROBE_PATH: str('ffprobe'),
  /** candidate frames sampled per second before sharpness/dup filtering (ground truth: ≥ 6 needed for fast pans) */
  FRAME_SAMPLE_FPS: int(8),
  /** keep the sharpest candidate per window of this many seconds (0.33 s ≈ 3 key frames/s) */
  KEYFRAME_WINDOW_SEC: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0.33 : Number.parseFloat(v)))
    .pipe(z.number().positive()),
  /** max key frames analysed per video (cost cap) */
  MAX_FRAMES_PER_VIDEO: int(120),
  /** long edge of analysed frames in px (Claude Opus 5 accepts up to 2576) */
  FRAME_MAX_EDGE: int(1920),
  /** frames per vision request (consecutive, overlapping by 1) */
  VISION_BATCH_SIZE: int(4),
  VISION_CONCURRENCY: int(2),
  /** delete the uploaded source video after successful processing (frames + spine crops are kept) */
  DELETE_SOURCE_AFTER_PROCESSING: bool(true),

  // --- limits ---
  MAX_UPLOAD_MB: int(1024),
  MAX_VIDEO_SECONDS: int(600),
  MAX_SOURCES_PER_COLLECTION: int(30),
  MAX_BOOKS_PER_COLLECTION: int(5000),
  UPLOAD_CHUNK_MB: int(8),
  RATE_COLLECTIONS_PER_IP_DAY: int(20),
  RATE_UPLOADS_PER_IP_HOUR: int(60),
  RATE_EMAILS_PER_COLLECTION_DAY: int(5),

  // --- enrichment ---
  ENRICH_COVERS: bool(true),
  GOOGLE_BOOKS_API_KEY: optStr,

  // --- email ---
  /** smtp | resend | console */
  EMAIL_PROVIDER: str('console'),
  EMAIL_FROM: str('Ex Libris Video <hello@exlibrisvideo.hu>'),
  SMTP_HOST: optStr,
  SMTP_PORT: int(587),
  SMTP_USER: optStr,
  SMTP_PASS: optStr,
  SMTP_SECURE: bool(false),
  RESEND_API_KEY: optStr,

  // --- worker ---
  WORKER_POLL_MS: int(1500),
  WORKER_CONCURRENCY: int(2),
  /** graceful-stop wait before running jobs are aborted and re-queued; must stay below the orchestrator's
   *  kill timeout (Coolify: `docker stop -t 30`) minus the 5 s abort grace */
  WORKER_SHUTDOWN_GRACE_MS: int(20_000),
  /** a running job whose heartbeat (every 60 s) is older than this is considered orphaned and re-queued */
  WORKER_STALE_JOB_MS: int(5 * 60_000),
  /** days after which untouched empty draft collections are purged */
  DRAFT_RETENTION_DAYS: int(7),

  // --- admin ---
  ADMIN_PASSWORD: optStr,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error('Invalid environment configuration: ' + JSON.stringify(parsed.error.issues));
    }
    cached = parsed.data;
  }
  return cached;
}

export function storageRoot(): string {
  return path.resolve(env().STORAGE_DIR);
}

export function publicCollectionUrl(id: string): string {
  return `${env().APP_URL.replace(/\/$/, '')}/${id}`;
}

/** Resolve which AI provider to use for vision (spine reading) steps. */
export function resolveVisionProvider(): AiProviderName {
  const e = env();
  if (e.AI_MOCK) return 'mock';
  const p = e.AI_PROVIDER.toLowerCase();
  if (p === 'anthropic' || p === 'deepseek' || p === 'mock') return p;
  if (e.ANTHROPIC_API_KEY) return 'anthropic';
  if (e.DEEPSEEK_API_KEY) return 'deepseek';
  return 'mock';
}

/** Resolve which AI provider to use for text-only steps (merge, classification). */
export function resolveTextProvider(): AiProviderName {
  const e = env();
  if (e.AI_MOCK) return 'mock';
  const p = e.AI_TEXT_PROVIDER.toLowerCase();
  if (p === 'anthropic' || p === 'deepseek' || p === 'mock') return p;
  return resolveVisionProvider();
}

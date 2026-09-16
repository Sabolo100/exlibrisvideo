/**
 * The server's upload limits as the browser sees them (MAX_UPLOAD_MB, MAX_SOURCES_PER_COLLECTION and
 * MAX_VIDEO_SECONDS of @/lib/env). Server Components read them with serverUploadLimits() (./server-limits) and
 * pass them down; client code without such a prop loads them from GET /api/config (useUploadLimits in ./hooks).
 * The defaults mirror the env defaults and are only used until the real values are known. Pure – unit tested.
 */
import type { Translator } from '@/i18n';
import type { Locale } from '@/lib/types';
import { formatBytes } from './format';

export interface UploadLimits {
  /** MAX_UPLOAD_MB: largest accepted file in MiB */
  maxUploadMb: number;
  /** MAX_SOURCES_PER_COLLECTION: videos and photos per collection */
  maxSourcesPerCollection: number;
  /** MAX_VIDEO_SECONDS: longest video the pipeline processes */
  maxVideoSeconds: number;
}

export const DEFAULT_UPLOAD_LIMITS: Readonly<UploadLimits> = Object.freeze({
  maxUploadMb: 1024,
  maxSourcesPerCollection: 30,
  maxVideoSeconds: 600,
});

/** Public endpoint answering with an UploadLimits JSON object. */
export const UPLOAD_LIMITS_URL = '/api/config';

const MiB = 1024 * 1024;

/** Largest accepted file in bytes (the API also compares against MAX_UPLOAD_MB × 1 MiB). */
export function maxUploadBytes(limits: Pick<UploadLimits, 'maxUploadMb'>): number {
  return limits.maxUploadMb * MiB;
}

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Validated limits from an untrusted JSON value (null when a field is missing or not a positive integer). */
export function parseUploadLimits(value: unknown): UploadLimits | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!positiveInt(v.maxUploadMb) || !positiveInt(v.maxSourcesPerCollection) || !positiveInt(v.maxVideoSeconds)) return null;
  return { maxUploadMb: v.maxUploadMb, maxSourcesPerCollection: v.maxSourcesPerCollection, maxVideoSeconds: v.maxVideoSeconds };
}

/** "1 GB" · "500 MB" – the per-file size limit. */
export function formatUploadLimit(limits: Pick<UploadLimits, 'maxUploadMb'>, locale: Locale): string {
  return formatBytes(maxUploadBytes(limits), locale);
}

/** "10 perc" / "10 minutes" for whole minutes, otherwise "90 másodperc" / "90 seconds". */
export function formatVideoLimit(limits: Pick<UploadLimits, 'maxVideoSeconds'>, tp: Translator['tp']): string {
  const s = limits.maxVideoSeconds;
  return s % 60 === 0 ? tp('upload.limit.minutes', s / 60) : tp('upload.limit.seconds', s);
}

/** Values for texts quoting every limit: {maxSize} "1 GB", {maxFiles} "30", {maxDuration} "10 perc". */
export function uploadLimitVars(
  limits: UploadLimits,
  tr: Pick<Translator, 'locale' | 'n' | 'tp'>,
): { maxSize: string; maxFiles: string; maxDuration: string } {
  return {
    maxSize: formatUploadLimit(limits, tr.locale),
    maxFiles: tr.n(limits.maxSourcesPerCollection),
    maxDuration: formatVideoLimit(limits, tr.tp),
  };
}

/** The limits reported by GET /api/config, loaded at most once at a time and shared by every subscriber. */
export interface UploadLimitsSource {
  subscribe(listener: () => void): () => void;
  /** null until the server answered */
  get(): UploadLimits | null;
  /** fetches the limits unless they are known; a failed attempt leaves them unknown (the next call retries) */
  load(): Promise<UploadLimits | null>;
}

export function createUploadLimitsSource(request: () => Promise<Pick<Response, 'ok' | 'json'>>): UploadLimitsSource {
  let value: UploadLimits | null = null;
  let inflight: Promise<UploadLimits | null> | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => value,
    load() {
      if (value) return Promise.resolve(value);
      if (inflight) return inflight;
      const attempt = (async () => {
        try {
          const res = await request();
          const parsed = res.ok ? parseUploadLimits(await res.json()) : null;
          if (parsed) {
            value = parsed;
            for (const l of [...listeners]) l();
          }
          return parsed;
        } catch {
          // offline / proxy error page: keep the defaults, the API re-validates every upload anyway
          return null;
        }
      })();
      inflight = attempt;
      void attempt.finally(() => {
        if (inflight === attempt) inflight = null;
      });
      return attempt;
    },
  };
}

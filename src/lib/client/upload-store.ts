/**
 * Module-level upload manager (owner: frontend-landing). Client-only, framework-agnostic.
 *
 * It lives outside React so uploads keep running across client-side navigation (landing → /<id>):
 *
 *   enqueue(collectionId, files) → per-collection queue, MAX_PARALLEL files at a time
 *     init   POST /api/collections/:id/uploads            (or resume a known videoId via GET /api/uploads/:videoId)
 *     chunks PUT  /api/uploads/:videoId?offset=n           sequential, InitUploadResponse.chunkSize bytes each
 *            - every chunk is retried up to MAX_RETRIES times with exponential back-off (+ jitter)
 *            - 409 conflict → re-sync to details.bytesReceived (the server is the source of truth)
 *            - offline → waits for the `online` event without spending the retry budget
 *     done   POST /api/uploads/:videoId/complete           (idempotent; 409 upload_incomplete → resume)
 *   pause / resume / retry / cancel / remove (DELETE /api/uploads/:videoId)
 *
 * React: `useSyncExternalStore(uploadStore.subscribe, uploadStore.getSnapshot, uploadStore.getServerSnapshot)`.
 * The snapshot is immutable and only replaced when something changes.
 */
import { api as defaultApi, ApiClientError } from '@/lib/client/api';
import { releaseStableCopy, stableCopyError, stableCopyKind } from '@/lib/client/stable-files';
import type { InitUploadResponse, SourceKind, VideoDTO } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Public types                                                         */
/* ------------------------------------------------------------------ */

export type UploadItemStatus = 'queued' | 'uploading' | 'paused' | 'finalizing' | 'done' | 'error' | 'canceled';

/**
 * Machine-readable reason of a failed upload. API codes / reasons (`unsupported`, `too_large`,
 * `too_many_sources`, `rate_limited`, `forbidden`, `not_found`, `upload_closed` …) are passed through;
 * `network` means the retries were exhausted.
 */
export type UploadErrorCode = string;

export interface UploadItem {
  /** stable client id (React key) */
  localId: string;
  collectionId: string;
  /** server id once the upload was initialised */
  videoId?: string;
  name: string;
  size: number;
  mimeType: string;
  kind: SourceKind;
  lastModified: number;
  /** bytes confirmed by the server */
  bytesSent: number;
  status: UploadItemStatus;
  /** human readable (server-localized) message when available */
  error?: string;
  errorCode?: UploadErrorCode;
  /** a transient failure is being retried */
  retry?: { attempt: number; max: number; at: number } | null;
  /** waiting for the network to come back */
  offline?: boolean;
  /** smoothed throughput in bytes / second (null until the first chunk finished) */
  speed?: number | null;
  /** the chunk currently on the wire (for smooth progress estimates between chunk confirmations) */
  inFlight?: { offset: number; bytes: number; startedAt: number } | null;
  addedAt: number;
  finishedAt?: number;
  /** VideoDTO returned by the complete call */
  video?: VideoDTO;
}

/** A draft collection created by the landing-page uploader (kept here so it survives navigation). */
export interface UploadDraft {
  collectionId: string;
  ownerToken: string;
  publicUrl: string;
  ownerUrl: string;
  /** the optional fields as last sent to the API (to PATCH only what changed) */
  sent: { title: string; ownerName: string; email: string };
  createdAt: number;
}

export interface UploadStoreState {
  items: readonly UploadItem[];
  draft: UploadDraft | null;
}

/** An unfinished server-side upload that a re-selected file (same name + size) may continue. */
export interface ResumableUpload {
  videoId: string;
  name: string;
  size: number;
}

export type UploadApi = Pick<
  typeof defaultApi,
  'initUpload' | 'getUpload' | 'putChunk' | 'completeUpload' | 'deleteUpload'
> &
  Partial<Pick<typeof defaultApi, 'reportUploadFailure'>>;

export interface UploadEnvironment {
  isOnline(): boolean;
  /** subscribe to the browser's `online` event */
  onOnline(listener: () => void): () => void;
  /** show the "leave site?" prompt while `shouldWarn()` is true */
  installUnloadGuard(shouldWarn: () => boolean): void;
  now(): number;
  /** resolves after `ms`, rejects with an AbortError when the signal aborts */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
}

export interface UploadStoreOptions {
  api?: UploadApi;
  env?: Partial<UploadEnvironment>;
  maxParallel?: number;
  maxRetries?: number;
  /** used for resumed uploads whose chunk size is unknown (the server default) */
  defaultChunkSize?: number;
}

export interface UploadStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UploadStoreState;
  getServerSnapshot(): UploadStoreState;
  /** adds files to the collection's queue and starts uploading; returns the created items */
  enqueue(collectionId: string, files: readonly File[], opts?: { resumable?: readonly ResumableUpload[] }): UploadItem[];
  pause(localId: string): void;
  /** paused or failed item → back into the queue (continues where the server left off) */
  resume(localId: string): void;
  retry(localId: string): void;
  /** stops the upload and deletes the server-side source */
  cancel(localId: string): Promise<void>;
  /** cancel (when unfinished) and drop from the list; finished items are only hidden, never deleted */
  remove(localId: string): Promise<void>;
  /** drops done / canceled items (of one collection) from the list */
  clearFinished(collectionId?: string): void;
  getFile(localId: string): File | undefined;
  /** queued, uploading, finalizing or paused items exist (optionally for one collection) */
  hasActive(collectionId?: string): boolean;
  /** called once per item when its upload completed and processing was queued */
  onUploaded(listener: (item: UploadItem) => void): () => void;
  setDraft(draft: UploadDraft | null): void;
  updateDraftSent(sent: UploadDraft['sent']): void;
}

/* ------------------------------------------------------------------ */
/* Constants & pure helpers                                             */
/* ------------------------------------------------------------------ */

const MiB = 1024 * 1024;
export const MAX_PARALLEL_UPLOADS = 2;
export const MAX_CHUNK_RETRIES = 5;
export const DEFAULT_CHUNK_SIZE = 8 * MiB;
/**
 * Reverse proxies cut long requests (Coolify's Traefik ends a request after 60 s) and the server drops a
 * chunk that did not arrive completely – so on a slow uplink a fixed 8 MiB chunk never gets through.
 * Chunks are sized from the measured upload speed to take about this long.
 */
export const CHUNK_TARGET_SECONDS = 15;
/** first chunk before any speed is known */
export const START_CHUNK_BYTES = 1 * MiB;
/** smallest adaptive chunk (unless the server allows even less) */
export const MIN_CHUNK_BYTES = 256 * 1024;
/** consecutive offset re-syncs without progress before giving up (guards against ping-pong loops) */
const MAX_RESYNCS = 12;
/** failed reads of the same slice of the picked file before giving up */
const MAX_READ_RETRIES = 2;
/** outcomes the user can act on without our help: not reported to the server log */
const UNREPORTED_CODES = new Set(['unsupported', 'too_large', 'too_many_sources', 'rate_limited', 'forbidden', 'not_found']);
/** complete → "incomplete" → resume loops */
const MAX_COMPLETE_ROUNDS = 4;

const EMPTY_STATE: UploadStoreState = Object.freeze({ items: Object.freeze([]) as readonly UploadItem[], draft: null });

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  gif: 'image/gif',
};

const UNKNOWN_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

/**
 * Size of the next chunk: about CHUNK_TARGET_SECONDS worth of bytes at the measured speed, never above
 * the server's limit (`maxChunk`) or the current `ceiling` (halved after a failed chunk). Pure.
 */
export function nextChunkSize(opts: { speed: number | null | undefined; maxChunk: number; ceiling: number }): number {
  const hardMax = Math.max(1, Math.floor(Math.min(opts.maxChunk, opts.ceiling)));
  const floor = Math.min(MIN_CHUNK_BYTES, hardMax);
  if (!opts.speed || !(opts.speed > 0)) return Math.min(START_CHUNK_BYTES, hardMax);
  const ideal = Math.floor((opts.speed * CHUNK_TARGET_SECONDS) / MIN_CHUNK_BYTES) * MIN_CHUNK_BYTES;
  return Math.min(hardMax, Math.max(floor, ideal));
}

/**
 * Copies one slice of the picked file into memory. Chrome on Android refuses to stream a slice of a gallery /
 * photo-picker file straight into a request ("Failed to fetch", ERR_UPLOAD_FILE_CHANGED) while it reads the
 * same bytes without complaint – so every chunk goes out as an in-memory Blob, like an in-app recording does.
 */
export async function readChunk(file: Blob, offset: number, bytes: number): Promise<Blob> {
  const buffer = await file.slice(offset, offset + bytes).arrayBuffer();
  return new Blob([buffer], { type: 'application/octet-stream' });
}

/** "Name: message" of a low-level failure, for the diagnostics report only (never shown in the UI). */
export function errorDetail(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  if (typeof err === 'object' && 'name' in err && 'message' in err) {
    return `${String((err as Error).name)}: ${String((err as Error).message)}`.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

export function fileExtension(name: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
}

/** The declared MIME type, or the one implied by the extension when the browser reported none. */
export function inferUploadMime(file: { name: string; type: string }): string {
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (!UNKNOWN_MIME.has(declared)) return declared;
  return MIME_BY_EXT[fileExtension(file.name)] ?? (declared || 'application/octet-stream');
}

export function sourceKindOfMime(mime: string): SourceKind {
  return mime.startsWith('image/') ? 'image' : 'video';
}

/** Identity of a picked file, used to skip duplicates. */
export function fileKey(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

export function isActiveStatus(status: UploadItemStatus): boolean {
  return status === 'queued' || status === 'uploading' || status === 'finalizing' || status === 'paused';
}

export function isFinishedStatus(status: UploadItemStatus): boolean {
  return status === 'done' || status === 'canceled';
}

/**
 * Estimated bytes on the server right now: confirmed bytes plus the share of the chunk on the wire
 * implied by the measured speed (never more than 95 % of that chunk). Pure – for smooth progress bars.
 */
export function estimateBytesSent(item: Pick<UploadItem, 'bytesSent' | 'speed' | 'inFlight' | 'size' | 'status'>, now: number): number {
  if (item.status === 'done' || item.status === 'finalizing') return item.size;
  const f = item.inFlight;
  if (item.status !== 'uploading' || !f || !item.speed || f.offset !== item.bytesSent) return item.bytesSent;
  const elapsed = Math.max(0, now - f.startedAt) / 1000;
  return Math.min(item.size, item.bytesSent + Math.min(f.bytes * 0.95, item.speed * elapsed));
}

/** Seconds left for one item (null when unknown). */
export function etaSeconds(item: Pick<UploadItem, 'bytesSent' | 'speed' | 'size'>): number | null {
  if (!item.speed || item.speed <= 0) return null;
  return Math.max(0, (item.size - item.bytesSent) / item.speed);
}

/** Back-off before retry `attempt` (1-based): 1 s, 2 s, 4 s, 8 s, 16 s (±20 % jitter), capped at 30 s. */
export function backoffDelay(attempt: number, random: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random * 0.4));
}

export type ErrorClass =
  | { kind: 'abort' }
  | { kind: 'resync'; bytesReceived: number }
  | { kind: 'closed'; uploadStatus: string | null }
  | { kind: 'shrink'; maxChunkBytes: number }
  | { kind: 'transient'; code: string; message?: string }
  | { kind: 'fatal'; code: string; message?: string };

function detailsOf(err: ApiClientError): Record<string, unknown> {
  return err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {};
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/** Maps an error of an upload request to what the manager should do next. */
export function classifyUploadError(err: unknown): ErrorClass {
  if (isAbortError(err)) return { kind: 'abort' };
  if (!(err instanceof ApiClientError)) {
    // fetch network failures (TypeError), non-JSON proxy error pages (SyntaxError), anything unexpected
    return { kind: 'transient', code: 'network' };
  }
  const d = detailsOf(err);
  const reason = typeof d.reason === 'string' ? d.reason : err.code;
  const received = typeof d.bytesReceived === 'number' && Number.isFinite(d.bytesReceived) ? d.bytesReceived : null;

  if (reason === 'upload_closed') {
    return { kind: 'closed', uploadStatus: typeof d.uploadStatus === 'string' ? d.uploadStatus : null };
  }
  if (err.status === 409 && received !== null) return { kind: 'resync', bytesReceived: received };
  if (err.status === 413 && typeof d.maxChunkBytes === 'number' && d.maxChunkBytes > 0) {
    return { kind: 'shrink', maxChunkBytes: d.maxChunkBytes };
  }
  // the server could not read the whole chunk (client abort / network hiccup): retry from bytesReceived
  if (err.status === 400 && received !== null) return { kind: 'transient', code: 'network', message: err.message };
  if (err.status === 408 || err.status === 425 || err.status >= 500) {
    return { kind: 'transient', code: err.status >= 500 ? 'server' : 'network', message: err.message };
  }
  return { kind: 'fatal', code: reason, message: err.message };
}

/* ------------------------------------------------------------------ */
/* Environment                                                          */
/* ------------------------------------------------------------------ */

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Aborted', 'AbortError');
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function browserEnvironment(): UploadEnvironment {
  const hasWindow = typeof window !== 'undefined';
  return {
    isOnline: () => (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true),
    onOnline: (listener) => {
      if (!hasWindow) return () => {};
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
    installUnloadGuard: (shouldWarn) => {
      if (!hasWindow) return;
      window.addEventListener('beforeunload', (event) => {
        if (!shouldWarn()) return;
        event.preventDefault();
        // legacy browsers need returnValue to show the prompt
        event.returnValue = '';
      });
    },
    now: () => Date.now(),
    sleep: defaultSleep,
    random: () => Math.random(),
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                                */
/* ------------------------------------------------------------------ */

class StopSignal extends Error {
  constructor() {
    super('upload stopped');
    this.name = 'StopSignal';
  }
}

class FatalUploadError extends Error {
  constructor(
    public code: string,
    message?: string,
    /** the underlying low-level failure, for the diagnostics report */
    public detail?: string,
  ) {
    super(message ?? code);
    this.name = 'FatalUploadError';
  }
}

type StopReason = 'pause' | 'cancel';

let idSeq = 0;
function newLocalId(): string {
  idSeq += 1;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `up-${idSeq}-${rand}`;
}

export function createUploadStore(options: UploadStoreOptions = {}): UploadStore {
  const api: UploadApi = options.api ?? defaultApi;
  const env: UploadEnvironment = { ...browserEnvironment(), ...options.env };
  const maxParallel = options.maxParallel ?? MAX_PARALLEL_UPLOADS;
  const maxRetries = options.maxRetries ?? MAX_CHUNK_RETRIES;
  const defaultChunkSize = options.defaultChunkSize ?? DEFAULT_CHUNK_SIZE;

  let state: UploadStoreState = EMPTY_STATE;
  const listeners = new Set<() => void>();
  const uploadedListeners = new Set<(item: UploadItem) => void>();
  const files = new Map<string, File>();
  const controllers = new Map<string, AbortController>();
  const stopReasons = new Map<string, StopReason>();
  const chunkSizes = new Map<string, number>();
  const onlineWaiters = new Set<() => void>();
  let envBound = false;

  function bindEnvironment() {
    if (envBound) return;
    envBound = true;
    env.onOnline(() => {
      for (const wake of [...onlineWaiters]) wake();
      // uploads that gave up because of the network continue automatically
      for (const item of state.items) {
        if (item.status === 'error' && (item.errorCode === 'network' || item.errorCode === 'server') && files.has(item.localId)) {
          resume(item.localId);
        }
      }
    });
    env.installUnloadGuard(() => hasActive());
  }

  function emit() {
    for (const l of [...listeners]) l();
  }

  function setState(next: UploadStoreState) {
    if (next === state) return;
    state = next;
    emit();
  }

  function getItem(localId: string): UploadItem | undefined {
    return state.items.find((i) => i.localId === localId);
  }

  function update(localId: string, patch: Partial<UploadItem>) {
    let changed = false;
    const items = state.items.map((item) => {
      if (item.localId !== localId) return item;
      changed = true;
      return { ...item, ...patch };
    });
    if (changed) setState({ ...state, items });
  }

  function hasActive(collectionId?: string): boolean {
    return state.items.some((i) => isActiveStatus(i.status) && (collectionId === undefined || i.collectionId === collectionId));
  }

  /* ---------------- scheduling ---------------- */

  function pump(collectionId: string) {
    const items = state.items.filter((i) => i.collectionId === collectionId);
    let running = items.filter((i) => i.status === 'uploading' || i.status === 'finalizing').length;
    for (const item of items) {
      if (running >= maxParallel) break;
      if (item.status !== 'queued') continue;
      running += 1;
      void run(item.localId);
    }
  }

  /* ---------------- helpers used by run() ---------------- */

  function checkStop(ctl: AbortController) {
    if (ctl.signal.aborted) throw new StopSignal();
  }

  /** Waits for the network (not counted as a retry). */
  async function waitForOnline(localId: string, ctl: AbortController) {
    update(localId, { offline: true });
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        onlineWaiters.delete(done);
        ctl.signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        onlineWaiters.delete(done);
        reject(new StopSignal());
      };
      onlineWaiters.add(done);
      ctl.signal.addEventListener('abort', onAbort, { once: true });
      // some browsers miss the online event: re-check periodically
      const poll = async () => {
        while (onlineWaiters.has(done)) {
          try {
            await env.sleep(5000, ctl.signal);
          } catch {
            return;
          }
          if (env.isOnline()) done();
        }
      };
      void poll();
    });
    checkStop(ctl);
    update(localId, { offline: false });
  }

  /**
   * Handles one transient failure: waits for the network (free) or backs off (spends one retry).
   * Throws a FatalUploadError when the budget is exhausted.
   */
  async function backOff(localId: string, ctl: AbortController, attempt: number, code: string, message?: string, detail?: string) {
    if (!env.isOnline()) {
      await waitForOnline(localId, ctl);
      return false;
    }
    if (attempt > maxRetries) throw new FatalUploadError(code, message, detail);
    const delay = backoffDelay(attempt, env.random());
    update(localId, { retry: { attempt, max: maxRetries, at: env.now() + delay }, inFlight: null });
    try {
      await env.sleep(delay, ctl.signal);
    } catch {
      throw new StopSignal();
    }
    checkStop(ctl);
    if (!env.isOnline()) await waitForOnline(localId, ctl);
    update(localId, { retry: null });
    return true;
  }

  /** Runs a request with the retry policy for non-chunk calls (init / resume info / complete). */
  async function withRetries<T, U = never>(
    localId: string,
    ctl: AbortController,
    op: () => Promise<T>,
    onOther: (c: ErrorClass) => U | 'rethrow',
  ): Promise<T | U> {
    let attempt = 0;
    for (;;) {
      checkStop(ctl);
      try {
        const res = await op();
        checkStop(ctl);
        if (attempt > 0) update(localId, { retry: null });
        return res;
      } catch (err) {
        if (err instanceof StopSignal) throw err;
        const c = classifyUploadError(err);
        if (c.kind === 'abort' || ctl.signal.aborted) throw new StopSignal();
        if (c.kind === 'transient') {
          const counted = await backOff(localId, ctl, attempt + 1, c.code, c.message, errorDetail(err));
          if (counted) attempt += 1;
          continue;
        }
        const handled = onOther(c);
        if (handled !== 'rethrow') return handled;
        const message = err instanceof Error ? err.message : undefined;
        switch (c.kind) {
          case 'fatal':
            throw new FatalUploadError(c.code, c.message);
          case 'closed':
            throw new FatalUploadError('upload_closed', message);
          case 'shrink':
            throw new FatalUploadError('too_large', message);
          case 'resync':
            throw new FatalUploadError('conflict', message);
        }
      }
    }
  }

  /** Tells the server log why an upload failed on this device (real phones cannot be debugged otherwise). */
  function reportFailure(localId: string, code: string, detail: string | undefined) {
    const item = getItem(localId);
    if (!item || !api.reportUploadFailure || UNREPORTED_CODES.has(code)) return;
    api
      .reportUploadFailure({
        code,
        detail,
        videoId: item.videoId,
        mimeType: item.mimeType,
        extension: fileExtension(item.name),
        sizeBytes: item.size,
        bytesSent: item.bytesSent,
        lastModifiedKnown: item.lastModified > 0,
        ...(() => {
          const file = files.get(localId);
          const copyError = file ? stableCopyError(file) : undefined;
          return { stableCopy: file ? stableCopyKind(file) : undefined, ...(copyError ? { copyError } : {}) };
        })(),
      })
      .catch(() => {});
  }

  async function deleteQuietly(videoId: string) {
    try {
      await api.deleteUpload(videoId);
    } catch (err) {
      // 404: already gone. Anything else: the hourly cleanup purges stale uploads.
      if (!(err instanceof ApiClientError && err.status === 404)) {
        console.info('[upload] could not delete canceled upload', { videoId });
      }
    }
  }

  type Session = { videoId: string; chunkSize: number; bytesReceived: number; uploaded: boolean };

  async function openSession(localId: string, ctl: AbortController): Promise<Session> {
    const item = getItem(localId);
    if (!item) throw new StopSignal();

    if (item.videoId) {
      const videoId = item.videoId;
      const info = await withRetries(
        localId,
        ctl,
        () => api.getUpload(videoId),
        (c) => (c.kind === 'fatal' && c.code === 'not_found' ? null : 'rethrow'),
      );
      if (info) {
        if (info.uploadStatus === 'failed') throw new FatalUploadError('upload_closed');
        if (info.sizeBytes === item.size) {
          return {
            videoId,
            chunkSize: chunkSizes.get(localId) ?? defaultChunkSize,
            bytesReceived: Math.min(info.bytesReceived, item.size),
            uploaded: info.uploadStatus === 'uploaded',
          };
        }
      }
      // the server-side upload vanished (or belongs to another file): start a fresh one
      update(localId, { videoId: undefined, bytesSent: 0 });
    }

    let created: InitUploadResponse | null = null;
    const onStoppedDuringInit = async () => {
      if (!created) return;
      // stopped while the init request was on its way: a canceled source must not linger, a paused one resumes later
      if (stopReasons.get(localId) === 'cancel') await deleteQuietly(created.videoId);
      else update(localId, { videoId: created.videoId, bytesSent: created.bytesReceived });
    };
    let res: InitUploadResponse;
    try {
      res = await withRetries<InitUploadResponse>(
        localId,
        ctl,
        async () => {
          created = await api.initUpload(item.collectionId, { filename: item.name, size: item.size, mimeType: item.mimeType });
          return created;
        },
        () => 'rethrow',
      );
    } catch (err) {
      if (ctl.signal.aborted) await onStoppedDuringInit();
      throw err;
    }
    chunkSizes.set(localId, res.chunkSize > 0 ? res.chunkSize : defaultChunkSize);
    if (ctl.signal.aborted) {
      await onStoppedDuringInit();
      throw new StopSignal();
    }
    update(localId, { videoId: res.videoId, bytesSent: res.bytesReceived });
    return { videoId: res.videoId, chunkSize: chunkSizes.get(localId)!, bytesReceived: res.bytesReceived, uploaded: false };
  }

  /** Sends the remaining bytes. Resolves when the server holds the whole file. */
  async function sendChunks(localId: string, ctl: AbortController, session: Session, file: File) {
    const size = file.size;
    let offset = session.bytesReceived;
    let chunkSize = session.chunkSize;
    /** halved after a failed chunk, doubled again after a few successful ones in a row */
    let ceiling = chunkSize;
    let streak = 0;
    let failures = 0;
    let resyncs = 0;
    let readFailures = 0;

    while (offset < size) {
      checkStop(ctl);
      const planned = nextChunkSize({ speed: getItem(localId)?.speed, maxChunk: chunkSize, ceiling });
      const bytes = Math.min(planned, size - offset);
      let chunk: Blob;
      try {
        chunk = await readChunk(file, offset, bytes);
      } catch (err) {
        // the phone revoked access to the picked file or the gallery app replaced it
        readFailures += 1;
        if (readFailures > MAX_READ_RETRIES) throw new FatalUploadError('file_unreadable', undefined, errorDetail(err));
        try {
          await env.sleep(500 * readFailures, ctl.signal);
        } catch {
          throw new StopSignal();
        }
        continue;
      }
      checkStop(ctl);
      readFailures = 0;
      const startedAt = env.now();
      update(localId, { inFlight: { offset, bytes, startedAt }, bytesSent: offset });
      try {
        const res = await api.putChunk(session.videoId, offset, chunk, ctl.signal);
        checkStop(ctl);
        const next = Math.min(size, Math.max(0, res.bytesReceived));
        const item = getItem(localId);
        const elapsed = (env.now() - startedAt) / 1000;
        let speed = item?.speed ?? null;
        if (next > offset && elapsed > 0.05) {
          const sample = (next - offset) / elapsed;
          speed = speed ? speed * 0.6 + sample * 0.4 : sample;
        }
        if (next > offset) {
          failures = 0;
          resyncs = 0;
          streak += 1;
          if (streak >= 3 && ceiling < chunkSize) {
            ceiling = Math.min(chunkSize, ceiling * 2);
            streak = 0;
          }
        } else {
          resyncs += 1;
          if (resyncs > MAX_RESYNCS) throw new FatalUploadError('network');
        }
        offset = next;
        update(localId, { bytesSent: offset, speed, inFlight: null, retry: null, offline: false });
      } catch (err) {
        if (err instanceof StopSignal || err instanceof FatalUploadError) throw err;
        const c = classifyUploadError(err);
        if (c.kind === 'abort' || ctl.signal.aborted) throw new StopSignal();
        update(localId, { inFlight: null });
        if (c.kind === 'resync') {
          resyncs += 1;
          if (resyncs > MAX_RESYNCS) throw new FatalUploadError('conflict', (err as Error).message);
          offset = Math.min(size, Math.max(0, c.bytesReceived));
          update(localId, { bytesSent: offset });
          continue;
        }
        if (c.kind === 'closed') {
          if (c.uploadStatus === 'uploaded') return;
          throw new FatalUploadError('upload_closed', (err as Error).message);
        }
        if (c.kind === 'shrink') {
          const smaller = Math.max(256 * 1024, Math.floor(Math.min(chunkSize, c.maxChunkBytes) / 2));
          if (smaller >= chunkSize) throw new FatalUploadError('too_large', (err as Error).message);
          chunkSize = smaller;
          chunkSizes.set(localId, chunkSize);
          continue;
        }
        if (c.kind === 'fatal') throw new FatalUploadError(c.code, c.message);

        // transient: a chunk that did not arrive (proxy timeout, weak signal) is discarded by the server –
        // try a smaller one next time
        ceiling = Math.max(Math.min(MIN_CHUNK_BYTES, chunkSize), Math.floor(bytes / 2));
        streak = 0;
        // back off (or wait for the network), then ask the server where we are
        const counted = await backOff(localId, ctl, failures + 1, c.code, c.message, errorDetail(err));
        if (counted) failures += 1;
        try {
          const info = await api.getUpload(session.videoId);
          checkStop(ctl);
          if (info.uploadStatus === 'uploaded') return;
          if (info.uploadStatus === 'failed') throw new FatalUploadError('upload_closed');
          offset = Math.min(size, Math.max(0, info.bytesReceived));
          update(localId, { bytesSent: offset });
        } catch (syncErr) {
          if (syncErr instanceof StopSignal || syncErr instanceof FatalUploadError) throw syncErr;
          const sc = classifyUploadError(syncErr);
          if (sc.kind === 'abort') throw new StopSignal();
          if (sc.kind === 'fatal') throw new FatalUploadError(sc.code, sc.message);
          // still unreachable: keep the offset, the next PUT answers 409 if it is wrong
        }
      }
    }
  }

  async function finalize(localId: string, ctl: AbortController, videoId: string): Promise<{ video: VideoDTO } | { resumeAt: number }> {
    update(localId, { status: 'finalizing', inFlight: null, bytesSent: getItem(localId)?.size ?? 0 });
    return withRetries<{ video: VideoDTO }, { resumeAt: number }>(
      localId,
      ctl,
      () => api.completeUpload(videoId),
      (c) => (c.kind === 'resync' ? { resumeAt: c.bytesReceived } : 'rethrow'),
    );
  }

  async function run(localId: string) {
    const initial = getItem(localId);
    const file = files.get(localId);
    if (!initial || initial.status !== 'queued') return;
    const collectionId = initial.collectionId;
    if (!file) {
      update(localId, { status: 'error', errorCode: 'file_missing', error: undefined });
      return;
    }
    const ctl = new AbortController();
    controllers.set(localId, ctl);
    stopReasons.delete(localId);
    update(localId, { status: 'uploading', error: undefined, errorCode: undefined, retry: null, offline: false, inFlight: null });

    try {
      let session = await openSession(localId, ctl);
      let rounds = 0;
      for (;;) {
        rounds += 1;
        if (rounds > MAX_COMPLETE_ROUNDS) throw new FatalUploadError('upload_incomplete');
        if (!session.uploaded) {
          update(localId, { status: 'uploading' });
          await sendChunks(localId, ctl, session, file);
        }
        checkStop(ctl);
        // pausing is not possible once the file is on the server
        const result = await finalize(localId, ctl, session.videoId);
        if ('video' in result) {
          const done: Partial<UploadItem> = {
            status: 'done',
            video: result.video,
            bytesSent: file.size,
            finishedAt: env.now(),
            retry: null,
            offline: false,
            inFlight: null,
          };
          update(localId, done);
          const item = getItem(localId);
          if (item) for (const l of [...uploadedListeners]) l(item);
          // the File is no longer needed for uploading; keep it only while the item is listed (thumbnails)
          return;
        }
        session = { ...session, bytesReceived: Math.min(file.size, result.resumeAt), uploaded: false };
      }
    } catch (err) {
      if (err instanceof StopSignal || ctl.signal.aborted) {
        const reason = stopReasons.get(localId);
        const item = getItem(localId);
        if (item && reason === 'pause' && item.status !== 'done') {
          update(localId, { status: 'paused', retry: null, offline: false, inFlight: null });
        }
        return;
      }
      const code = err instanceof FatalUploadError ? err.code : 'internal';
      const message = err instanceof FatalUploadError && err.message !== err.code ? err.message : undefined;
      if (!(err instanceof FatalUploadError)) console.error('[upload] unexpected error', err);
      update(localId, { status: 'error', errorCode: code, error: message, retry: null, offline: false, inFlight: null });
      reportFailure(localId, code, err instanceof FatalUploadError ? (err.detail ?? message) : errorDetail(err));
    } finally {
      if (controllers.get(localId) === ctl) controllers.delete(localId);
      pump(collectionId);
    }
  }

  /* ---------------- public API ---------------- */

  function enqueue(collectionId: string, picked: readonly File[], opts?: { resumable?: readonly ResumableUpload[] }): UploadItem[] {
    bindEnvironment();
    const now = env.now();
    const claimed = new Set(state.items.map((i) => i.videoId).filter(Boolean) as string[]);
    const created: UploadItem[] = [];
    for (const file of picked) {
      const mimeType = inferUploadMime(file);
      const resumable = opts?.resumable?.find(
        (r) => !claimed.has(r.videoId) && r.name === file.name && r.size === file.size,
      );
      if (resumable) claimed.add(resumable.videoId);
      const item: UploadItem = {
        localId: newLocalId(),
        collectionId,
        videoId: resumable?.videoId,
        name: file.name,
        size: file.size,
        mimeType,
        kind: sourceKindOfMime(mimeType),
        lastModified: file.lastModified ?? 0,
        bytesSent: 0,
        status: 'queued',
        speed: null,
        inFlight: null,
        retry: null,
        addedAt: now,
      };
      files.set(item.localId, file);
      created.push(item);
    }
    if (created.length === 0) return created;
    setState({ ...state, items: [...state.items, ...created] });
    pump(collectionId);
    return created;
  }

  function stop(localId: string, reason: StopReason) {
    stopReasons.set(localId, reason);
    controllers.get(localId)?.abort();
  }

  function pause(localId: string) {
    const item = getItem(localId);
    if (!item) return;
    if (item.status === 'queued') {
      update(localId, { status: 'paused' });
      return;
    }
    if (item.status !== 'uploading') return;
    stop(localId, 'pause');
    update(localId, { status: 'paused', retry: null, offline: false, inFlight: null });
  }

  function resume(localId: string) {
    const item = getItem(localId);
    if (!item || (item.status !== 'paused' && item.status !== 'error')) return;
    if (!files.has(localId)) {
      update(localId, { status: 'error', errorCode: 'file_missing' });
      return;
    }
    bindEnvironment();
    update(localId, { status: 'queued', error: undefined, errorCode: undefined, retry: null, offline: false });
    // a still-running (aborting) run keeps its slot until it exits; pump() is called again then
    pump(item.collectionId);
  }

  async function cancel(localId: string) {
    const item = getItem(localId);
    if (!item || item.status === 'done' || item.status === 'canceled') return;
    const running = controllers.has(localId);
    stop(localId, 'cancel');
    update(localId, { status: 'canceled', retry: null, offline: false, inFlight: null, finishedAt: env.now() });
    // when init is still in flight, run() deletes the source it receives
    if (item.videoId) await deleteQuietly(item.videoId);
    if (!running) pump(item.collectionId);
  }

  /** forgets the picked file of an item (and deletes its stable copy) */
  function dropFile(localId: string) {
    const file = files.get(localId);
    files.delete(localId);
    if (file) void releaseStableCopy(file).catch(() => undefined);
  }

  async function remove(localId: string) {
    const item = getItem(localId);
    if (!item) return;
    if (item.status !== 'done' && item.status !== 'canceled') await cancel(localId);
    dropFile(localId);
    chunkSizes.delete(localId);
    stopReasons.delete(localId);
    setState({ ...state, items: state.items.filter((i) => i.localId !== localId) });
    pump(item.collectionId);
  }

  function clearFinished(collectionId?: string) {
    const keep = state.items.filter(
      (i) => !(isFinishedStatus(i.status) && (collectionId === undefined || i.collectionId === collectionId)),
    );
    if (keep.length === state.items.length) return;
    for (const i of state.items) if (!keep.includes(i)) dropFile(i.localId);
    setState({ ...state, items: keep });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => EMPTY_STATE,
    enqueue,
    pause,
    resume,
    retry: resume,
    cancel,
    remove,
    clearFinished,
    getFile: (localId) => files.get(localId),
    hasActive,
    onUploaded(listener) {
      uploadedListeners.add(listener);
      return () => uploadedListeners.delete(listener);
    },
    setDraft(draft) {
      setState({ ...state, draft });
    },
    updateDraftSent(sent) {
      if (!state.draft) return;
      setState({ ...state, draft: { ...state.draft, sent } });
    },
  };
}

/** The app-wide upload manager (one per browser tab). */
export const uploadStore: UploadStore = createUploadStore();

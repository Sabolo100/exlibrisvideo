import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/client/api';
import type { VideoDTO } from '@/lib/types';
import {
  backoffDelay,
  classifyUploadError,
  createUploadStore,
  estimateBytesSent,
  etaSeconds,
  inferUploadMime,
  MIN_CHUNK_BYTES,
  nextChunkSize,
  sourceKindOfMime,
  START_CHUNK_BYTES,
  type UploadApi,
  type UploadEnvironment,
  type UploadItem,
  type UploadStore,
} from './upload-store';

/* ------------------------------------------------------------------ */
/* Test doubles                                                         */
/* ------------------------------------------------------------------ */

interface FakeUpload {
  collectionId: string;
  name: string;
  size: number;
  data: Uint8Array;
  received: number;
  status: 'uploading' | 'uploaded' | 'failed';
}

function makeVideo(id: string, u: FakeUpload): VideoDTO {
  return {
    id,
    kind: u.name.endsWith('.jpg') ? 'image' : 'video',
    sortOrder: 0,
    originalFilename: u.name,
    sizeBytes: u.size,
    uploadStatus: 'uploaded',
    status: 'queued',
    stage: null,
    progress: 0,
    durationSec: null,
    framesTotal: 0,
    framesAnalyzed: 0,
    booksFound: 0,
    error: null,
    createdAt: new Date(0).toISOString(),
    processedAt: null,
  };
}

type PutHook = (ctx: { videoId: string; offset: number; attempt: number; upload: FakeUpload }) => Promise<void> | void;

function fakeServer(opts: { chunkSize?: number } = {}) {
  const chunkSize = opts.chunkSize ?? 4;
  const uploads = new Map<string, FakeUpload>();
  const calls: string[] = [];
  const hooks: { put?: PutHook; init?: () => Promise<void> | void; complete?: (videoId: string, n: number) => Promise<void> | void } = {};
  let seq = 0;
  let putAttempts = 0;
  let completeCalls = 0;
  let inFlightUploads = 0;
  let maxInFlightUploads = 0;
  const started = new Set<string>();

  const api: UploadApi = {
    async initUpload(collectionId, body) {
      calls.push(`init:${body.filename}`);
      await hooks.init?.();
      seq += 1;
      const videoId = `v${seq}`;
      uploads.set(videoId, {
        collectionId,
        name: body.filename,
        size: body.size,
        data: new Uint8Array(body.size),
        received: 0,
        status: 'uploading',
      });
      return { videoId, chunkSize, bytesReceived: 0 };
    },
    async getUpload(videoId) {
      calls.push(`get:${videoId}`);
      const u = uploads.get(videoId);
      if (!u) throw new ApiClientError('not found', 404, 'not_found');
      return { bytesReceived: u.received, sizeBytes: u.size, uploadStatus: u.status };
    },
    async putChunk(videoId, offset, chunk, signal) {
      putAttempts += 1;
      calls.push(`put:${videoId}@${offset}`);
      const u = uploads.get(videoId);
      if (!u) throw new ApiClientError('not found', 404, 'not_found');
      if (!started.has(videoId)) {
        started.add(videoId);
        inFlightUploads += 1;
        maxInFlightUploads = Math.max(maxInFlightUploads, inFlightUploads);
      }
      await hooks.put?.({ videoId, offset, attempt: putAttempts, upload: u });
      await new Promise((r) => setTimeout(r, 1));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (u.status !== 'uploading') {
        throw new ApiClientError('closed', 409, 'conflict', { reason: 'upload_closed', uploadStatus: u.status });
      }
      if (offset !== u.received) throw new ApiClientError('conflict', 409, 'conflict', { bytesReceived: u.received });
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      u.data.set(bytes, offset);
      u.received += bytes.length;
      return { bytesReceived: u.received };
    },
    async completeUpload(videoId) {
      completeCalls += 1;
      calls.push(`complete:${videoId}`);
      await hooks.complete?.(videoId, completeCalls);
      const u = uploads.get(videoId);
      if (!u) throw new ApiClientError('not found', 404, 'not_found');
      if (u.received !== u.size) {
        throw new ApiClientError('incomplete', 409, 'conflict', {
          reason: 'upload_incomplete',
          bytesReceived: u.received,
          sizeBytes: u.size,
        });
      }
      if (started.delete(videoId)) inFlightUploads -= 1;
      u.status = 'uploaded';
      return { video: makeVideo(videoId, u) };
    },
    async deleteUpload(videoId) {
      calls.push(`delete:${videoId}`);
      if (started.delete(videoId)) inFlightUploads -= 1;
      if (!uploads.delete(videoId)) throw new ApiClientError('not found', 404, 'not_found');
    },
  };

  return {
    api,
    uploads,
    calls,
    hooks,
    get maxInFlightUploads() {
      return maxInFlightUploads;
    },
  };
}

function testEnv() {
  let online = true;
  const onlineListeners = new Set<() => void>();
  let shouldWarn: (() => boolean) | null = null;
  const env: Partial<UploadEnvironment> = {
    isOnline: () => online,
    onOnline: (l) => {
      onlineListeners.add(l);
      return () => onlineListeners.delete(l);
    },
    installUnloadGuard: (fn) => {
      shouldWarn = fn;
    },
    random: () => 0.5,
    // real macrotask yield, but no real waiting
    sleep: (_ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const t = setTimeout(resolve, 2);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      }),
  };
  return {
    env,
    setOnline(v: boolean) {
      online = v;
      if (v) for (const l of [...onlineListeners]) l();
    },
    warns: () => shouldWarn?.() ?? false,
  };
}

function bytesFile(name: string, size: number, type = 'video/mp4'): File {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7 + 3) % 251;
  return new File([data], name, { type, lastModified: 1_700_000_000_000 });
}

/** A picked file whose first `failures` slice reads fail like an Android gallery file that became unreadable. */
function flakyFile(name: string, size: number, failures: number): File {
  const file = bytesFile(name, size);
  const slice = file.slice.bind(file);
  let left = failures;
  Object.defineProperty(file, 'slice', {
    value: (start?: number, end?: number, type?: string) => {
      const blob = slice(start, end, type);
      if (left > 0) {
        left -= 1;
        Object.defineProperty(blob, 'arrayBuffer', {
          value: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
        });
      }
      return blob;
    },
  });
  return file;
}

function items(store: UploadStore, collectionId = 'c1'): readonly UploadItem[] {
  return store.getSnapshot().items.filter((i) => i.collectionId === collectionId);
}

function itemById(store: UploadStore, localId: string): UploadItem {
  const item = store.getSnapshot().items.find((i) => i.localId === localId);
  if (!item) throw new Error(`item ${localId} missing`);
  return item;
}

async function settle(store: UploadStore, localId: string, statuses: UploadItem['status'][] = ['done', 'error', 'canceled']) {
  await vi.waitFor(
    () => {
      expect(statuses).toContain(itemById(store, localId).status);
    },
    { timeout: 5000, interval: 5 },
  );
  return itemById(store, localId);
}

function expectSameBytes(file: File, upload: FakeUpload | undefined) {
  expect(upload).toBeDefined();
  return file.arrayBuffer().then((buf) => {
    expect(Array.from(upload!.data)).toEqual(Array.from(new Uint8Array(buf)));
  });
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

describe('upload-store helpers', () => {
  it('infers MIME types from extensions when the browser reports none', () => {
    expect(inferUploadMime({ name: 'shelf.MOV', type: '' })).toBe('video/quicktime');
    expect(inferUploadMime({ name: 'a.mp4', type: 'application/octet-stream' })).toBe('video/mp4');
    expect(inferUploadMime({ name: 'a.bin', type: 'Video/MP4; codecs=avc1' })).toBe('video/mp4');
    expect(inferUploadMime({ name: 'photo.jpeg', type: '' })).toBe('image/jpeg');
    expect(inferUploadMime({ name: 'noext', type: '' })).toBe('application/octet-stream');
    expect(sourceKindOfMime('image/png')).toBe('image');
    expect(sourceKindOfMime('video/webm')).toBe('video');
  });

  it('classifies API errors', () => {
    expect(classifyUploadError(new DOMException('x', 'AbortError'))).toEqual({ kind: 'abort' });
    expect(classifyUploadError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'transient', code: 'network' });
    expect(classifyUploadError(new SyntaxError('Unexpected token <'))).toMatchObject({ kind: 'transient' });
    expect(classifyUploadError(new ApiClientError('c', 409, 'conflict', { bytesReceived: 42 }))).toEqual({
      kind: 'resync',
      bytesReceived: 42,
    });
    expect(
      classifyUploadError(new ApiClientError('c', 409, 'conflict', { reason: 'upload_incomplete', bytesReceived: 7, sizeBytes: 9 })),
    ).toEqual({ kind: 'resync', bytesReceived: 7 });
    expect(classifyUploadError(new ApiClientError('c', 409, 'conflict', { reason: 'upload_closed', uploadStatus: 'uploaded' }))).toEqual({
      kind: 'closed',
      uploadStatus: 'uploaded',
    });
    expect(classifyUploadError(new ApiClientError('big', 413, 'too_large', { maxChunkBytes: 1000, bytesReceived: 0 }))).toEqual({
      kind: 'shrink',
      maxChunkBytes: 1000,
    });
    expect(classifyUploadError(new ApiClientError('big', 413, 'too_large', { maxBytes: 1 }))).toMatchObject({ kind: 'fatal', code: 'too_large' });
    expect(classifyUploadError(new ApiClientError('bad', 400, 'invalid', { bytesReceived: 3 }))).toMatchObject({ kind: 'transient' });
    expect(classifyUploadError(new ApiClientError('down', 503, 'internal'))).toMatchObject({ kind: 'transient', code: 'server' });
    expect(classifyUploadError(new ApiClientError('slow', 429, 'rate_limited'))).toMatchObject({ kind: 'fatal', code: 'rate_limited' });
    expect(classifyUploadError(new ApiClientError('nope', 415, 'unsupported'))).toMatchObject({
      kind: 'fatal',
      code: 'unsupported',
      message: 'nope',
    });
    expect(classifyUploadError(new ApiClientError('max', 400, 'invalid', { reason: 'too_many_sources', max: 30 }))).toMatchObject({
      kind: 'fatal',
      code: 'too_many_sources',
    });
  });

  it('backs off exponentially with jitter and a cap', () => {
    expect(backoffDelay(1, 0.5)).toBe(1000);
    expect(backoffDelay(2, 0.5)).toBe(2000);
    expect(backoffDelay(5, 0.5)).toBe(16000);
    expect(backoffDelay(9, 0.5)).toBe(30000);
    expect(backoffDelay(1, 0)).toBe(800);
    expect(backoffDelay(1, 1)).toBe(1200);
  });

  it('estimates in-flight progress and ETA', () => {
    const base = { size: 1000, bytesSent: 400, speed: 100, status: 'uploading' as const };
    expect(estimateBytesSent({ ...base, inFlight: { offset: 400, bytes: 200, startedAt: 0 } }, 1000)).toBe(500);
    // never beyond 95 % of the chunk on the wire
    expect(estimateBytesSent({ ...base, inFlight: { offset: 400, bytes: 200, startedAt: 0 } }, 10_000)).toBe(590);
    expect(estimateBytesSent({ ...base, inFlight: null }, 1000)).toBe(400);
    expect(estimateBytesSent({ ...base, status: 'finalizing', inFlight: null }, 0)).toBe(1000);
    expect(etaSeconds(base)).toBe(6);
    expect(etaSeconds({ ...base, speed: null })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Store behaviour                                                      */
/* ------------------------------------------------------------------ */

describe('nextChunkSize', () => {
  const MiB = 1024 * 1024;
  it('starts small before any speed is known', () => {
    expect(nextChunkSize({ speed: null, maxChunk: 8 * MiB, ceiling: 8 * MiB })).toBe(START_CHUNK_BYTES);
  });
  it('aims at about 15 seconds per request, within the server limit', () => {
    // 100 KB/s → 1.5 MB, rounded down to 256 KiB steps
    expect(nextChunkSize({ speed: 100_000, maxChunk: 8 * MiB, ceiling: 8 * MiB })).toBe(1280 * 1024);
    expect(nextChunkSize({ speed: 10 * MiB, maxChunk: 8 * MiB, ceiling: 8 * MiB })).toBe(8 * MiB);
    // very slow uplinks still send the minimum
    expect(nextChunkSize({ speed: 2_000, maxChunk: 8 * MiB, ceiling: 8 * MiB })).toBe(MIN_CHUNK_BYTES);
  });
  it('respects the ceiling lowered after a failure', () => {
    expect(nextChunkSize({ speed: 10 * MiB, maxChunk: 8 * MiB, ceiling: 512 * 1024 })).toBe(512 * 1024);
  });
  it('never exceeds a tiny server limit', () => {
    expect(nextChunkSize({ speed: null, maxChunk: 4, ceiling: 4 })).toBe(4);
    expect(nextChunkSize({ speed: 1_000_000, maxChunk: 4, ceiling: 4 })).toBe(4);
  });
});

describe('createUploadStore', () => {
  it('shrinks the chunks when a proxy keeps cutting long requests, and still finishes', async () => {
    const MiB = 1024 * 1024;
    const server = fakeServer({ chunkSize: 8 * MiB });
    const sizes: number[] = [];
    const original = server.api.putChunk;
    server.api.putChunk = async (videoId, offset, chunk, signal) => {
      sizes.push(chunk.size);
      // a slow uplink: anything above 512 KiB takes longer than the proxy allows
      if (chunk.size > 512 * 1024) throw new TypeError('Failed to fetch');
      return original(videoId, offset, chunk, signal);
    };
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const file = bytesFile('shelf.mp4', 3 * MiB);
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);

    expect(done.status).toBe('done');
    await expectSameBytes(file, server.uploads.get('v1'));
    expect(sizes[0]).toBe(START_CHUNK_BYTES);
    expect(sizes.filter((n) => n > 512 * 1024).length).toBeLessThanOrEqual(2);
    expect(Math.max(...sizes.slice(1))).toBeLessThanOrEqual(1 * MiB);
  });

  it('uploads a file in sequential chunks, completes it and notifies listeners', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const uploaded = vi.fn();
    store.onUploaded(uploaded);
    const snapshots: UploadItem['status'][] = [];
    store.subscribe(() => {
      const s = store.getSnapshot().items[0]?.status;
      if (s && snapshots[snapshots.length - 1] !== s) snapshots.push(s);
    });

    const file = bytesFile('shelf.mp4', 10);
    const [item] = store.enqueue('c1', [file]);
    expect(item.kind).toBe('video');
    const done = await settle(store, item.localId);

    expect(done.status).toBe('done');
    expect(done.bytesSent).toBe(10);
    expect(done.video?.id).toBe('v1');
    expect(server.calls).toEqual(['init:shelf.mp4', 'put:v1@0', 'put:v1@4', 'put:v1@8', 'complete:v1']);
    await expectSameBytes(file, server.uploads.get('v1'));
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(uploaded.mock.calls[0][0]).toMatchObject({ localId: item.localId, status: 'done' });
    expect(snapshots).toEqual(['queued', 'uploading', 'finalizing', 'done']);
  });

  it('runs at most two files in parallel per collection', async () => {
    const server = fakeServer({ chunkSize: 2 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    let maxUploading = 0;
    store.subscribe(() => {
      const n = items(store).filter((i) => i.status === 'uploading' || i.status === 'finalizing').length;
      maxUploading = Math.max(maxUploading, n);
    });
    const created = store.enqueue('c1', [bytesFile('a.mp4', 8), bytesFile('b.mp4', 8), bytesFile('c.mp4', 8)]);
    expect(items(store).map((i) => i.status)).toEqual(['uploading', 'uploading', 'queued']);
    for (const c of created) await settle(store, c.localId);
    expect(items(store).every((i) => i.status === 'done')).toBe(true);
    expect(maxUploading).toBe(2);
    expect(server.maxInFlightUploads).toBe(2);
  });

  it('retries a failing chunk with back-off and exposes the retry state', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    let failures = 0;
    server.hooks.put = ({ offset }) => {
      if (offset === 4 && failures < 2) {
        failures += 1;
        throw new TypeError('Failed to fetch');
      }
    };
    const retries: number[] = [];
    store.subscribe(() => {
      const r = store.getSnapshot().items[0]?.retry;
      if (r && retries[retries.length - 1] !== r.attempt) retries.push(r.attempt);
    });
    const file = bytesFile('a.mp4', 10);
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(retries).toEqual([1, 2]);
    expect(done.retry).toBeNull();
    // after each failure the manager asked the server where to continue
    expect(server.calls.filter((c) => c === 'get:v1')).toHaveLength(2);
    await expectSameBytes(file, server.uploads.get('v1'));
  });

  it('gives up after five retries of the same chunk', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    server.hooks.put = ({ offset }) => {
      if (offset === 4) throw new ApiClientError('Bad gateway', 502, 'internal');
    };
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 10)]);
    const failed = await settle(store, item.localId);
    expect(failed.status).toBe('error');
    expect(failed.errorCode).toBe('server');
    expect(failed.bytesSent).toBe(4);
    expect(server.calls.filter((c) => c === 'put:v1@4')).toHaveLength(6);
    expect(server.calls).not.toContain('complete:v1');
    expect(store.hasActive('c1')).toBe(false);
  });

  it('sends in-memory copies of the file slices and survives a failed read', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const file = flakyFile('gallery.mp4', 10, 1);
    const sent: Blob[] = [];
    const original = server.api.putChunk;
    server.api.putChunk = async (videoId, offset, chunk, signal) => {
      sent.push(chunk);
      return original(videoId, offset, chunk, signal);
    };
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(sent.length).toBeGreaterThan(0);
    for (const chunk of sent) expect(chunk.type).toBe('application/octet-stream');
    await expectSameBytes(bytesFile('gallery.mp4', 10), server.uploads.get('v1'));
  });

  it('gives up on a file the phone will not let us read and reports why', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const reports: Parameters<NonNullable<UploadApi['reportUploadFailure']>>[0][] = [];
    const store = createUploadStore({
      api: { ...server.api, reportUploadFailure: async (r) => void reports.push(r) },
      env,
    });
    const [item] = store.enqueue('c1', [flakyFile('gallery.mp4', 10, 99)]);
    const failed = await settle(store, item.localId);
    expect(failed.status).toBe('error');
    expect(failed.errorCode).toBe('file_unreadable');
    expect(server.calls.some((c) => c.startsWith('put:'))).toBe(false);
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({
      code: 'file_unreadable',
      videoId: 'v1',
      mimeType: 'video/mp4',
      extension: 'mp4',
      sizeBytes: 10,
      bytesSent: 0,
      lastModifiedKnown: true,
    });
    expect(reports[0].detail).toContain('NotReadableError');
  });

  it('reports the low-level cause of exhausted network retries, but not user-fixable errors', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const reports: Parameters<NonNullable<UploadApi['reportUploadFailure']>>[0][] = [];
    const store = createUploadStore({
      api: { ...server.api, reportUploadFailure: async (r) => void reports.push(r) },
      env,
    });
    server.hooks.put = ({ offset }) => {
      if (offset === 4) throw new TypeError('Failed to fetch');
    };
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 10)]);
    expect((await settle(store, item.localId)).errorCode).toBe('network');
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ code: 'network', detail: 'TypeError: Failed to fetch', bytesSent: 4 });

    const refusing = createUploadStore({
      api: {
        ...server.api,
        initUpload: async () => {
          throw new ApiClientError('too big', 413, 'too_large');
        },
        reportUploadFailure: async (r) => void reports.push(r),
      },
      env,
    });
    const [big] = refusing.enqueue('c1', [bytesFile('big.mp4', 10)]);
    expect((await settle(refusing, big.localId)).errorCode).toBe('too_large');
    expect(reports).toHaveLength(1);
  });

  it('re-syncs to the server offset on 409 (chunk stored but response lost)', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    let lost = false;
    const original = server.api.putChunk;
    server.api.putChunk = async (videoId, offset, chunk, signal) => {
      const res = await original(videoId, offset, chunk, signal);
      if (offset === 4 && !lost) {
        lost = true;
        // simulate a proxy dropping the response after the server wrote the chunk
        throw new TypeError('network connection was lost');
      }
      return res;
    };
    // the manager must not re-send bytes 4..8 twice at the wrong offset
    server.hooks.put = undefined;
    const file = bytesFile('a.mp4', 12);
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    await expectSameBytes(file, server.uploads.get('v1'));
    expect(server.calls.filter((c) => c.startsWith('put:v1@4'))).toHaveLength(1);
  });

  it('follows a 409 conflict offset directly', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const file = bytesFile('a.mp4', 12);
    server.hooks.init = undefined;
    let tampered = false;
    server.hooks.put = async ({ offset, upload }) => {
      // another tab already delivered the second chunk
      if (offset === 4 && !tampered) {
        tampered = true;
        const buf = new Uint8Array(await file.arrayBuffer());
        upload.data.set(buf.subarray(4, 8), 4);
        upload.received = 8;
      }
    };
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(server.calls).toEqual(['init:a.mp4', 'put:v1@0', 'put:v1@4', 'put:v1@8', 'complete:v1']);
    await expectSameBytes(file, server.uploads.get('v1'));
  });

  it('waits for the network without spending retries and resumes on the online event', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const t = testEnv();
    const store = createUploadStore({ api: server.api, env: t.env, maxRetries: 1 });
    let dropped = 0;
    server.hooks.put = ({ offset }) => {
      if (offset === 4 && dropped < 3) {
        dropped += 1;
        t.setOnline(false);
        throw new TypeError('Failed to fetch');
      }
    };
    const file = bytesFile('a.mp4', 10);
    const [item] = store.enqueue('c1', [file]);
    await vi.waitFor(() => expect(itemById(store, item.localId).offline).toBe(true), { timeout: 3000, interval: 5 });
    expect(itemById(store, item.localId).status).toBe('uploading');
    t.setOnline(true);
    await vi.waitFor(() => expect(dropped).toBeGreaterThanOrEqual(2), { timeout: 3000, interval: 5 });
    await vi.waitFor(() => expect(itemById(store, item.localId).offline).toBe(true), { timeout: 3000, interval: 5 });
    t.setOnline(true);
    await vi.waitFor(() => expect(dropped).toBe(3), { timeout: 3000, interval: 5 });
    await vi.waitFor(() => expect(itemById(store, item.localId).offline).toBe(true), { timeout: 3000, interval: 5 });
    t.setOnline(true);
    const done = await settle(store, item.localId);
    // three network drops with maxRetries = 1 still succeed: offline waits are free
    expect(done.status).toBe('done');
    expect(done.offline).toBe(false);
    await expectSameBytes(file, server.uploads.get('v1'));
  });

  it('automatically resumes uploads that failed because of the network when the browser goes online', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const t = testEnv();
    const store = createUploadStore({ api: server.api, env: t.env, maxRetries: 0 });
    let fail = true;
    server.hooks.put = ({ offset }) => {
      if (offset === 4 && fail) throw new TypeError('Failed to fetch');
    };
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 10)]);
    const failed = await settle(store, item.localId);
    expect(failed.errorCode).toBe('network');
    fail = false;
    t.setOnline(true);
    const done = await settle(store, item.localId, ['done']);
    expect(done.bytesSent).toBe(10);
  });

  it('pauses and resumes from the server offset', async () => {
    const server = fakeServer({ chunkSize: 2 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const file = bytesFile('a.mp4', 12);
    let paused = false;
    server.hooks.put = ({ offset }) => {
      if (offset === 6 && !paused) {
        paused = true;
        store.pause(store.getSnapshot().items[0].localId);
      }
    };
    const [item] = store.enqueue('c1', [file]);
    await settle(store, item.localId, ['paused']);
    await new Promise((r) => setTimeout(r, 30));
    const putsWhilePaused = server.calls.filter((c) => c.startsWith('put:')).length;
    await new Promise((r) => setTimeout(r, 30));
    expect(server.calls.filter((c) => c.startsWith('put:')).length).toBe(putsWhilePaused);
    expect(itemById(store, item.localId).status).toBe('paused');
    expect(store.hasActive('c1')).toBe(true);

    store.resume(item.localId);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(server.calls.filter((c) => c.startsWith('init:'))).toHaveLength(1);
    expect(server.calls).toContain('get:v1');
    await expectSameBytes(file, server.uploads.get('v1'));
  });

  it('cancels an upload and deletes the server-side source', async () => {
    const server = fakeServer({ chunkSize: 2 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 40)]);
    await vi.waitFor(() => expect(itemById(store, item.localId).bytesSent).toBeGreaterThanOrEqual(4), { timeout: 3000, interval: 2 });
    await store.cancel(item.localId);
    expect(itemById(store, item.localId).status).toBe('canceled');
    expect(server.calls).toContain('delete:v1');
    expect(server.uploads.has('v1')).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(itemById(store, item.localId).status).toBe('canceled');
    expect(server.calls).not.toContain('complete:v1');
  });

  it('deletes a source that was created while the cancel was already requested', async () => {
    const server = fakeServer({ chunkSize: 2 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    let release!: () => void;
    server.hooks.init = () => new Promise<void>((r) => (release = r));
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 8)]);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'), { interval: 2 });
    const canceling = store.cancel(item.localId);
    release();
    await canceling;
    await vi.waitFor(() => expect(server.calls).toContain('delete:v1'), { timeout: 3000, interval: 2 });
    expect(server.uploads.size).toBe(0);
    expect(itemById(store, item.localId).status).toBe('canceled');
  });

  it('remove() drops finished items without deleting their source and cancels unfinished ones', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const [a] = store.enqueue('c1', [bytesFile('a.mp4', 8)]);
    await settle(store, a.localId);
    await store.remove(a.localId);
    expect(store.getSnapshot().items).toHaveLength(0);
    expect(server.calls.some((c) => c.startsWith('delete:'))).toBe(false);
    expect(server.uploads.get('v1')?.status).toBe('uploaded');

    server.hooks.put = () => new Promise((r) => setTimeout(r, 5));
    const [b] = store.enqueue('c1', [bytesFile('b.mp4', 40)]);
    await vi.waitFor(() => expect(itemById(store, b.localId).videoId).toBe('v2'), { interval: 2 });
    await store.remove(b.localId);
    expect(store.getSnapshot().items).toHaveLength(0);
    expect(server.calls).toContain('delete:v2');
  });

  it('continues uploading when complete reports missing bytes', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const file = bytesFile('a.mp4', 12);
    server.hooks.complete = (videoId, n) => {
      if (n === 1) {
        // the disk lost the last chunk
        const u = server.uploads.get(videoId)!;
        u.received = 8;
      }
    };
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(server.calls).toEqual(['init:a.mp4', 'put:v1@0', 'put:v1@4', 'put:v1@8', 'complete:v1', 'put:v1@8', 'complete:v1']);
  });

  it('reports fatal errors with the server message and keeps other files going', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const original = server.api.initUpload;
    server.api.initUpload = async (cid, body) => {
      if (body.filename === 'bad.avi') throw new ApiClientError('Ezt a fájltípust nem tudjuk feldolgozni.', 415, 'unsupported');
      return original(cid, body);
    };
    const [bad, good] = store.enqueue('c1', [bytesFile('bad.avi', 8, 'video/x-msvideo'), bytesFile('good.mp4', 8)]);
    const failed = await settle(store, bad.localId);
    expect(failed.status).toBe('error');
    expect(failed.errorCode).toBe('unsupported');
    expect(failed.error).toBe('Ezt a fájltípust nem tudjuk feldolgozni.');
    expect((await settle(store, good.localId)).status).toBe('done');
  });

  it('continues an interrupted server-side upload when the same file is picked again', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const file = bytesFile('shelf.mov', 12, 'video/quicktime');
    const buf = new Uint8Array(await file.arrayBuffer());
    server.uploads.set('old', {
      collectionId: 'c1',
      name: 'shelf.mov',
      size: 12,
      data: (() => {
        const d = new Uint8Array(12);
        d.set(buf.subarray(0, 8));
        return d;
      })(),
      received: 8,
      status: 'uploading',
    });
    const store = createUploadStore({ api: server.api, env });
    const [item] = store.enqueue('c1', [file], {
      resumable: [
        { videoId: 'other', name: 'shelf.mov', size: 99 },
        { videoId: 'old', name: 'shelf.mov', size: 12 },
      ],
    });
    expect(item.videoId).toBe('old');
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(server.calls).toEqual(['get:old', 'put:old@8', 'complete:old']);
    await expectSameBytes(file, server.uploads.get('old'));
  });

  it('starts a fresh upload when the remembered one no longer exists', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 6)], { resumable: [{ videoId: 'gone', name: 'a.mp4', size: 6 }] });
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    expect(done.videoId).toBe('v1');
    expect(server.calls.slice(0, 2)).toEqual(['get:gone', 'init:a.mp4']);
  });

  it('shrinks the chunk size when the server rejects a chunk as too large', async () => {
    const server = fakeServer({ chunkSize: 1024 * 1024 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const original = server.api.putChunk;
    server.api.putChunk = async (videoId, offset, chunk, signal) => {
      if (chunk.size > 600 * 1024) {
        throw new ApiClientError('too large', 413, 'too_large', { bytesReceived: offset, maxChunkBytes: 700 * 1024 });
      }
      return original(videoId, offset, chunk, signal);
    };
    const file = bytesFile('a.mp4', 900 * 1024);
    const [item] = store.enqueue('c1', [file]);
    const done = await settle(store, item.localId);
    expect(done.status).toBe('done');
    await expectSameBytes(file, server.uploads.get('v1'));
  });

  it('warns before unload only while uploads are unfinished', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const t = testEnv();
    const store = createUploadStore({ api: server.api, env: t.env });
    expect(t.warns()).toBe(false);
    const [item] = store.enqueue('c1', [bytesFile('a.mp4', 8)]);
    expect(t.warns()).toBe(true);
    await settle(store, item.localId);
    expect(t.warns()).toBe(false);
  });

  it('keeps the snapshot referentially stable between changes and tracks the draft', () => {
    const server = fakeServer();
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const a = store.getSnapshot();
    expect(store.getSnapshot()).toBe(a);
    expect(store.getServerSnapshot().items).toHaveLength(0);
    store.setDraft({
      collectionId: '123456789',
      ownerToken: 'tok',
      publicUrl: 'http://x/123456789',
      ownerUrl: 'http://x/123456789?k=tok',
      sent: { title: '', ownerName: '', email: '' },
      createdAt: 1,
    });
    const b = store.getSnapshot();
    expect(b).not.toBe(a);
    store.updateDraftSent({ title: 'Nappali', ownerName: '', email: '' });
    expect(store.getSnapshot().draft?.sent.title).toBe('Nappali');
    store.setDraft(null);
    expect(store.getSnapshot().draft).toBeNull();
  });

  it('clearFinished() only removes done and canceled items of the given collection', async () => {
    const server = fakeServer({ chunkSize: 4 });
    const { env } = testEnv();
    const store = createUploadStore({ api: server.api, env });
    const [a] = store.enqueue('c1', [bytesFile('a.mp4', 4)]);
    const [b] = store.enqueue('c2', [bytesFile('b.mp4', 4)]);
    await settle(store, a.localId);
    await settle(store, b.localId);
    store.clearFinished('c1');
    expect(store.getSnapshot().items.map((i) => i.collectionId)).toEqual(['c2']);
    expect(store.getFile(a.localId)).toBeUndefined();
    expect(store.getFile(b.localId)).toBeDefined();
  });
});

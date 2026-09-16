'use client';

/**
 * Tiny JPEG thumbnails for picked files, generated in the browser one at a time:
 * videos via a detached <video> + canvas (poster frame at ~25 %), photos via an <img> + canvas.
 * Object URLs are revoked as soon as the thumbnail is drawn; results are cached per File, so a
 * list that re-mounts after navigation does not decode the video again.
 */
export interface FileThumbnail {
  /** data: URL of a small JPEG, null when the browser cannot decode the file (e.g. HEVC on desktop) */
  url: string | null;
  /** video duration in seconds when known */
  duration: number | null;
  width: number | null;
  height: number | null;
}

const EMPTY: FileThumbnail = { url: null, duration: null, width: null, height: null };
const THUMB_EDGE = 192;
const STEP_TIMEOUT_MS = 8000;

const cache = new WeakMap<Blob, Promise<FileThumbnail>>();
let chain: Promise<unknown> = Promise.resolve();

function waitFor(target: EventTarget, event: string, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`error while waiting for ${event}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function draw(source: CanvasImageSource, srcW: number, srcH: number): string | null {
  if (!srcW || !srcH) return null;
  const scale = Math.min(1, THUMB_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  try {
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

async function videoThumbnail(file: Blob): Promise<FileThumbnail> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  try {
    const loaded = waitFor(video, 'loadeddata');
    video.src = url;
    await loaded;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const target = duration ? Math.min(2, duration * 0.25) : 0;
    if (target > 0.05) {
      const seeked = waitFor(video, 'seeked');
      video.currentTime = target;
      await seeked.catch(() => undefined);
    }
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    return { url: width && height ? draw(video, width, height) : null, duration, width, height };
  } catch {
    return EMPTY;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function imageThumbnail(file: Blob): Promise<FileThumbnail> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    img.src = url;
    if (typeof img.decode === 'function') await img.decode();
    else await waitFor(img, 'load');
    const width = img.naturalWidth || null;
    const height = img.naturalHeight || null;
    return { url: width && height ? draw(img, width, height) : null, duration: null, width, height };
  } catch {
    return EMPTY;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Cached, serialised thumbnail generation (never rejects). */
export function getFileThumbnail(file: Blob, kind: 'video' | 'image'): Promise<FileThumbnail> {
  if (typeof document === 'undefined') return Promise.resolve(EMPTY);
  const hit = cache.get(file);
  if (hit) return hit;
  const job = chain.then(
    () => (kind === 'video' ? videoThumbnail(file) : imageThumbnail(file)),
    () => (kind === 'video' ? videoThumbnail(file) : imageThumbnail(file)),
  );
  const safe = job.catch(() => EMPTY);
  chain = safe;
  cache.set(file, safe);
  return safe;
}

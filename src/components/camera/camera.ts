/**
 * Pure helpers of the in-app shelf recorder (no React; unit tested in camera.test.ts).
 * The only functions that look at the real browser are `browserRecordingEnvironment()` and
 * `isInAppRecordingSupported()` at the bottom – both are safe to call on the server (they report "unsupported").
 */

export type CameraFacing = 'environment' | 'user';

/** Why the in-app camera cannot be used; drives the fallback screen. */
export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'not_found' | 'in_use' | 'unknown';

export type RecordingContainer = 'mp4' | 'webm';

export type Platform = 'ios' | 'android' | 'other';

/** Per-clip limit when the caller does not pass `maxDurationSec`. */
export const DEFAULT_MAX_DURATION_SEC = 180;
/** Shorter recordings are dropped (accidental double taps). */
export const MIN_CLIP_SEC = 1;
/** The timer turns amber this many seconds before the limit. */
export const WARNING_WINDOW_SEC = 15;
export const RECORDER_TIMESLICE_MS = 1000;
export const VIDEO_BITS_PER_SECOND = 8_000_000;

/** Preferred recording formats, best first: iOS Safari records MP4, Chrome MP4 (126+) or WebM. */
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

/**
 * First candidate the browser can record, or '' when none is (then the browser picks its default).
 *   pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t))
 */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string {
  for (const type of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // some engines throw for codec strings they do not understand – treat as unsupported
    }
  }
  return '';
}

/** "Video/WebM; codecs=vp9" → "video/webm" */
export function baseMimeType(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

const MP4_FAMILY = new Set(['video/mp4', 'audio/mp4', 'video/x-m4v', 'video/quicktime', 'video/3gpp']);

/** File extension for a recorder MIME type: the MP4 family → "mp4", everything else (WebM, Matroska, '') → "webm". */
export function extensionForMime(mime: string): RecordingContainer {
  return MP4_FAMILY.has(baseMimeType(mime)) ? 'mp4' : 'webm';
}

/** The MIME type a recorded file is labelled with (no codecs parameter – the upload API expects a plain type). */
export function mimeForContainer(container: RecordingContainer): 'video/mp4' | 'video/webm' {
  return container === 'mp4' ? 'video/mp4' : 'video/webm';
}

/**
 * Container of a recording from its first bytes: ISO-BMFF ("ftyp" box at offset 4) → mp4,
 * EBML header 1A 45 DF A3 (WebM / Matroska) → webm, otherwise null.
 */
export function sniffContainer(head: ArrayLike<number>): RecordingContainer | null {
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'mp4';
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `polc-YYYYMMDD-HHMMSS.<mp4|webm>` in local time, e.g. polc-20260916-073509.mp4 */
export function recordingFileName(date: Date, mime: string): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `polc-${day}-${time}.${extensionForMime(mime)}`;
}

/** Recording clock: 0 → "00:00", 65.9 → "01:05", 3725 → "1:02:05" (fractions floored, invalid → "00:00"). */
export function formatClock(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Minutes and whole seconds for spoken read-outs ("1 perc 5 másodperc"). */
export function clockParts(sec: number): { minutes: number; seconds: number } {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** true in the last WARNING_WINDOW_SEC seconds before the limit (the timer turns amber). */
export function isNearLimit(elapsedSec: number, maxDurationSec: number): boolean {
  return elapsedSec >= maxDurationSec - WARNING_WINDOW_SEC;
}

/** Elapsed share of the limit, clamped to 0..1 (progress ring around the shutter). */
export function limitProgress(elapsedSec: number, maxDurationSec: number): number {
  if (!(maxDurationSec > 0) || !Number.isFinite(elapsedSec)) return 0;
  return Math.min(1, Math.max(0, elapsedSec / maxDurationSec));
}

/** A recording worth keeping: at least MIN_CLIP_SEC long and not empty. */
export function isUsableClip(durationSec: number, sizeBytes: number): boolean {
  return Number.isFinite(durationSec) && durationSec >= MIN_CLIP_SEC && sizeBytes > 0;
}

/**
 * Video constraints for getUserMedia: Full HD at 30 fps from the requested camera
 * (`deviceId` pins one device exactly – used when facingMode cannot tell two cameras apart).
 */
export function videoConstraints(facing: CameraFacing, deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  };
}

/** Full getUserMedia constraints (never audio – the pipeline only needs the picture). */
export function mediaStreamConstraints(facing: CameraFacing, deviceId?: string): MediaStreamConstraints {
  return { audio: false, video: videoConstraints(facing, deviceId) };
}

/**
 * Maps a getUserMedia / MediaRecorder failure to what we tell the user.
 * Names cover the standard DOMExceptions and the legacy Chrome / Firefox aliases.
 */
export function classifyMediaError(err: unknown): CameraProblem {
  const name =
    err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
      ? (err as { name: string }).name
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'SecurityError':
      return 'insecure';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
    // Firefox reports a camera held by another application as "AbortError: Starting videoinput failed"
    case 'AbortError':
      return 'in_use';
    case 'NotSupportedError':
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** Problems worth retrying automatically when the user comes back to the tab (e.g. from the Settings app). */
export function isRetryableOnReturn(problem: CameraProblem | null): boolean {
  return problem === 'denied' || problem === 'in_use';
}

/** Problems for which "Try again" can help (the environment problems cannot change without a reload). */
export function canRetry(problem: CameraProblem): boolean {
  return problem !== 'insecure' && problem !== 'unsupported';
}

/** Torch support from MediaStreamTrack.getCapabilities() (a boolean, or [true, false] in some builds). */
export function isTorchSupported(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object' || !('torch' in capabilities)) return false;
  const torch = (capabilities as { torch: unknown }).torch;
  return torch === true || (Array.isArray(torch) && torch.includes(true));
}

/** The device after `currentId` in `ids` (cyclic); null when there is nothing to switch to. */
export function nextDeviceId(ids: readonly string[], currentId: string | null | undefined): string | null {
  const usable = ids.filter(Boolean);
  if (usable.length < 2) return null;
  const i = currentId ? usable.indexOf(currentId) : -1;
  return usable[(i + 1) % usable.length];
}

/** Phone platform for permission hints (iPadOS reports a Mac user agent, but has touch points). */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'other';
}

/** The iOS browser whose entry in the Settings app holds the camera permission. */
export function iosSettingsApp(userAgent: string): string {
  if (/CriOS/.test(userAgent)) return 'Chrome';
  if (/FxiOS/.test(userAgent)) return 'Firefox';
  if (/EdgiOS/.test(userAgent)) return 'Edge';
  return 'Safari';
}

/* ------------------------------------------------------------------ */
/* Feature detection                                                    */
/* ------------------------------------------------------------------ */

export interface RecordingEnvironment {
  isSecureContext?: boolean;
  getUserMedia?: unknown;
  MediaRecorder?: unknown;
}

/**
 * Why in-app recording is impossible in this environment ('insecure' = plain http on a phone),
 * or null when getUserMedia + MediaRecorder can be used.
 */
export function recordingSupportProblem(env: RecordingEnvironment): 'insecure' | 'unsupported' | null {
  if (env.isSecureContext === false) return 'insecure';
  if (env.isSecureContext !== true) return 'unsupported';
  if (typeof env.getUserMedia !== 'function' || typeof env.MediaRecorder === 'undefined') return 'unsupported';
  return null;
}

/** The current browser's capabilities ({} on the server). */
export function browserRecordingEnvironment(): RecordingEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
  return {
    isSecureContext: window.isSecureContext,
    getUserMedia: navigator.mediaDevices?.getUserMedia,
    MediaRecorder: typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder,
  };
}

/**
 * true when the recorder can film inside the page (secure context, getUserMedia and MediaRecorder).
 * Always false on the server – call it from an effect or an event handler.
 */
export function isInAppRecordingSupported(): boolean {
  return recordingSupportProblem(browserRecordingEnvironment()) === null;
}

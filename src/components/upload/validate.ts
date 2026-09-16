/**
 * Client-side checks for picked files (the API re-validates everything). Pure – unit tested.
 * The size and count limits come from the server (see ./limits); the defaults only apply to callers without them.
 */
import { fileExtension, fileKey, inferUploadMime } from '@/lib/client/upload-store';
import { DEFAULT_UPLOAD_LIMITS, maxUploadBytes } from './limits';

const DEFAULT_MAX_BYTES = maxUploadBytes(DEFAULT_UPLOAD_LIMITS);

/** `accept` for picking existing files. Explicit image types make iOS hand over JPEG instead of HEIC. */
export const PICK_ACCEPT =
  'video/*,image/jpeg,image/png,image/webp,.mp4,.m4v,.mov,.webm,.mkv,.3gp,.jpg,.jpeg,.png,.webp';
/** `accept` for the camera input (capture="environment"). */
export const CAPTURE_ACCEPT = 'video/*,image/*';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
/** containers the server cannot verify (only ISO-BMFF and Matroska/WebM pass its magic-byte check) */
const UNSUPPORTED_VIDEO_TYPES = new Set([
  'video/x-msvideo',
  'video/avi',
  'video/msvideo',
  'video/x-ms-wmv',
  'video/x-ms-asf',
  'video/x-flv',
  'video/mpeg',
  'video/mp2t',
  'video/ogg',
]);

export type RejectReason = 'type' | 'heic' | 'size' | 'empty' | 'count' | 'duplicate';

export interface Rejection {
  name: string;
  size: number;
  reason: RejectReason;
}

export interface PickedFileLike {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
}

/** Why a single file cannot be uploaded (null when it is fine). */
export function fileProblem(file: PickedFileLike, maxBytes = DEFAULT_MAX_BYTES): Exclude<RejectReason, 'count' | 'duplicate'> | null {
  const mime = inferUploadMime(file);
  const ext = fileExtension(file.name);
  if (HEIC_TYPES.has(mime) || ext === 'heic' || ext === 'heif') return 'heic';
  const isVideo = /^video\/[a-z0-9.+-]+$/.test(mime) && !UNSUPPORTED_VIDEO_TYPES.has(mime);
  if (!isVideo && !IMAGE_TYPES.has(mime)) return 'type';
  if (file.size <= 0) return 'empty';
  if (file.size > maxBytes) return 'size';
  return null;
}

/**
 * Splits picked files into accepted and rejected ones.
 * `existingKeys`: fileKey() of files already in the list; `slotsLeft`: how many more sources fit;
 * `maxBytes`: the per-file size limit (maxUploadBytes of the server limits).
 */
export function validateFiles<T extends PickedFileLike>(
  files: readonly T[],
  opts: { existingKeys?: ReadonlySet<string>; slotsLeft?: number; maxBytes?: number } = {},
): { accepted: T[]; rejected: Rejection[] } {
  const seen = new Set(opts.existingKeys ?? []);
  let slots = Math.max(0, opts.slotsLeft ?? DEFAULT_UPLOAD_LIMITS.maxSourcesPerCollection);
  const accepted: T[] = [];
  const rejected: Rejection[] = [];
  for (const file of files) {
    const key = fileKey(file);
    if (seen.has(key)) {
      rejected.push({ name: file.name, size: file.size, reason: 'duplicate' });
      continue;
    }
    const problem = fileProblem(file, opts.maxBytes);
    if (problem) {
      rejected.push({ name: file.name, size: file.size, reason: problem });
      continue;
    }
    if (slots <= 0) {
      rejected.push({ name: file.name, size: file.size, reason: 'count' });
      continue;
    }
    seen.add(key);
    slots -= 1;
    accepted.push(file);
  }
  return { accepted, rejected };
}

/** Loose e-mail syntax check for instant feedback (the API has the strict one). */
export function isPlausibleEmail(value: string): boolean {
  const s = value.trim();
  if (s.length > 254 || /[\s,;<>"\\]/.test(s)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(s);
}

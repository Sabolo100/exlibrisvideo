/**
 * Typed errors shared by the job queue, the worker and the video pipeline.
 *
 * `videos.error` stores one of the VideoErrorCode strings; the UI localises them.
 */

export type VideoErrorCode = 'too_long' | 'unreadable' | 'no_frames' | 'no_books' | 'ai_failed' | 'internal';

export const VIDEO_ERROR_CODES: readonly VideoErrorCode[] = [
  'too_long',
  'unreadable',
  'no_frames',
  'no_books',
  'ai_failed',
  'internal',
];

export function isVideoErrorCode(v: unknown): v is VideoErrorCode {
  return typeof v === 'string' && (VIDEO_ERROR_CODES as readonly string[]).includes(v);
}

/** Codes that will never succeed on a retry (the input itself is the problem). */
const NON_RETRYABLE: ReadonlySet<VideoErrorCode> = new Set(['too_long', 'unreadable', 'no_frames', 'no_books']);

export class PipelineError extends Error {
  readonly code: VideoErrorCode;
  readonly retryable: boolean;

  constructor(code: VideoErrorCode, message?: string, options?: { cause?: unknown; retryable?: boolean }) {
    super(message ?? code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PipelineError';
    this.code = code;
    this.retryable = options?.retryable ?? !NON_RETRYABLE.has(code);
  }
}

/** Thrown internally when the video row disappeared mid-run (owner removed the source). */
export class VideoGoneError extends Error {
  constructor(videoId: string) {
    super(`video ${videoId} no longer exists`);
    this.name = 'VideoGoneError';
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof PipelineError) return error.retryable;
  return true;
}

export function videoErrorCodeOf(error: unknown): VideoErrorCode {
  if (error instanceof PipelineError) return error.code;
  return 'internal';
}

/** Single-line, bounded error description suitable for jobs.last_error and logs (no stack noise). */
export function describeError(error: unknown, maxLength = 2000): string {
  let text: string;
  if (error instanceof Error) {
    const code = error instanceof PipelineError ? ` [${error.code}]` : '';
    text = `${error.name}${code}: ${error.message}`;
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) text += ` (cause: ${cause.name}: ${cause.message})`;
  } else if (typeof error === 'string') {
    text = error;
  } else {
    try {
      text = JSON.stringify(error);
    } catch {
      text = String(error);
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

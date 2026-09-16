/**
 * Localized messages for API client errors. The API keeps `code` within the SPEC error codes and
 * puts the specific sub-case into `details.reason` (wrong_pin, expired_link, pin_format …); both are
 * keys of the `errors` i18n area. Pure – safe in tests.
 */
import type { MessageKey } from '@/i18n';
import { errors as errorMessages } from '@/i18n/messages/errors';
import { ApiClientError } from '@/lib/client/api';

type T = (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string;

const ERROR_KEYS = new Set(Object.keys(errorMessages.hu));

/** `details.reason` of an API error, when present. */
export function errorReason(err: unknown): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const details = err.details;
  if (details && typeof details === 'object' && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === 'string' && reason ? reason : null;
  }
  return null;
}

/** The most specific known error key: reason first, then code; null for unknown / non-API errors. */
export function errorKey(err: unknown): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const reason = errorReason(err);
  if (reason && ERROR_KEYS.has(reason)) return reason;
  if (err.code && ERROR_KEYS.has(err.code)) return err.code;
  return null;
}

/** true when `err` is an API error with this code or reason. */
export function isApiError(err: unknown, codeOrReason: string): boolean {
  return err instanceof ApiClientError && (err.code === codeOrReason || errorReason(err) === codeOrReason);
}

/** fetch() rejected (offline, DNS, CORS) or the response was not JSON at all. */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiClientError) return false;
  if (err instanceof TypeError) return true;
  // JSON.parse failures of a proxy error page surface as SyntaxError
  return err instanceof SyntaxError;
}

/** A code-split chunk that failed to download (deploy in between, flaky network): only a reload helps. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /loading (css )?chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(error.message)
  );
}

/** Aborted requests (navigation, unmount) should never be reported. */
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * Human message for any error thrown by `api.*`: the localized `errors.<reason|code>` text,
 * a connection message for network failures, else the generic internal error text.
 */
export function apiErrorMessage(err: unknown, t: T): string {
  if (isNetworkError(err)) return t('collection.toast.network');
  const key = errorKey(err);
  if (key) return t(`errors.${key}` as MessageKey);
  return t('errors.internal');
}

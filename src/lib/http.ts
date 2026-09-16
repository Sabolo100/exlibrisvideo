/**
 * HTTP helpers shared by every Route Handler under src/app/api (owner: api).
 *
 *  - `json()` / `apiError()` build responses (errors are localized through `errors.<key>`)
 *  - `HttpError` is thrown from anywhere in a handler; `withErrorHandling()` turns it (and ZodError /
 *    unexpected exceptions) into an `ApiError` JSON body
 *  - request parsing (`parseJson` with a byte limit), client IP, protocol and cookie helpers
 *
 * Server-only. Never logs request bodies, cookies, tokens or query strings.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { localeFromRequest } from '@/i18n/server';
import { translate, type MessageKey } from '@/i18n/index';
import type { errors } from '@/i18n/messages/errors';
import { clientIpFromHeaders } from '@/lib/security/cookies';
import type { ApiError, Locale } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Error codes                                                          */
/* ------------------------------------------------------------------ */

/** Machine-readable `ApiError.code` values (SPEC §3). */
export const API_ERROR_CODES = [
  'invalid',
  'not_found',
  'forbidden',
  'needs_pin',
  'rate_limited',
  'too_large',
  'conflict',
  'unsupported',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Every key of the `errors` i18n area: a base code or a more specific reason. */
export type ErrorKey = Extract<keyof (typeof errors)['hu'], string>;

/** Maps each message key to the base code sent as `ApiError.code`. */
export const ERROR_KEY_CODE: Record<ErrorKey, ApiErrorCode> = {
  invalid: 'invalid',
  not_found: 'not_found',
  forbidden: 'forbidden',
  needs_pin: 'needs_pin',
  rate_limited: 'rate_limited',
  too_large: 'too_large',
  conflict: 'conflict',
  unsupported: 'unsupported',
  internal: 'internal',
  wrong_pin: 'forbidden',
  expired_link: 'forbidden',
  bad_owner_link: 'forbidden',
  unauthorized: 'forbidden',
  upload_incomplete: 'conflict',
  upload_closed: 'conflict',
  too_many_sources: 'invalid',
  too_many_books: 'invalid',
  bad_email: 'invalid',
  pin_format: 'invalid',
};

export type ErrorDetails = Record<string, unknown>;

/** Throw from handlers / services; converted to an ApiError response by `withErrorHandling`. */
export class HttpError extends Error {
  readonly status: number;
  readonly key: ErrorKey;
  readonly details?: ErrorDetails;
  readonly headers?: Record<string, string>;

  constructor(status: number, key: ErrorKey, details?: ErrorDetails, headers?: Record<string, string>) {
    super(`${status} ${key}`);
    this.name = 'HttpError';
    this.status = status;
    this.key = key;
    this.details = details;
    this.headers = headers;
  }

  get code(): ApiErrorCode {
    return ERROR_KEY_CODE[this.key];
  }
}

/* ------------------------------------------------------------------ */
/* Responses                                                            */
/* ------------------------------------------------------------------ */

type HeaderPairs = Headers | Record<string, string> | [string, string][];

/** JSON response. Defaults: status 200, `Cache-Control: no-store` (per-viewer data). */
export function json(data: unknown, init?: number | (ResponseInit & { headers?: HeaderPairs })): Response {
  const opts: ResponseInit = typeof init === 'number' ? { status: init } : (init ?? {});
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...opts, headers });
}

/** 204 No Content. */
export function noContent(headers?: HeaderPairs): Response {
  const h = new Headers(headers);
  h.set('Cache-Control', 'no-store');
  return new Response(null, { status: 204, headers: h });
}

/**
 * Localized ApiError response. `key` may be a base code or a specific reason; for reasons the body
 * carries the base code and `details.reason`.
 */
export function apiError(
  status: number,
  key: ErrorKey,
  locale: Locale,
  details?: ErrorDetails,
  headers?: Record<string, string>,
): Response {
  const code = ERROR_KEY_CODE[key] ?? 'internal';
  const body: ApiError = {
    error: translate(locale, `errors.${key}` as MessageKey),
    code,
  };
  const merged: ErrorDetails | undefined = key !== code ? { reason: key, ...(details ?? {}) } : details;
  if (merged && Object.keys(merged).length > 0) body.details = merged;
  return json(body, { status, headers });
}

/**
 * RFC 6266 / RFC 5987 `Content-Disposition` with an ASCII fallback and a UTF-8 encoded `filename*`.
 */
export function contentDisposition(filename: string, disposition: 'attachment' | 'inline' = 'attachment'): string {
  const name = filename.split(/[\\/]/).pop()?.trim() || 'download';
  const fallback =
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .slice(0, 150) || 'download';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_JSON_LIMIT_BYTES = 256 * 1024;

/** Reads the request body as UTF-8 text, refusing (413) bodies larger than `limitBytes`. */
export async function readBodyText(req: Request, limitBytes = DEFAULT_JSON_LIMIT_BYTES): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > limitBytes) {
    throw new HttpError(413, 'too_large');
  }
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, 'too_large');
      }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'invalid');
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))).toString('utf8');
}

/** Formats zod issues for `details.issues` (paths + messages, no input values). */
export function zodIssues(error: z.ZodError): { path: string; code: string; message: string }[] {
  return error.issues.slice(0, 20).map((i) => ({
    path: i.path.map((p) => String(p)).join('.'),
    code: i.code,
    message: i.message,
  }));
}

/**
 * Parses and validates a JSON body. Empty body is treated as `{}`.
 * Throws HttpError 400 `invalid` (malformed JSON / schema mismatch) or 413 `too_large`.
 */
export async function parseJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  limitBytes = DEFAULT_JSON_LIMIT_BYTES,
): Promise<z.output<S>> {
  const text = await readBodyText(req, limitBytes);
  let data: unknown = {};
  if (text.trim() !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid', { issues: [{ path: '', code: 'invalid_json', message: 'Malformed JSON' }] });
    }
  }
  const parsed = await schema.safeParseAsync(data);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid', { issues: zodIssues(parsed.error) });
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ */
/* Error handling wrapper                                               */
/* ------------------------------------------------------------------ */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeLocale(req: Request): Locale {
  try {
    return localeFromRequest(req);
  } catch {
    return 'hu';
  }
}

function safePath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return '?';
  }
}

/**
 * Wraps a Route Handler:
 *  - rejects cross-site unsafe requests (`Sec-Fetch-Site: cross-site`) as CSRF defence in depth
 *  - HttpError → its status + localized ApiError
 *  - ZodError → 400 `invalid`
 *  - anything else → 500 `internal` with a request id that is also logged
 */
export function withErrorHandling<C>(
  handler: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (UNSAFE_METHODS.has(req.method.toUpperCase()) && req.headers.get('sec-fetch-site') === 'cross-site') {
        throw new HttpError(403, 'forbidden');
      }
      return await handler(req, ctx);
    } catch (err) {
      const locale = safeLocale(req);
      if (err instanceof HttpError) {
        return apiError(err.status, err.key, locale, err.details, err.headers);
      }
      if (err instanceof z.ZodError) {
        return apiError(400, 'invalid', locale, { issues: zodIssues(err) });
      }
      const requestId = crypto.randomUUID();
      const e = err instanceof Error ? err : new Error(String(err));
      console.error('[api] unhandled error', {
        requestId,
        method: req.method,
        path: safePath(req),
        name: e.name,
        message: e.message,
        stack: e.stack?.split('\n').slice(0, 8).join(' | '),
      });
      return apiError(500, 'internal', locale, { requestId });
    }
  };
}

/* ------------------------------------------------------------------ */
/* Client info                                                          */
/* ------------------------------------------------------------------ */

/** Client IP: first hop of `x-forwarded-for`, then `x-real-ip`, else "unknown". */
export function getClientIp(req: Request): string {
  return clientIpFromHeaders(req.headers);
}

/* ------------------------------------------------------------------ */
/* Cookies & protocol (implemented without Next.js deps, re-exported)   */
/* ------------------------------------------------------------------ */

export {
  clientIpFromHeaders,
  isHttps,
  serializeCookie,
  parseCookieHeader,
  readCookie,
  type CookieOptions,
} from '@/lib/security/cookies';

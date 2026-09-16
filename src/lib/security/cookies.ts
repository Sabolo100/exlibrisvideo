/**
 * Cookie + request-protocol helpers without Next.js dependencies (usable from route handlers, the
 * worker and tests). Re-exported by src/lib/http.ts. Server-only (owner: api).
 */

/** True when the request reached the proxy over HTTPS (`x-forwarded-proto` first value) or the URL is https. */
export function isHttps(req: Request): boolean {
  const xfp = req.headers.get('x-forwarded-proto');
  if (xfp && xfp.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Client IP from proxy headers: first hop of `x-forwarded-for`, then `x-real-ip`, else "unknown". */
export function clientIpFromHeaders(headers: Pick<Headers, 'get'>): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  return 'unknown';
}

const COOKIE_NAME_RE = /^[A-Za-z0-9_\-]+$/;
const COOKIE_VALUE_RE = /^[A-Za-z0-9_\-.~]*$/;

export interface CookieOptions {
  /** seconds; 0 deletes the cookie */
  maxAge: number;
  /** default true */
  httpOnly?: boolean;
}

/**
 * `Set-Cookie` header value: HttpOnly, SameSite=Lax, Path=/, Max-Age; `Secure` only when the request
 * itself is HTTPS (never derived from NODE_ENV – Coolify can be reached over plain HTTP).
 */
export function serializeCookie(req: Request, name: string, value: string, opts: CookieOptions): string {
  if (!COOKIE_NAME_RE.test(name)) throw new Error('Invalid cookie name');
  if (!COOKIE_VALUE_RE.test(value)) throw new Error('Invalid cookie value');
  const maxAge = Math.max(0, Math.floor(opts.maxAge));
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

/** Parses a `Cookie` header (first occurrence of a name wins). */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out.set(name, value);
  }
  return out;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookieHeader(req.headers.get('cookie')).get(name);
}

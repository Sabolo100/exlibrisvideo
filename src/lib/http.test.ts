import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  apiError,
  contentDisposition,
  getClientIp,
  HttpError,
  isHttps,
  json,
  parseCookieHeader,
  parseJson,
  serializeCookie,
  withErrorHandling,
} from './http';

const req = (url = 'http://localhost/api/x', init?: RequestInit) => new Request(url, init);

describe('client info', () => {
  it('getClientIp prefers the first x-forwarded-for hop, then x-real-ip', () => {
    expect(getClientIp(req(undefined, { headers: { 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' } }))).toBe('203.0.113.7');
    expect(getClientIp(req(undefined, { headers: { 'x-real-ip': '198.51.100.2' } }))).toBe('198.51.100.2');
    expect(getClientIp(req(undefined, { headers: { 'x-forwarded-for': '', 'x-real-ip': '198.51.100.2' } }))).toBe('198.51.100.2');
    expect(getClientIp(req())).toBe('unknown');
  });

  it('isHttps uses x-forwarded-proto first value or the URL protocol', () => {
    expect(isHttps(req('http://x/'))).toBe(false);
    expect(isHttps(req('https://x/'))).toBe(true);
    expect(isHttps(req('http://x/', { headers: { 'x-forwarded-proto': 'https' } }))).toBe(true);
    expect(isHttps(req('http://x/', { headers: { 'x-forwarded-proto': 'https, http' } }))).toBe(true);
    expect(isHttps(req('http://x/', { headers: { 'x-forwarded-proto': 'http, https' } }))).toBe(false);
  });
});

describe('cookies', () => {
  it('serializeCookie sets Secure only for https requests (never from NODE_ENV)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const plain = serializeCookie(req('http://x/'), 'exl_own_123456789', 'abc_-', { maxAge: 34560000 });
    expect(plain).toBe('exl_own_123456789=abc_-; Path=/; Max-Age=34560000; SameSite=Lax; HttpOnly');
    const secure = serializeCookie(req('http://x/', { headers: { 'x-forwarded-proto': 'https' } }), 'a', 'b', { maxAge: 10 });
    expect(secure).toContain('; Secure');
    vi.unstubAllEnvs();
  });

  it('rejects unsafe names / values and supports deletion', () => {
    expect(() => serializeCookie(req(), 'a;b', 'x', { maxAge: 1 })).toThrow();
    expect(() => serializeCookie(req(), 'a', 'x; Domain=evil', { maxAge: 1 })).toThrow();
    expect(serializeCookie(req(), 'a', '', { maxAge: 0 })).toContain('Max-Age=0; SameSite=Lax; Expires=');
  });

  it('parseCookieHeader', () => {
    const jar = parseCookieHeader('a=1; b="two"; a=3; bad; =x; exl_lang=en');
    expect(jar.get('a')).toBe('1');
    expect(jar.get('b')).toBe('two');
    expect(jar.get('exl_lang')).toBe('en');
    expect(jar.size).toBe(3);
  });
});

describe('responses', () => {
  it('json sets content type and no-store', async () => {
    const res = json({ a: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('apiError localizes and maps reasons to base codes', async () => {
    const hu = await apiError(404, 'not_found', 'hu').json();
    expect(hu).toEqual({ error: expect.stringContaining('Nem találjuk'), code: 'not_found' });
    const en = await apiError(403, 'wrong_pin', 'en', { attempts: 1 }).json();
    expect(en).toEqual({ error: 'Incorrect PIN. Please try again.', code: 'forbidden', details: { reason: 'wrong_pin', attempts: 1 } });
  });

  it('contentDisposition encodes RFC 5987 filename*', () => {
    expect(contentDisposition('exlibris-123456789.xlsx')).toBe(
      `attachment; filename="exlibris-123456789.xlsx"; filename*=UTF-8''exlibris-123456789.xlsx`,
    );
    const v = contentDisposition('Könyvtár (ő).pdf');
    expect(v).toContain(`filename="Konyvtar_o_.pdf"`);
    expect(v).toContain(`filename*=UTF-8''K%C3%B6nyvt%C3%A1r%20%28%C5%91%29.pdf`);
    expect(contentDisposition('../../etc/passwd')).toContain('filename="passwd"');
  });
});

describe('parseJson', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('parses valid bodies and treats empty as {}', async () => {
    expect(await parseJson(req('http://x/', { method: 'POST', body: '{"name":"a"}' }), schema)).toEqual({ name: 'a' });
    await expect(parseJson(req('http://x/', { method: 'POST' }), z.object({}))).resolves.toEqual({});
  });

  it('rejects malformed, invalid and oversized bodies', async () => {
    await expect(parseJson(req('http://x/', { method: 'POST', body: '{nope' }), schema)).rejects.toMatchObject({ status: 400, key: 'invalid' });
    await expect(parseJson(req('http://x/', { method: 'POST', body: '{"name":""}' }), schema)).rejects.toMatchObject({ status: 400 });
    await expect(
      parseJson(req('http://x/', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(2000) }) }), schema, 1000),
    ).rejects.toMatchObject({ status: 413, key: 'too_large' });
  });
});

describe('withErrorHandling', () => {
  it('maps HttpError, ZodError and unknown errors', async () => {
    const h1 = withErrorHandling(async () => {
      throw new HttpError(429, 'rate_limited', { retryAfterSec: 5 }, { 'Retry-After': '5' });
    });
    const r1 = await h1(req('http://x/?lang=en'), undefined);
    expect(r1.status).toBe(429);
    expect(r1.headers.get('retry-after')).toBe('5');
    expect(await r1.json()).toMatchObject({ code: 'rate_limited', details: { retryAfterSec: 5 } });

    const h2 = withErrorHandling(async () => {
      z.object({ a: z.number() }).parse({ a: 'x' });
      return json({});
    });
    const r2 = await h2(req(), undefined);
    expect(r2.status).toBe(400);
    expect((await r2.json()).code).toBe('invalid');

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h3 = withErrorHandling(async () => {
      throw new Error('boom secret=should-not-matter');
    });
    const r3 = await h3(req('http://x/api/y', { headers: { 'accept-language': 'hu-HU' } }), undefined);
    expect(r3.status).toBe(500);
    const body3 = await r3.json();
    expect(body3.code).toBe('internal');
    expect(body3.error).toContain('Váratlan hiba');
    expect(body3.details.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(spy).toHaveBeenCalledWith('[api] unhandled error', expect.objectContaining({ requestId: body3.details.requestId }));
    spy.mockRestore();
  });

  it('rejects cross-site unsafe requests', async () => {
    const h = withErrorHandling(async () => json({ ok: true }));
    const blocked = await h(req('http://x/', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), undefined);
    expect(blocked.status).toBe(403);
    const allowed = await h(req('http://x/', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }), undefined);
    expect(allowed.status).toBe(200);
    const getCross = await h(req('http://x/', { headers: { 'sec-fetch-site': 'cross-site' } }), undefined);
    expect(getCross.status).toBe(200);
  });
});

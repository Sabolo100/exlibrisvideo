/**
 * Smoke tests for the HTTP API: calls the exported route handlers with real `Request` objects against the
 * local PostgreSQL and a temporary STORAGE_DIR. Pipeline / export / text modules are mocked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const base = (process.env.EXL_TEST_TMP || process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/exl-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  Object.assign(process.env, {
    STORAGE_DIR: dir,
    APP_URL: 'http://localhost:3000',
    APP_SECRET: 'routes-test-secret-0123456789abcdef',
    UPLOAD_CHUNK_MB: '1',
    MAX_UPLOAD_MB: '5',
    MAX_SOURCES_PER_COLLECTION: '3',
    ADMIN_PASSWORD: 'admin-test-password',
  });
  return {
    dir,
    jobIds: [] as number[],
    pageCookies: new Map<string, string>(),
    pageHeaders: new Headers(),
  };
});

vi.mock('@/lib/jobs/queue', () => ({
  // Inserts a real row (run_at far in the future so no running worker picks it up).
  enqueueJob: vi.fn(async (type: string, payload: Record<string, unknown>, opts?: { dedupeKey?: string }) => {
    const { db: getDb } = await import('@/db');
    const result = await getDb().execute(sql`
      INSERT INTO jobs (type, payload, run_at)
      VALUES (${type}, ${JSON.stringify({ ...payload, ...(opts?.dedupeKey ? { _dedupe: opts.dedupeKey } : {}) })}::jsonb,
              now() + interval '365 days')
      RETURNING id
    `);
    const id = Number((result.rows[0] as { id: string }).id);
    state.jobIds.push(id);
    return id;
  }),
}));

vi.mock('@/lib/pipeline/text', () => ({
  authorSortKey: (author: string | null | undefined) => (author ? author.toLowerCase() : null),
  titleSortKey: (title: string) => title.toLowerCase(),
}));

vi.mock('@/lib/export', () => ({
  buildExport: vi.fn(async (collection: { id: string; books: unknown[]; email: string | null }, format: string, locale: string) => ({
    filename: `exlibris-${collection.id}.${format === 'goodreads' ? 'csv' : format}`,
    contentType: 'text/csv; charset=utf-8',
    body: Buffer.from(`books=${collection.books.length};locale=${locale};email=${collection.email ?? ''}`),
  })),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (state.pageCookies.has(name) ? { name, value: state.pageCookies.get(name)! } : undefined) }),
  headers: async () => state.pageHeaders,
}));

import { db, pool } from '@/db';
import { books, collections, frames, jobs, unreadSpines, videos } from '@/db/schema';
import { buildExport } from '@/lib/export';
import { getOgSummary, loadCollectionPage } from '@/lib/collections/queries';
import { buildRecoveryUrl } from '@/lib/collections/access';
import { sha256Hex, signRecovery } from '@/lib/security/tokens';
import { abs } from '@/lib/storage';
import type { BookDTO, CollectionDTO, CollectionStatusDTO, CollectionWithBooksDTO, CreateCollectionResponse, InitUploadResponse, VideoDTO } from '@/lib/types';

import { GET as adminOverview } from '@/app/api/admin/overview/route';
import { DELETE as deleteBookRoute, PATCH as patchBookRoute } from '@/app/api/books/[bookId]/route';
import { POST as addBookRoute } from '@/app/api/collections/[id]/books/route';
import { POST as mergeRoute } from '@/app/api/collections/[id]/books/merge/route';
import { POST as claimRoute } from '@/app/api/collections/[id]/claim/route';
import { POST as emailRoute } from '@/app/api/collections/[id]/email/route';
import { GET as exportRoute } from '@/app/api/collections/[id]/export/route';
import { GET as framesRoute } from '@/app/api/collections/[id]/frames/route';
import { DELETE as deleteCollectionRoute, GET as getCollectionRoute, PATCH as patchCollectionRoute } from '@/app/api/collections/[id]/route';
import { GET as statusRoute } from '@/app/api/collections/[id]/status/route';
import { POST as unlockRoute } from '@/app/api/collections/[id]/unlock/route';
import { DELETE as dismissSpineRoute, POST as nameSpineRoute } from '@/app/api/collections/[id]/unread-spines/[spineId]/route';
import { POST as initUploadRoute } from '@/app/api/collections/[id]/uploads/route';
import { POST as createCollectionRoute } from '@/app/api/collections/route';
import { GET as healthRoute } from '@/app/api/health/route';
import { GET as mediaRoute } from '@/app/api/media/[...path]/route';
import { POST as recoverRoute } from '@/app/api/recover/route';
import { POST as clientLogRoute } from '@/app/api/client-log/route';
import { POST as completeRoute } from '@/app/api/uploads/[videoId]/complete/route';
import { POST as reanalyzeRoute } from '@/app/api/uploads/[videoId]/reanalyze/route';
import { DELETE as deleteUploadRoute, GET as getUploadRoute, PUT as putChunkRoute } from '@/app/api/uploads/[videoId]/route';

const dbAvailable = await pool()
  .query('SELECT 1 FROM collections LIMIT 1')
  .then(() => true)
  .catch(() => false);

const IP = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const MiB = 1024 * 1024;
const createdCollections: string[] = [];
const RUN = Math.random().toString(36).slice(2, 10);
const FRIEND = `friend-${RUN}@example.org`;
const NOBODY = `nobody-${RUN}@example.org`;
const OTHER_IP = `198.19.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

type Opts = { body?: unknown; raw?: Uint8Array; cookies?: Record<string, string>; headers?: Record<string, string> };

function request(method: string, url: string, opts: Opts = {}): Request {
  const headers = new Headers(opts.headers);
  if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', IP);
  if (opts.cookies) headers.set('cookie', Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = opts.raw as unknown as BodyInit;
    headers.set('content-type', 'application/octet-stream');
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`http://localhost:3000${url}`, { method, headers, body });
}

const ctx = <T>(p: T) => ({ params: Promise.resolve(p) });

function setCookies(res: Response): Map<string, { value: string; header: string }> {
  const out = new Map<string, { value: string; header: string }>();
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eqIdx = pair.indexOf('=');
    out.set(pair.slice(0, eqIdx), { value: pair.slice(eqIdx + 1), header });
  }
  return out;
}

/** A real 1-second clip cut from the sample footage with ffmpeg (stream copy), or a synthetic MP4 header. */
async function makeClip(dir: string): Promise<{ data: Buffer; source: 'ffmpeg' | 'synthetic' }> {
  const source = path.resolve('Mintavideok/20260912_212903.mp4');
  const out = path.join(dir, 'clip-1s.mp4');
  if (existsSync(source)) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0', '-i', source, '-t', '1', '-c', 'copy', out]);
    if (r.status === 0 && existsSync(out)) return { data: await fs.readFile(out), source: 'ffmpeg' };
  }
  // Fallback (no ffmpeg / samples, e.g. CI): an ISO-BMFF header followed by filler, ~1.7 MiB.
  const buf = Buffer.alloc(Math.floor(1.7 * MiB), 7);
  Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(buf, 0);
  return { data: buf, source: 'synthetic' };
}

describe.skipIf(!dbAvailable)('HTTP API routes (PostgreSQL + storage)', () => {
  let clip: Buffer;
  let id = '';
  let token = '';
  let ownerCookie: Record<string, string> = {};

  beforeAll(async () => {
    await fs.mkdir(state.dir, { recursive: true });
    const made = await makeClip(state.dir);
    clip = made.data;
    console.info('[test] upload clip', { source: made.source, bytes: clip.length, dir: state.dir });
    if (existsSync(path.resolve('Mintavideok'))) expect(made.source).toBe('ffmpeg');
  });

  afterAll(async () => {
    if (createdCollections.length) await db().delete(collections).where(inArray(collections.id, createdCollections));
    if (state.jobIds.length) await db().delete(jobs).where(inArray(jobs.id, state.jobIds));
    await db().execute(sql`DELETE FROM rate_limits WHERE key LIKE ${'%' + IP + '%'} OR key LIKE ${'%' + OTHER_IP + '%'}`);
    for (const address of [FRIEND, NOBODY]) {
      await db().execute(sql`DELETE FROM rate_limits WHERE key = ${'recover:email:' + sha256Hex(address)}`);
    }
    for (const cid of createdCollections) {
      await db().execute(sql`DELETE FROM rate_limits WHERE key LIKE ${'%' + cid + '%'}`);
    }
    await fs.rm(state.dir, { recursive: true, force: true });
    await pool().end();
  });

  it('GET /api/health', async () => {
    const res = await healthRoute(request('GET', '/api/health'), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: true, version: expect.any(String) });
  });

  it('POST /api/collections creates a collection and sets the owner cookie', async () => {
    const bad = await createCollectionRoute(request('POST', '/api/collections', { body: { email: 'nope', locale: 'hu' } }), undefined);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'invalid', details: { reason: 'bad_email' } });

    const res = await createCollectionRoute(
      request('POST', '/api/collections', { body: { title: 'Nappali polc', email: 'Owner@Example.com', ownerName: 'Kata', locale: 'en' } }),
      undefined,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as CreateCollectionResponse;
    id = data.id;
    token = data.ownerToken;
    createdCollections.push(id);
    expect(id).toMatch(/^[1-9]\d{8}$/);
    expect(data.publicUrl).toBe(`http://localhost:3000/${id}`);
    expect(data.ownerUrl).toBe(`http://localhost:3000/${id}?k=${token}`);
    const cookies = setCookies(res);
    const own = cookies.get(`exl_own_${id}`);
    expect(own).toBeDefined();
    expect(own!.header).toContain('HttpOnly');
    expect(own!.header).toContain('SameSite=Lax');
    expect(own!.header).toContain('Max-Age=34560000');
    expect(own!.header).not.toContain('Secure');
    ownerCookie = { [`exl_own_${id}`]: own!.value };

    const secure = await createCollectionRoute(
      request('POST', '/api/collections', { body: { locale: 'hu' }, headers: { 'x-forwarded-proto': 'https' } }),
      undefined,
    );
    const secureData = (await secure.json()) as CreateCollectionResponse;
    createdCollections.push(secureData.id);
    expect(setCookies(secure).get(`exl_own_${secureData.id}`)!.header).toContain('; Secure');
  });

  it('POST /claim rejects wrong tokens and accepts the right token or a recovery link', async () => {
    const wrong = await claimRoute(request('POST', `/api/collections/${id}/claim`, { body: { token: 'x'.repeat(43) } }), ctx({ id }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: 'forbidden', details: { reason: 'bad_owner_link' } });

    const right = await claimRoute(request('POST', `/api/collections/${id}/claim`, { body: { token } }), ctx({ id }));
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ ok: true });
    expect(setCookies(right).get(`exl_own_${id}`)!.value).toBe(ownerCookie[`exl_own_${id}`]);

    const [row] = await db().select().from(collections).where(eq(collections.id, id));
    const recoveryUrl = buildRecoveryUrl(row);
    const recovery = new URL(recoveryUrl).searchParams.get('r')!;
    expect(recoveryUrl.startsWith(`http://localhost:3000/${id}?r=`)).toBe(true);
    const viaRecovery = await claimRoute(request('POST', `/api/collections/${id}/claim`, { body: { recovery } }), ctx({ id }));
    expect(viaRecovery.status).toBe(200);
    expect(setCookies(viaRecovery).has(`exl_own_${id}`)).toBe(true);

    const expired = signRecovery(id, row.ownerTokenHash, Math.floor(Date.now() / 1000) - 5);
    const expiredRes = await claimRoute(request('POST', `/api/collections/${id}/claim`, { body: { recovery: expired } }), ctx({ id }));
    expect(expiredRes.status).toBe(403);
    expect(await expiredRes.json()).toMatchObject({ code: 'forbidden', details: { reason: 'expired_link', expired: true } });

    const missing = await claimRoute(request('POST', '/api/collections/999999999/claim', { body: { token } }), ctx({ id: '999999999' }));
    expect(missing.status).toBe(404);
  });

  it('GET /api/collections/:id hides owner data and counts views once per 30 minutes', async () => {
    const anon = await getCollectionRoute(request('GET', `/api/collections/${id}`), ctx({ id }));
    expect(anon.status).toBe(200);
    const data = (await anon.json()) as CollectionWithBooksDTO;
    expect(data).toMatchObject({ id, isOwner: false, email: null, title: 'Nappali polc', locale: 'en', status: 'draft', books: [] });
    const seen = setCookies(anon).get(`exl_seen_${id}`);
    expect(seen?.header).toContain('Max-Age=1800');

    await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: { [`exl_seen_${id}`]: '1' } }), ctx({ id }));
    const owner = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: ownerCookie }), ctx({ id }));
    const ownerData = (await owner.json()) as CollectionWithBooksDTO;
    expect(ownerData).toMatchObject({ isOwner: true, email: 'owner@example.com' });
    expect(setCookies(owner).size).toBe(0);
    const [row] = await db().select({ viewCount: collections.viewCount }).from(collections).where(eq(collections.id, id));
    expect(row.viewCount).toBe(1);

    const bearer = await getCollectionRoute(request('GET', `/api/collections/${id}`, { headers: { authorization: `Bearer ${token}` } }), ctx({ id }));
    expect(((await bearer.json()) as CollectionDTO).isOwner).toBe(true);

    // The page render shares the throttle: the visitor already counted through the API is not counted again,
    // a new visitor is counted once, owners and `countView: false` never.
    const viewCount = async () =>
      (await db().select({ n: collections.viewCount }).from(collections).where(eq(collections.id, id)))[0].n;
    state.pageCookies.clear();
    state.pageHeaders = new Headers({ 'x-forwarded-for': IP });
    expect((await loadCollectionPage(id)).kind).toBe('ok');
    expect(await viewCount()).toBe(1);
    state.pageHeaders = new Headers({ 'x-forwarded-for': OTHER_IP, 'user-agent': 'RoutesTest/1.0' });
    await loadCollectionPage(id);
    await loadCollectionPage(id);
    await loadCollectionPage(id, { countView: false });
    expect(await viewCount()).toBe(2);
    const apiSameVisitor = await getCollectionRoute(
      request('GET', `/api/collections/${id}`, { headers: { 'x-forwarded-for': OTHER_IP, 'user-agent': 'RoutesTest/1.0' } }),
      ctx({ id }),
    );
    expect(setCookies(apiSameVisitor).has(`exl_seen_${id}`)).toBe(true);
    state.pageHeaders = new Headers({ 'x-forwarded-for': '198.51.100.99' });
    state.pageCookies.set(`exl_own_${id}`, ownerCookie[`exl_own_${id}`]);
    expect((await loadCollectionPage(id)).kind).toBe('ok');
    expect(await viewCount()).toBe(2);
    state.pageCookies.clear();
    state.pageHeaders = new Headers();

    for (const bad of ['123', '../etc', '012345678']) {
      expect((await getCollectionRoute(request('GET', `/api/collections/${bad}`), ctx({ id: bad }))).status).toBe(404);
    }
    const hu = await getCollectionRoute(request('GET', '/api/collections/999999999', { headers: { 'accept-language': 'hu' } }), ctx({ id: '999999999' }));
    expect(await hu.json()).toMatchObject({ code: 'not_found', error: expect.stringContaining('Nem találjuk') });
  });

  it('uploads: init → chunks (409 on wrong offset, 413 on oversize) → complete → process_video job', async () => {
    const initBody = { filename: 'C:\\fakepath\\polc.mp4', size: clip.length, mimeType: 'video/mp4' };
    const anonInit = await initUploadRoute(request('POST', `/api/collections/${id}/uploads`, { body: initBody }), ctx({ id }));
    expect(anonInit.status).toBe(403);
    expect((await anonInit.json()).code).toBe('forbidden');

    const tooBig = await initUploadRoute(
      request('POST', `/api/collections/${id}/uploads`, { body: { ...initBody, size: 6 * MiB }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(tooBig.status).toBe(413);
    const badMime = await initUploadRoute(
      request('POST', `/api/collections/${id}/uploads`, { body: { ...initBody, mimeType: 'text/html' }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(badMime.status).toBe(415);

    const init = await initUploadRoute(request('POST', `/api/collections/${id}/uploads`, { body: initBody, cookies: ownerCookie }), ctx({ id }));
    expect(init.status).toBe(201);
    const { videoId, chunkSize, bytesReceived } = (await init.json()) as InitUploadResponse;
    expect(chunkSize).toBe(MiB);
    expect(bytesReceived).toBe(0);
    const [videoRow] = await db().select().from(videos).where(eq(videos.id, videoId));
    expect(videoRow).toMatchObject({ originalFilename: 'polc.mp4', sortOrder: 0, uploadStatus: 'uploading', storagePath: `uploads/${id}/${videoId}.mp4` });

    // non-owner cannot write
    const anonPut = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=0`, { raw: clip.subarray(0, 10) }), ctx({ videoId }));
    expect(anonPut.status).toBe(403);

    // complete before all bytes arrived
    const early = await completeRoute(request('POST', `/api/uploads/${videoId}/complete`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: 'conflict', details: { reason: 'upload_incomplete', bytesReceived: 0 } });

    // first chunk
    const first = clip.subarray(0, chunkSize);
    const put1 = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=0`, { raw: first, cookies: ownerCookie }), ctx({ videoId }));
    expect(put1.status).toBe(200);
    expect(await put1.json()).toEqual({ bytesReceived: first.length });

    // wrong offset → 409 with the server's bytesReceived
    const wrong = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=0`, { raw: first, cookies: ownerCookie }), ctx({ videoId }));
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ code: 'conflict', details: { bytesReceived: first.length } });
    const badOffset = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=-1`, { raw: first, cookies: ownerCookie }), ctx({ videoId }));
    expect(badOffset.status).toBe(400);

    // oversized chunk (> UPLOAD_CHUNK_MB + 1 MiB) is refused and the file is truncated back
    const huge = new Uint8Array(2 * MiB + 10);
    await db().update(videos).set({ sizeBytes: 10 * MiB }).where(eq(videos.id, videoId));
    const tooLarge = await putChunkRoute(
      request('PUT', `/api/uploads/${videoId}?offset=${first.length}`, { raw: huge, cookies: ownerCookie }),
      ctx({ videoId }),
    );
    expect(tooLarge.status).toBe(413);
    await db().update(videos).set({ sizeBytes: clip.length }).where(eq(videos.id, videoId));
    expect((await fs.stat(abs(videoRow.storagePath!))).size).toBe(first.length);

    // a chunk that would exceed the declared size is refused too
    const overflow = await putChunkRoute(
      request('PUT', `/api/uploads/${videoId}?offset=${first.length}`, { raw: new Uint8Array(clip.length), cookies: ownerCookie }),
      ctx({ videoId }),
    );
    expect(overflow.status).toBe(413);
    expect((await fs.stat(abs(videoRow.storagePath!))).size).toBe(first.length);

    // resume info
    const resume = await getUploadRoute(request('GET', `/api/uploads/${videoId}`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(await resume.json()).toEqual({ bytesReceived: first.length, sizeBytes: clip.length, uploadStatus: 'uploading' });

    // remaining chunks, sent concurrently with a duplicate to exercise the per-video lock
    let offset = first.length;
    while (offset < clip.length) {
      const part = clip.subarray(offset, offset + chunkSize);
      const [a, b] = await Promise.all([
        putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=${offset}`, { raw: part, cookies: ownerCookie }), ctx({ videoId })),
        putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=${offset}`, { raw: part, cookies: ownerCookie }), ctx({ videoId })),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      offset += part.length;
    }
    const stored = await fs.readFile(abs(videoRow.storagePath!));
    expect(stored.equals(clip)).toBe(true);

    const done = await completeRoute(request('POST', `/api/uploads/${videoId}/complete`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(done.status).toBe(200);
    const { video } = (await done.json()) as { video: VideoDTO };
    expect(video).toMatchObject({ id: videoId, kind: 'video', uploadStatus: 'uploaded', status: 'queued', sizeBytes: clip.length });

    const [col] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, id));
    expect(col.status).toBe('processing');
    const jobRows = await db().execute(sql`SELECT type, status, payload FROM jobs WHERE type = 'process_video' AND payload->>'videoId' = ${videoId}`);
    expect(jobRows.rows).toHaveLength(1);
    expect(jobRows.rows[0]).toMatchObject({ status: 'queued', payload: { videoId, _dedupe: videoId } });

    // completing again is idempotent
    const again = await completeRoute(request('POST', `/api/uploads/${videoId}/complete`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(again.status).toBe(200);
    const closed = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=${clip.length}`, { raw: first, cookies: ownerCookie }), ctx({ videoId }));
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ details: { reason: 'upload_closed' } });

    const status = await statusRoute(request('GET', `/api/collections/${id}/status`), ctx({ id }));
    const statusData = (await status.json()) as CollectionStatusDTO;
    expect(statusData).toMatchObject({ id, status: 'processing', progress: 0, bookCount: 0 });
    expect(statusData.videos).toHaveLength(1);
  });

  it('uploads: magic-byte sniffing rejects disguised files; source limit; DELETE source', async () => {
    const fake = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));
    const init = await initUploadRoute(
      request('POST', `/api/collections/${id}/uploads`, { body: { filename: 'evil.mp4', size: fake.length, mimeType: 'video/mp4' }, cookies: ownerCookie }),
      ctx({ id }),
    );
    const { videoId } = (await init.json()) as InitUploadResponse;
    const put = await putChunkRoute(request('PUT', `/api/uploads/${videoId}?offset=0`, { raw: fake, cookies: ownerCookie }), ctx({ videoId }));
    expect(put.status).toBe(200);
    const complete = await completeRoute(request('POST', `/api/uploads/${videoId}/complete`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(complete.status).toBe(415);
    expect((await complete.json()).code).toBe('unsupported');
    const [row] = await db().select().from(videos).where(eq(videos.id, videoId));
    expect(row).toMatchObject({ uploadStatus: 'failed', status: 'error', storagePath: null });
    expect(existsSync(abs(`uploads/${id}/${videoId}.mp4`))).toBe(false);

    // containers that can never pass sniffing, and unknown types without a usable extension, fail fast
    for (const body of [
      { filename: 'old.avi', size: 100, mimeType: 'video/x-msvideo' },
      { filename: 'noext', size: 100, mimeType: '' },
      { filename: 'page.html', size: 100, mimeType: 'application/octet-stream' },
    ]) {
      const r = await initUploadRoute(request('POST', `/api/collections/${id}/uploads`, { body, cookies: ownerCookie }), ctx({ id }));
      expect(r.status, JSON.stringify(body)).toBe(415);
    }

    // MAX_SOURCES_PER_COLLECTION = 3 (failed uploads do not count): 1 uploaded + 2 more allowed.
    // The first one has no MIME type from the browser (extension decides) and turns out to be a PNG.
    const png = Buffer.alloc(100, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    const ids: string[] = [];
    for (const body of [
      { filename: 'P0.JPG', size: png.length, mimeType: '' },
      { filename: 'p1.jpg', size: 100, mimeType: 'image/jpeg' },
    ]) {
      const r = await initUploadRoute(request('POST', `/api/collections/${id}/uploads`, { body, cookies: ownerCookie }), ctx({ id }));
      expect(r.status).toBe(201);
      ids.push(((await r.json()) as InitUploadResponse).videoId);
    }
    const [photo] = await db().select().from(videos).where(eq(videos.id, ids[0]));
    expect(photo).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', sortOrder: 2, storagePath: `uploads/${id}/${ids[0]}.jpg` });
    await putChunkRoute(request('PUT', `/api/uploads/${ids[0]}?offset=0`, { raw: png, cookies: ownerCookie }), ctx({ videoId: ids[0] }));
    const photoDone = await completeRoute(request('POST', `/api/uploads/${ids[0]}/complete`, { cookies: ownerCookie }), ctx({ videoId: ids[0] }));
    expect(photoDone.status).toBe(200);
    expect(((await photoDone.json()) as { video: VideoDTO }).video).toMatchObject({ kind: 'image', status: 'queued' });
    const [photoRow] = await db().select({ mimeType: videos.mimeType }).from(videos).where(eq(videos.id, ids[0]));
    expect(photoRow.mimeType).toBe('image/png');
    const limit = await initUploadRoute(
      request('POST', `/api/collections/${id}/uploads`, { body: { filename: 'x.jpg', size: 100, mimeType: 'image/jpeg' }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(limit.status).toBe(400);
    expect(await limit.json()).toMatchObject({ code: 'invalid', details: { reason: 'too_many_sources' } });

    const anonDelete = await deleteUploadRoute(request('DELETE', `/api/uploads/${ids[0]}`), ctx({ videoId: ids[0] }));
    expect(anonDelete.status).toBe(403);
    for (const vid of [...ids, videoId]) {
      const del = await deleteUploadRoute(request('DELETE', `/api/uploads/${vid}`, { cookies: ownerCookie }), ctx({ videoId: vid }));
      expect(del.status).toBe(204);
    }
    const missing = await deleteUploadRoute(request('DELETE', `/api/uploads/${videoId}`, { cookies: ownerCookie }), ctx({ videoId }));
    expect(missing.status).toBe(404);
    const [col] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, id));
    expect(col.status).toBe('processing');
  });

  let bookId = '';

  it('books: owner adds / edits / merges; non-owners get 403', async () => {
    const anonAdd = await addBookRoute(request('POST', `/api/collections/${id}/books`, { body: { title: 'X' } }), ctx({ id }));
    expect(anonAdd.status).toBe(403);

    const add = await addBookRoute(
      request('POST', `/api/collections/${id}/books`, { body: { title: 'A Pál utcai fiúk', author: 'Molnár Ferenc', notes: 'titok' }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(add.status).toBe(201);
    const book = (await add.json()) as BookDTO;
    bookId = book.id;
    expect(book).toMatchObject({ source: 'manual', notes: 'titok', authorSort: 'molnár ferenc', titleSort: 'a pál utcai fiúk' });

    const anonPatch = await patchBookRoute(request('PATCH', `/api/books/${bookId}`, { body: { rating: 5 } }), ctx({ bookId }));
    expect(anonPatch.status).toBe(403);
    expect((await anonPatch.json()).code).toBe('forbidden');

    // another collection's owner cookie does not grant access
    const other = await createCollectionRoute(request('POST', '/api/collections', { body: { locale: 'hu' } }), undefined);
    const otherData = (await other.json()) as CreateCollectionResponse;
    createdCollections.push(otherData.id);
    const otherCookie = setCookies(other).get(`exl_own_${otherData.id}`)!.value;
    const crossPatch = await patchBookRoute(
      request('PATCH', `/api/books/${bookId}`, { body: { rating: 5 }, cookies: { [`exl_own_${otherData.id}`]: otherCookie, [`exl_own_${id}`]: otherCookie } }),
      ctx({ bookId }),
    );
    expect(crossPatch.status).toBe(403);

    const invalid = await patchBookRoute(request('PATCH', `/api/books/${bookId}`, { body: { rating: 9 }, cookies: ownerCookie }), ctx({ bookId }));
    expect(invalid.status).toBe(400);

    const patched = await patchBookRoute(
      request('PATCH', `/api/books/${bookId}`, { body: { rating: 5, readingStatus: 'read' }, headers: { authorization: `Bearer ${token}` } }),
      ctx({ bookId }),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ rating: 5, readingStatus: 'read' });

    const second = await addBookRoute(request('POST', `/api/collections/${id}/books`, { body: { title: 'Pál utcai fiúk' }, cookies: ownerCookie }), ctx({ id }));
    const secondBook = (await second.json()) as BookDTO;
    const anonMerge = await mergeRoute(request('POST', `/api/collections/${id}/books/merge`, { body: { keepId: bookId, mergeIds: [secondBook.id] } }), ctx({ id }));
    expect(anonMerge.status).toBe(403);
    const merge = await mergeRoute(
      request('POST', `/api/collections/${id}/books/merge`, { body: { keepId: bookId, mergeIds: [secondBook.id] }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(merge.status).toBe(200);
    expect(((await merge.json()) as BookDTO).id).toBe(bookId);
    // merging across collections is refused
    const cross = await mergeRoute(
      request('POST', `/api/collections/${otherData.id}/books/merge`, {
        body: { keepId: bookId, mergeIds: [bookId.replace(/.$/, '0')] },
        cookies: { [`exl_own_${otherData.id}`]: otherCookie },
      }),
      ctx({ id: otherData.id }),
    );
    expect([400, 404]).toContain(cross.status);

    const viewer = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: { [`exl_seen_${id}`]: '1' } }), ctx({ id }));
    const viewerBooks = ((await viewer.json()) as CollectionWithBooksDTO).books;
    expect(viewerBooks).toHaveLength(1);
    expect(viewerBooks[0].notes).toBeNull();

    const anonDelete = await deleteBookRoute(request('DELETE', `/api/books/${bookId}`), ctx({ bookId }));
    expect(anonDelete.status).toBe(403);
    expect((await deleteBookRoute(request('DELETE', '/api/books/not-a-uuid', { cookies: ownerCookie }), ctx({ bookId: 'not-a-uuid' }))).status).toBe(404);
  });

  it('frames + export + media for link collections', async () => {
    const framesRes = await framesRoute(request('GET', `/api/collections/${id}/frames`), ctx({ id }));
    expect(framesRes.status).toBe(200);
    expect(await framesRes.json()).toEqual({ frames: [], detections: [] });

    const exp = await exportRoute(request('GET', `/api/collections/${id}/export?format=xlsx&lang=hu`), ctx({ id }));
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-disposition')).toBe(
      `attachment; filename="exlibris-${id}.xlsx"; filename*=UTF-8''exlibris-${id}.xlsx`,
    );
    expect(await exp.text()).toBe('books=1;locale=hu;email=');
    expect(vi.mocked(buildExport).mock.calls.at(-1)?.[1]).toBe('xlsx');
    const ownerExp = await exportRoute(request('GET', `/api/collections/${id}/export?format=goodreads&lang=en`, { cookies: ownerCookie }), ctx({ id }));
    expect(await ownerExp.text()).toBe('books=1;locale=en;email=owner@example.com');
    const badFormat = await exportRoute(request('GET', `/api/collections/${id}/export?format=docx`), ctx({ id }));
    expect(badFormat.status).toBe(400);

    const spineRel = `spines/${id}/${bookId}.jpg`;
    await fs.mkdir(path.dirname(abs(spineRel)), { recursive: true });
    await fs.writeFile(abs(spineRel), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    const media = await mediaRoute(request('GET', `/api/media/${spineRel}`), ctx({ path: spineRel.split('/') }));
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/jpeg');
    expect(media.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(Buffer.from(await media.arrayBuffer())).toHaveLength(8);

    const ranged = await mediaRoute(request('GET', `/api/media/${spineRel}`, { headers: { range: 'bytes=2-4' } }), ctx({ path: spineRel.split('/') }));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-4/8');
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([0xff, 0xe0, 1]);

    const etag = media.headers.get('etag')!;
    const notModified = await mediaRoute(request('GET', `/api/media/${spineRel}`, { headers: { 'if-none-match': etag } }), ctx({ path: spineRel.split('/') }));
    expect(notModified.status).toBe(304);

    const traversal: string[][] = [
      ['spines', id, '..', '..', '..', 'package.json'],
      ['spines', id, '..'],
      ['spines', '..', '..', 'package.json'],
      ['spines', id, '..\\..\\package.json'],
      ['spines', id, '../../package.json'],
      ['spines', id, 'C:', 'Windows'],
      ['spines', id, 'a\u0000.jpg'],
    ];
    for (const segments of traversal) {
      const r = await mediaRoute(request('GET', '/api/media/x'), ctx({ path: segments }));
      expect([400, 404], JSON.stringify(segments)).toContain(r.status);
    }
    expect((await mediaRoute(request('GET', '/api/media/x'), ctx({ path: ['exports', id, 'a.xlsx'] }))).status).toBe(404);
    expect((await mediaRoute(request('GET', '/api/media/x'), ctx({ path: ['spines', id, 'missing.jpg'] }))).status).toBe(404);
    expect((await mediaRoute(request('GET', '/api/media/x'), ctx({ path: ['spines', id] }))).status).toBe(400);
    // uploads/ is owner-only
    expect((await mediaRoute(request('GET', '/api/media/x'), ctx({ path: ['uploads', id, 'x.mp4'] }))).status).toBe(403);
  });

  it('PIN flow: needs_pin → wrong PIN → unlock → PIN change invalidates cookies', async () => {
    const anonPatch = await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { pin: '4321' } }), ctx({ id }));
    expect(anonPatch.status).toBe(403);

    const setPin = await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { pin: '4321' }, cookies: ownerCookie }), ctx({ id }));
    expect(setPin.status).toBe(200);
    expect(await setPin.json()).toMatchObject({ visibility: 'pin', isOwner: true, email: 'owner@example.com' });

    const locked = await getCollectionRoute(request('GET', `/api/collections/${id}`), ctx({ id }));
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: 'needs_pin', details: { id, title: 'Nappali polc' } });
    expect((await statusRoute(request('GET', `/api/collections/${id}/status`), ctx({ id }))).status).toBe(403);
    expect((await exportRoute(request('GET', `/api/collections/${id}/export?format=csv`), ctx({ id }))).status).toBe(403);
    const spineSegments = ['spines', id, `${bookId}.jpg`];
    expect((await mediaRoute(request('GET', '/api/media/x'), ctx({ path: spineSegments }))).status).toBe(403);
    expect((await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: ownerCookie }), ctx({ id }))).status).toBe(200);
    expect(await getOgSummary(id)).toBeNull();

    state.pageCookies.clear();
    expect(await loadCollectionPage(id)).toEqual({ kind: 'needs_pin', id, title: 'Nappali polc' });

    const wrong = await unlockRoute(request('POST', `/api/collections/${id}/unlock`, { body: { pin: '1234' }, headers: { 'accept-language': 'hu-HU,hu;q=0.9' } }), ctx({ id }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: 'Hibás PIN-kód. Próbáld újra.', code: 'forbidden', details: { reason: 'wrong_pin' } });

    const ok = await unlockRoute(request('POST', `/api/collections/${id}/unlock`, { body: { pin: '4321' } }), ctx({ id }));
    expect(ok.status).toBe(200);
    const pinCookie = setCookies(ok).get(`exl_pin_${id}`)!;
    expect(pinCookie.header).toContain('HttpOnly');
    const jar = { [`exl_pin_${id}`]: pinCookie.value, [`exl_seen_${id}`]: '1' };

    const unlocked = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: jar }), ctx({ id }));
    expect(unlocked.status).toBe(200);
    expect(((await unlocked.json()) as CollectionDTO).isOwner).toBe(false);
    expect((await mediaRoute(request('GET', '/api/media/x', { cookies: jar }), ctx({ path: spineSegments }))).status).toBe(200);

    state.pageCookies.set(`exl_pin_${id}`, pinCookie.value);
    const page = await loadCollectionPage(id);
    expect(page.kind).toBe('ok');
    expect(page.kind === 'ok' && page.data.isOwner).toBe(false);
    state.pageCookies.set(`exl_own_${id}`, ownerCookie[`exl_own_${id}`]);
    const ownerPage = await loadCollectionPage(id);
    expect(ownerPage.kind === 'ok' && ownerPage.data.isOwner).toBe(true);
    state.pageCookies.clear();
    expect(await loadCollectionPage('999999999')).toEqual({ kind: 'not_found' });

    await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { pin: '5555' }, cookies: ownerCookie }), ctx({ id }));
    const stale = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: jar }), ctx({ id }));
    expect(stale.status).toBe(403);

    const back = await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { visibility: 'link' }, cookies: ownerCookie }), ctx({ id }));
    expect(await back.json()).toMatchObject({ visibility: 'link' });
    expect(await getOgSummary(id)).toMatchObject({ title: 'Nappali polc', bookCount: 1, authorCount: 1 });
  });

  it('unlock is rate-limited per IP + collection', async () => {
    await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { pin: '2468' }, cookies: ownerCookie }), ctx({ id }));
    const ip = { 'x-forwarded-for': `${IP}, 10.0.0.1` };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await unlockRoute(request('POST', `/api/collections/${id}/unlock`, { body: { pin: '0000' }, headers: ip }), ctx({ id }));
      statuses.push(r.status);
      if (r.status === 429) expect(r.headers.get('retry-after')).toMatch(/^\d+$/);
    }
    // earlier tests already used 2 attempts from this IP
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(10);
    expect(statuses.at(-1)).toBe(429);
    await patchCollectionRoute(request('PATCH', `/api/collections/${id}`, { body: { pin: null }, cookies: ownerCookie }), ctx({ id }));
  });

  it('e-mail export, recover, admin overview', async () => {
    const anon = await emailRoute(request('POST', `/api/collections/${id}/email`, { body: {} }), ctx({ id }));
    expect(anon.status).toBe(403);
    const bad = await emailRoute(request('POST', `/api/collections/${id}/email`, { body: { email: 'x@' }, cookies: ownerCookie }), ctx({ id }));
    expect(bad.status).toBe(400);
    const badFormats = await emailRoute(request('POST', `/api/collections/${id}/email`, { body: { formats: ['docx'] }, cookies: ownerCookie }), ctx({ id }));
    expect(badFormats.status).toBe(400);
    const queued = await emailRoute(
      request('POST', `/api/collections/${id}/email`, { body: { email: FRIEND.toUpperCase(), formats: ['csv', 'csv', 'json'] }, cookies: ownerCookie }),
      ctx({ id }),
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ queued: true });
    const emailJobs = await db().execute(sql`SELECT payload FROM jobs WHERE type = 'send_email' AND payload->>'collectionId' = ${id}`);
    expect(emailJobs.rows[0]).toMatchObject({ payload: { kind: 'export', to: FRIEND, formats: ['csv', 'json'], locale: 'en' } });
    const [col] = await db().select({ email: collections.email }).from(collections).where(eq(collections.id, id));
    expect(col.email).toBe(FRIEND);

    const ourJobs = () => `{${state.jobIds.join(',')}}`;
    const recoverJobsFor = async (to: string) =>
      (
        await db().execute(
          sql`SELECT payload FROM jobs WHERE type = 'send_email' AND payload->>'kind' = 'recover_links' AND payload->>'to' = ${to} AND id = ANY(${ourJobs()}::bigint[])`,
        )
      ).rows as { payload: Record<string, unknown> }[];

    const invalid = await recoverRoute(request('POST', '/api/recover', { body: { email: 'nope' } }), undefined);
    expect(invalid.status).toBe(400);
    const unknown = await recoverRoute(request('POST', '/api/recover', { body: { email: NOBODY } }), undefined);
    expect(unknown.status).toBe(202);
    expect(await recoverJobsFor(NOBODY)).toHaveLength(0);
    const known = await recoverRoute(request('POST', '/api/recover', { body: { email: FRIEND.toUpperCase() }, headers: { 'accept-language': 'hu' } }), undefined);
    expect(known.status).toBe(202);
    expect(await known.json()).toEqual({ ok: true });
    const recoverJobs = await recoverJobsFor(FRIEND);
    expect(recoverJobs).toHaveLength(1);
    expect(recoverJobs[0].payload).toMatchObject({ to: FRIEND, locale: 'hu', _dedupe: `recover:${sha256Hex(FRIEND)}` });

    // per address: 3 / hour, over the limit the request is still 202 but nothing is queued (no enumeration)
    const otherIp = { 'x-forwarded-for': OTHER_IP };
    for (let i = 0; i < 3; i++) {
      const r = await recoverRoute(request('POST', '/api/recover', { body: { email: FRIEND }, headers: otherIp }), undefined);
      expect(r.status).toBe(202);
    }
    expect(await recoverJobsFor(FRIEND)).toHaveLength(3);

    // per IP: 3 / hour (malformed addresses are rejected before counting) → the 4th valid request is 429
    const third = await recoverRoute(request('POST', '/api/recover', { body: { email: NOBODY } }), undefined);
    expect(third.status).toBe(202);
    const limited = await recoverRoute(request('POST', '/api/recover', { body: { email: NOBODY } }), undefined);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited', details: { retryAfterSec: expect.any(Number) } });

    const noAuth = await adminOverview(request('GET', '/api/admin/overview'), undefined);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toContain('Basic');
    const wrongAuth = await adminOverview(
      request('GET', '/api/admin/overview', { headers: { authorization: `Basic ${Buffer.from('admin:wrong').toString('base64')}` } }),
      undefined,
    );
    expect(wrongAuth.status).toBe(401);
    const admin = await adminOverview(
      request('GET', '/api/admin/overview', { headers: { authorization: `Basic ${Buffer.from('admin:admin-test-password').toString('base64')}` } }),
      undefined,
    );
    expect(admin.status).toBe(200);
    const overview = await admin.json();
    expect(overview.counts.collections).toBeGreaterThanOrEqual(1);
    expect(overview.recentCollections.some((c: { id: string; hasEmail: boolean }) => c.id === id && c.hasEmail)).toBe(true);
    expect(overview.aiUsage).toMatchObject({ inputTokens: expect.any(Number), byModel: expect.any(Array) });
  });

  it('POST /api/uploads/:id/reanalyze queues a finished source again from its stored frames', async () => {
    const videoId = crypto.randomUUID();
    await db().insert(videos).values({
      id: videoId,
      collectionId: id,
      originalFilename: 'polc.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
      bytesReceived: 1000,
      uploadStatus: 'uploaded',
      storagePath: null,
      status: 'done',
      stage: 'done',
      progress: 100,
    });
    try {
      const noFrames = await reanalyzeRoute(request('POST', `/api/uploads/${videoId}/reanalyze`, { cookies: ownerCookie }), ctx({ videoId }));
      expect(noFrames.status).toBe(409);
      expect(await noFrames.json()).toMatchObject({ details: { reason: 'no_frames' } });

      await db().insert(frames).values({ videoId, collectionId: id, idx: 0, timeSec: 0, storagePath: `frames/${id}/${videoId}/0000.jpg`, width: 1080, height: 1920, analyzed: true });
      const anon = await reanalyzeRoute(request('POST', `/api/uploads/${videoId}/reanalyze`), ctx({ videoId }));
      expect(anon.status).toBe(403);

      const res = await reanalyzeRoute(request('POST', `/api/uploads/${videoId}/reanalyze`, { cookies: ownerCookie }), ctx({ videoId }));
      expect(res.status).toBe(202);
      expect(((await res.json()) as { video: VideoDTO }).video).toMatchObject({ id: videoId, status: 'queued', progress: 0 });
      const [col] = await db().select({ status: collections.status }).from(collections).where(eq(collections.id, id));
      expect(col.status).toBe('processing');
      const queued = await db().execute(sql`SELECT payload FROM jobs WHERE type = 'process_video' AND payload->>'videoId' = ${videoId}`);
      expect(queued.rows).toEqual([{ payload: { videoId, fromFrames: true, _dedupe: videoId } }]);

      const again = await reanalyzeRoute(request('POST', `/api/uploads/${videoId}/reanalyze`, { cookies: ownerCookie }), ctx({ videoId }));
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ details: { reason: 'processing' } });
    } finally {
      await db().delete(videos).where(eq(videos.id, videoId));
      await db().update(collections).set({ status: 'ready' }).where(eq(collections.id, id));
    }
  });

  it('unread spines: only the owner sees them, names them (a new book) or discards them', async () => {
    const videoId = crypto.randomUUID();
    await db().insert(videos).values({
      id: videoId,
      collectionId: id,
      originalFilename: 'sotet-polc.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
      bytesReceived: 1000,
      uploadStatus: 'uploaded',
      status: 'done',
      stage: 'done',
      progress: 100,
    });
    let bookId: string | null = null;
    try {
      const [named, discarded] = await db()
        .insert(unreadSpines)
        .values([
          { collectionId: id, videoId, reason: 'illegible', guessAuthor: 'Szerb Antal', shelfOrder: 0, bbox: { x0: 1, y0: 2, x1: 30, y1: 400 } },
          { collectionId: id, videoId, reason: 'unconfirmed', guessTitle: 'Tipp', shelfOrder: 1 },
        ])
        .returning();

      const visitor = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: { [`exl_seen_${id}`]: '1' } }), ctx({ id }));
      expect(((await visitor.json()) as CollectionWithBooksDTO).unreadSpines).toBeUndefined();
      const owner = await getCollectionRoute(request('GET', `/api/collections/${id}`, { cookies: ownerCookie }), ctx({ id }));
      expect(((await owner.json()) as CollectionWithBooksDTO).unreadSpines).toEqual([
        {
          id: named.id,
          videoId,
          frameId: null,
          bbox: { x0: 1, y0: 2, x1: 30, y1: 400 },
          spineImage: null,
          spineColor: null,
          reason: 'illegible',
          guessAuthor: 'Szerb Antal',
          guessTitle: null,
        },
        expect.objectContaining({ id: discarded.id, reason: 'unconfirmed', guessTitle: 'Tipp' }),
      ]);

      const url = (spineId: string) => `/api/collections/${id}/unread-spines/${spineId}`;
      const anonName = await nameSpineRoute(request('POST', url(named.id), { body: { title: 'Utas és holdvilág' } }), ctx({ id, spineId: named.id }));
      expect(anonName.status).toBe(403);
      const empty = await nameSpineRoute(request('POST', url(named.id), { body: { title: ' ' }, cookies: ownerCookie }), ctx({ id, spineId: named.id }));
      expect(empty.status).toBe(400);
      const res = await nameSpineRoute(
        request('POST', url(named.id), { body: { title: 'Utas és holdvilág', author: 'Szerb Antal' }, cookies: ownerCookie }),
        ctx({ id, spineId: named.id }),
      );
      expect(res.status).toBe(201);
      const book = (await res.json()) as BookDTO;
      bookId = book.id;
      expect(book).toMatchObject({ title: 'Utas és holdvilág', author: 'Szerb Antal', reviewed: true, needsReview: false, source: 'video', firstVideoId: videoId });

      const anonDismiss = await dismissSpineRoute(request('DELETE', url(discarded.id)), ctx({ id, spineId: discarded.id }));
      expect(anonDismiss.status).toBe(403);
      const dismissed = await dismissSpineRoute(request('DELETE', url(discarded.id), { cookies: ownerCookie }), ctx({ id, spineId: discarded.id }));
      expect(dismissed.status).toBe(204);
      const again = await dismissSpineRoute(request('DELETE', url(discarded.id), { cookies: ownerCookie }), ctx({ id, spineId: discarded.id }));
      expect(again.status).toBe(404);
      expect(await db().select().from(unreadSpines).where(eq(unreadSpines.videoId, videoId))).toHaveLength(0);
    } finally {
      if (bookId) await db().delete(books).where(eq(books.id, bookId));
      await db().delete(videos).where(eq(videos.id, videoId));
    }
  });

  it('POST /api/client-log logs an upload failure without file names and rejects anything else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const report = {
        kind: 'upload_failed',
        code: 'file_unreadable',
        detail: 'NotReadableError: The requested file could not be read',
        mimeType: 'video/mp4',
        extension: 'mp4',
        sizeBytes: 15219908,
        bytesSent: 0,
        lastModifiedKnown: true,
      };
      const ok = await clientLogRoute(request('POST', '/api/client-log', { body: report, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } }), undefined);
      expect(ok.status).toBe(204);
      expect(warn).toHaveBeenCalledWith('[client] upload failed', expect.objectContaining({ code: 'file_unreadable', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }));
      const bad = await clientLogRoute(request('POST', '/api/client-log', { body: { ...report, filename: 'x.mp4', kind: 'other' } }), undefined);
      expect(bad.status).toBe(400);
    } finally {
      warn.mockRestore();
    }
  });

  it('cross-site unsafe requests are refused', async () => {
    const res = await patchCollectionRoute(
      request('PATCH', `/api/collections/${id}`, { body: { title: 'pwned' }, cookies: ownerCookie, headers: { 'sec-fetch-site': 'cross-site' } }),
      ctx({ id }),
    );
    expect(res.status).toBe(403);
    const [col] = await db().select({ title: collections.title }).from(collections).where(eq(collections.id, id));
    expect(col.title).toBe('Nappali polc');
  });

  it('DELETE /api/collections/:id removes rows and files', async () => {
    const anon = await deleteCollectionRoute(request('DELETE', `/api/collections/${id}`), ctx({ id }));
    expect(anon.status).toBe(403);
    const res = await deleteCollectionRoute(request('DELETE', `/api/collections/${id}`, { cookies: ownerCookie }), ctx({ id }));
    expect(res.status).toBe(204);
    expect(await db().select().from(collections).where(eq(collections.id, id))).toHaveLength(0);
    expect(await db().select().from(books).where(eq(books.collectionId, id))).toHaveLength(0);
    expect(existsSync(abs(`spines/${id}`))).toBe(false);
    expect(existsSync(abs(`uploads/${id}`))).toBe(false);
    const gone = await getCollectionRoute(request('GET', `/api/collections/${id}`), ctx({ id }));
    expect(gone.status).toBe(404);
  });
});

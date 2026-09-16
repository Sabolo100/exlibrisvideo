import { describe, expect, it, vi } from 'vitest';

// GET /api/config must answer what the environment says, not the defaults
vi.hoisted(() => {
  Object.assign(process.env, { MAX_UPLOAD_MB: '2048', MAX_SOURCES_PER_COLLECTION: '12', MAX_VIDEO_SECONDS: '90' });
});

import { GET } from '@/app/api/config/route';
import { getTranslator } from '@/i18n';
import {
  createUploadLimitsSource,
  DEFAULT_UPLOAD_LIMITS,
  formatUploadLimit,
  formatVideoLimit,
  maxUploadBytes,
  parseUploadLimits,
  uploadLimitVars,
} from './limits';
import { serverUploadLimits } from './server-limits';

const hu = getTranslator('hu');
const en = getTranslator('en');

describe('upload limits', () => {
  it('mirrors the env defaults and converts MiB to bytes like the API', () => {
    expect(DEFAULT_UPLOAD_LIMITS).toEqual({ maxUploadMb: 1024, maxSourcesPerCollection: 30, maxVideoSeconds: 600 });
    expect(maxUploadBytes(DEFAULT_UPLOAD_LIMITS)).toBe(1024 ** 3);
  });

  it('accepts only positive integers from the network', () => {
    expect(parseUploadLimits({ maxUploadMb: 500, maxSourcesPerCollection: 10, maxVideoSeconds: 300, extra: 'x' })).toEqual({
      maxUploadMb: 500,
      maxSourcesPerCollection: 10,
      maxVideoSeconds: 300,
    });
    for (const bad of [null, 'x', [], {}, { maxUploadMb: 500, maxSourcesPerCollection: 10 }, { maxUploadMb: 0, maxSourcesPerCollection: 10, maxVideoSeconds: 300 }, { maxUploadMb: 1.5, maxSourcesPerCollection: 10, maxVideoSeconds: 300 }, { maxUploadMb: '500', maxSourcesPerCollection: 10, maxVideoSeconds: 300 }]) {
      expect(parseUploadLimits(bad)).toBeNull();
    }
  });

  it('formats the size limit nicely in both languages', () => {
    expect(formatUploadLimit({ maxUploadMb: 1024 }, 'hu')).toBe('1 GB');
    expect(formatUploadLimit({ maxUploadMb: 1024 }, 'en')).toBe('1 GB');
    expect(formatUploadLimit({ maxUploadMb: 2048 }, 'en')).toBe('2 GB');
    expect(formatUploadLimit({ maxUploadMb: 1536 }, 'hu')).toBe('1,5 GB');
    expect(formatUploadLimit({ maxUploadMb: 500 }, 'hu')).toBe('500 MB');
  });

  it('formats the video length limit in minutes or seconds', () => {
    expect(formatVideoLimit({ maxVideoSeconds: 600 }, hu.tp)).toBe('10 perc');
    expect(formatVideoLimit({ maxVideoSeconds: 600 }, en.tp)).toBe('10 minutes');
    expect(formatVideoLimit({ maxVideoSeconds: 60 }, en.tp)).toBe('1 minute');
    expect(formatVideoLimit({ maxVideoSeconds: 90 }, hu.tp)).toBe('90 másodperc');
    expect(formatVideoLimit({ maxVideoSeconds: 90 }, en.tp)).toBe('90 seconds');
  });

  it('builds the placeholder values of texts quoting the limits', () => {
    expect(uploadLimitVars(DEFAULT_UPLOAD_LIMITS, hu)).toEqual({ maxSize: '1 GB', maxFiles: '30', maxDuration: '10 perc' });
    expect(uploadLimitVars({ maxUploadMb: 2048, maxSourcesPerCollection: 12, maxVideoSeconds: 90 }, en)).toEqual({
      maxSize: '2 GB',
      maxFiles: '12',
      maxDuration: '90 seconds',
    });
    expect(hu.t('upload.error.too_large', { max: '2 GB' })).toBe('A fájl túl nagy: fájlonként legfeljebb 2 GB tölthető fel.');
    expect(en.t('processing.error.too_long.hint', { maxDuration: '5 minutes' })).toContain('recordings of up to 5 minutes.');
  });
});

describe('GET /api/config', () => {
  it('exposes exactly the three limits from the environment, cacheable for 5 minutes', async () => {
    expect(serverUploadLimits()).toEqual({ maxUploadMb: 2048, maxSourcesPerCollection: 12, maxVideoSeconds: 90 });
    const res = await GET(new Request('http://localhost:3000/api/config'), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const body = await res.json();
    expect(body).toEqual({ maxUploadMb: 2048, maxSourcesPerCollection: 12, maxVideoSeconds: 90 });
    expect(parseUploadLimits(body)).toEqual(body);
  });
});

describe('createUploadLimitsSource', () => {
  const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  const LIMITS = { maxUploadMb: 300, maxSourcesPerCollection: 5, maxVideoSeconds: 120 };

  it('loads once, shares a request in flight and notifies subscribers', async () => {
    const request = vi.fn(() => ok(LIMITS));
    const source = createUploadLimitsSource(request);
    const listener = vi.fn();
    source.subscribe(listener);
    expect(source.get()).toBeNull();
    const [a, b] = await Promise.all([source.load(), source.load()]);
    expect(a).toEqual(LIMITS);
    expect(b).toEqual(LIMITS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.get()).toEqual(LIMITS);
    await source.load();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps the limits unknown after a failure and retries on the next load', async () => {
    const request = vi
      .fn<() => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'x' }) }))
      .mockImplementationOnce(() => ok({ maxUploadMb: 'lots' }))
      .mockImplementationOnce(() => {
        throw new Error('synchronous failure');
      })
      .mockImplementation(() => ok(LIMITS));
    const source = createUploadLimitsSource(request);
    for (let i = 0; i < 4; i++) {
      expect(await source.load()).toBeNull();
      expect(source.get()).toBeNull();
    }
    expect(await source.load()).toEqual(LIMITS);
    expect(request).toHaveBeenCalledTimes(5);
  });
});

import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { GET } from './route';

describe('PWA', () => {
  it('the service worker caches the offline page and serves it when a page cannot be loaded', async () => {
    const js = await GET().text();
    expect(js).toContain("const OFFLINE = '/offline'");
    expect(js).toContain("req.mode === 'navigate'");
    expect(js).toContain('c.match(OFFLINE)');
    // versioned cache: a new release drops the old one
    expect(js).toMatch(/const CACHE = "exlibris-v\d+\.\d+\.\d+-/);
  });

  it('the manifest has what Chrome needs to offer the install', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    expect(m.prefer_related_applications).toBe(false);
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect((m.icons ?? []).some((i) => i.purpose === 'maskable')).toBe(true);
  });
});

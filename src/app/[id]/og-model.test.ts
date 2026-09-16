import { describe, expect, it } from 'vitest';
import { SPINE_PALETTE } from '@/lib/book-utils';
import { OG_SHELF_INNER_WIDTH, OG_SPINE_GAP, loadOgFonts, ogSpines, ogTitleSize, truncate } from './og-model';

const rowWidth = (spines: { width: number }[]) => spines.reduce((sum, s) => sum + s.width, 0) + OG_SPINE_GAP * (spines.length - 1);

describe('ogSpines', () => {
  it('uses the collection colours first, then the palette, 24–40 spines', () => {
    const colors = ['#7a2e3a', 'not-a-colour', '#1f4d3a'];
    const spines = ogSpines('334345435', colors, 312);
    expect(spines).toHaveLength(40);
    expect(spines[0].color).toBe('#7a2e3a');
    expect(spines[1].color).toBe('#1f4d3a');
    for (const spine of spines.slice(2)) expect(SPINE_PALETTE).toContain(spine.color);
    expect(ogSpines('x', [], 3)).toHaveLength(24);
    expect(ogSpines('x', [], 0)).toHaveLength(24);
    expect(ogSpines('x', [], 31)).toHaveLength(31);
  });

  it('fills but never overflows the shelf', () => {
    for (const count of [0, 1, 24, 30, 40, 500]) {
      const width = rowWidth(ogSpines(`seed-${count}`, [], count));
      expect(width, String(count)).toBeLessThanOrEqual(OG_SHELF_INNER_WIDTH);
      expect(width, String(count)).toBeGreaterThan(OG_SHELF_INNER_WIDTH * 0.85);
    }
  });

  it('is deterministic per seed and varies between spines', () => {
    expect(ogSpines('123456789', [], 40)).toEqual(ogSpines('123456789', [], 40));
    const spines = ogSpines('123456789', [], 40);
    expect(new Set(spines.map((s) => s.height)).size).toBeGreaterThan(10);
    const labels = spines.map((s) => s.label);
    // labels are spread over the whole row, not clustered at the start
    expect(labels.slice(20).some(Boolean)).toBe(true);
  });
});

describe('title helpers', () => {
  it('sizes and truncates titles', () => {
    expect(ogTitleSize('Ősi Könyvtár')).toBe(76);
    expect(ogTitleSize('x'.repeat(40))).toBe(56);
    expect(ogTitleSize('x'.repeat(100))).toBe(42);
    expect(truncate('  A   nappali polc ', 80)).toBe('A nappali polc');
    expect(truncate('abcdefghij', 6)).toBe('abcde…');
  });
});

describe('loadOgFonts', () => {
  it('finds the latin and latin-ext Noto woff files (satori cannot read woff2)', async () => {
    const fonts = await loadOgFonts();
    expect(fonts.map((f) => `${f.name}/${f.weight}/${f.style}`)).toEqual([
      'ExlSerif/700/normal',
      'ExlSerifExt/700/normal',
      'ExlSerif/400/italic',
      'ExlSerifExt/400/italic',
      'ExlSans/600/normal',
      'ExlSansExt/600/normal',
    ]);
    // woff signature "wOFF"
    for (const font of fonts) expect(font.data.subarray(0, 4).toString('latin1')).toBe('wOFF');
    expect(await loadOgFonts()).toBe(fonts);
  });
});

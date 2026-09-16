import { describe, expect, it } from 'vitest';
import { SAMPLE_BOOKS } from './sample-books';
import { coverTitleSize } from './cover-layout';
import { SPINE_SIZES, shelfRowHeight, spineAppearance, spineBox, spineTextLayout, splitTitle } from './spine-layout';

describe('spine layout', () => {
  it('boxes stay within the size envelope', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      for (const b of SAMPLE_BOOKS) {
        const box = spineBox(b, size);
        expect(box.height).toBeLessThanOrEqual(SPINE_SIZES[size].height);
        expect(box.height).toBeGreaterThanOrEqual(Math.round(SPINE_SIZES[size].height * 0.78));
        expect(box.width).toBeGreaterThanOrEqual(Math.round(SPINE_SIZES[size].width * 0.7));
      }
      expect(shelfRowHeight(size)).toBeGreaterThan(SPINE_SIZES[size].height);
    }
  });

  it('hides text on xs and very thin spines, drops the author on sm', () => {
    expect(spineTextLayout({ width: 13, height: 64, title: 'Vuk', author: 'Fekete István', size: 'xs', variant: 'cloth' }).mode).toBe('none');
    expect(spineTextLayout({ width: 20, height: 110, title: 'Vuk', author: 'Fekete István', size: 'sm', variant: 'cloth' }).mode).toBe('title');
    expect(spineTextLayout({ width: 30, height: 180, title: 'Vuk', author: 'Fekete István', size: 'md', variant: 'cloth' }).mode).toBe('single');
    expect(spineTextLayout({ width: 52, height: 250, title: 'Vuk', author: 'Fekete István', size: 'lg', variant: 'cloth' }).mode).toBe('double');
  });

  it('shrinks long titles but never below the minimum', () => {
    const short = spineTextLayout({ width: 30, height: 180, title: 'Vuk', author: null, size: 'md', variant: 'paperback' });
    const long = spineTextLayout({
      width: 30,
      height: 180,
      title: 'A százéves ember, aki kimászott az ablakon és eltűnt',
      author: 'Jonas Jonasson',
      size: 'md',
      variant: 'paperback',
    });
    expect(long.titleSize).toBeLessThan(short.titleSize);
    expect(long.titleSize).toBeGreaterThanOrEqual(7.5);
  });

  it('breaks long titles into two lines on thick enough spines', () => {
    const l = spineTextLayout({ width: 37, height: 140, title: 'Gyors és lassú gondolkodás', author: 'Daniel Kahneman', size: 'md', variant: 'cloth' });
    expect(l.mode).toBe('title2');
    expect(l.titleLines).toEqual(['Gyors és lassú', 'gondolkodás']);
    // two lines must fit the thickness
    expect(l.titleSize * 2 * 1.05).toBeLessThanOrEqual(37 * 0.84);
    expect(splitTitle('Vuk')).toBeNull();
  });

  it('never lets the author squeeze the title: drops it when the family name does not fit', () => {
    const l = spineTextLayout({
      width: 33,
      height: 162,
      title: 'Sátántangó',
      author: 'Krasznahorkai László',
      authorShort: 'Krasznahorkai',
      size: 'md',
      variant: 'paperback',
    });
    expect(l.mode).toBe('title');
    expect(l.authorText).toBeNull();
    const avail = 162 - l.head - l.tail;
    expect('Sátántangó'.length * 0.56 * l.titleSize).toBeLessThanOrEqual(avail);
    // a short title leaves room for a smaller family name
    const vuk = spineTextLayout({ width: 26, height: 170, title: 'Vuk', author: 'Fekete István', authorShort: 'Fekete', size: 'md', variant: 'paperback' });
    expect(vuk.mode).toBe('single');
    expect(vuk.authorSize).toBeGreaterThanOrEqual(7.5);
    expect(vuk.authorSize).toBeLessThanOrEqual(vuk.titleSize);
  });

  it('sizes cover titles so the longest word fits its composition', () => {
    expect(coverTitleSize('Vuk', 'classic')).toBe(14);
    const label = coverTitleSize('Sorstalanság', 'label');
    expect(label * 'Sorstalanság'.length * 0.6).toBeLessThanOrEqual(63.5);
    expect(label).toBeLessThan(coverTitleSize('Sorstalanság', 'band'));
    expect(coverTitleSize('A százéves ember, aki kimászott az ablakon és eltűnt', 'classic')).toBe(6.8);
    expect(coverTitleSize('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'label')).toBe(5.5);
  });

  it('appearance is deterministic and uses foil only on dark cloth/leather', () => {
    for (const b of SAMPLE_BOOKS) {
      const a = spineAppearance(b);
      expect(spineAppearance({ ...b })).toEqual(a);
      if (a.foil) {
        expect(a.dark).toBe(true);
        expect(['cloth', 'leather']).toContain(a.variant);
      }
    }
    const variants = new Set(SAMPLE_BOOKS.map((b) => spineAppearance(b).variant));
    expect(variants.size).toBeGreaterThanOrEqual(3);
  });
});

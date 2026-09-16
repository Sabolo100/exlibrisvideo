import { describe, expect, it } from 'vitest';
import { barPath, circumference, clampTooltipX, countAxis, labelStride, ringSegments, showsLabel } from './chart-geometry';

describe('ringSegments', () => {
  it('splits the circumference proportionally with gaps between neighbours', () => {
    const c = 100;
    const segs = ringSegments([1, 0, 3], c, 2);
    expect(segs.map((s) => s.index)).toEqual([0, 2]);
    expect(segs[0]).toMatchObject({ length: 23, offset: 1, fraction: 0.25 });
    expect(segs[1]).toMatchObject({ length: 73, offset: 26, fraction: 0.75 });
    // every segment stays inside its share of the ring
    const end = segs[1].offset + segs[1].length;
    expect(end).toBeLessThanOrEqual(c);
  });

  it('draws a single value as a closed ring and keeps tiny slices visible', () => {
    expect(ringSegments([5], 50)).toEqual([{ index: 0, length: 50, offset: 0, fraction: 1 }]);
    const tiny = ringSegments([1, 999], 100, 2)[0];
    expect(tiny.length).toBeGreaterThan(0);
    expect(ringSegments([0, 0], 100)).toEqual([]);
    expect(ringSegments([1], 0)).toEqual([]);
  });

  it('computes the circumference', () => {
    expect(circumference(10)).toBeCloseTo(62.83, 2);
  });
});

describe('countAxis', () => {
  it('picks nice integer steps', () => {
    expect(countAxis(7, 4)).toEqual({ top: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
    expect(countAxis(3, 4)).toEqual({ top: 3, step: 1, ticks: [0, 1, 2, 3] });
    expect(countAxis(42, 4)).toMatchObject({ top: 60, step: 20, ticks: [0, 20, 40, 60] });
    expect(countAxis(120, 5)).toMatchObject({ top: 150, step: 50 });
    expect(countAxis(230, 4)).toMatchObject({ top: 300, step: 100 });
    expect(countAxis(19, 4)).toMatchObject({ top: 20, step: 5 });
    expect(countAxis(1, 4)).toEqual({ top: 1, step: 1, ticks: [0, 1] });
    expect(countAxis(0)).toEqual({ top: 1, step: 1, ticks: [0, 1] });
    expect(countAxis(Number.NaN)).toEqual({ top: 1, step: 1, ticks: [0, 1] });
  });
});

describe('labels', () => {
  it('computes a stride that avoids collisions and always keeps the last label', () => {
    expect(labelStride(30, 40)).toBe(1);
    expect(labelStride(30, 20)).toBe(2);
    expect(labelStride(30, 0)).toBe(1);
    const shown = Array.from({ length: 7 }, (_, i) => showsLabel(i, 7, 3));
    expect(shown).toEqual([true, false, false, true, false, false, true]);
    expect(showsLabel(5, 5, 1)).toBe(false);
  });

  it('keeps tooltips inside the container', () => {
    expect(clampTooltipX(10, 100, 400)).toBe(50);
    expect(clampTooltipX(390, 100, 400)).toBe(350);
    expect(clampTooltipX(200, 100, 400)).toBe(200);
    expect(clampTooltipX(20, 300, 200)).toBe(100);
  });
});

describe('barPath', () => {
  it('rounds the data end of a column and keeps the baseline square', () => {
    expect(barPath({ x: 10, y: 20, width: 16, height: 50 }, 4, 'up')).toBe('M10,70V24A4,4 0 0 1 14,20H22A4,4 0 0 1 26,24V70Z');
  });

  it('rounds the right end of a horizontal bar', () => {
    expect(barPath({ x: 0, y: 2, width: 100, height: 12 }, 4, 'right')).toBe('M0,2H96A4,4 0 0 1 100,6V10A4,4 0 0 1 96,14H0Z');
  });

  it('shrinks the radius for small bars and skips empty ones', () => {
    // 3px tall column: radius limited to the height
    expect(barPath({ x: 0, y: 0, width: 16, height: 3 }, 4, 'up')).toBe('M0,3V3A3,3 0 0 1 3,0H13A3,3 0 0 1 16,3V3Z');
    // 2px long bar: radius limited to the length
    expect(barPath({ x: 0, y: 0, width: 2, height: 12 }, 4, 'right')).toContain('A2,2');
    expect(barPath({ x: 0, y: 0, width: 0, height: 10 }, 4, 'up')).toBe('');
    expect(barPath({ x: 0, y: 0, width: 10, height: Number.NaN }, 4, 'right')).toBe('');
    expect(barPath({ x: 0, y: 0, width: 10, height: 10 }, 0, 'up')).toBe('M0,10V0H10V10Z');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SpineObservation } from '@/lib/ai/types';

vi.mock('@/lib/ai', () => ({ getVisionProvider: vi.fn() }));
vi.mock('@/lib/ai/usage', () => ({ recordUsage: vi.fn() }));

const { planBatches, clampBbox, clampConfidence, observationsToDetections } = await import('./vision-step');

describe('planBatches', () => {
  it('overlaps consecutive batches by one frame', () => {
    expect(planBatches(10, 4)).toEqual([
      [0, 1, 2, 3],
      [3, 4, 5, 6],
      [6, 7, 8, 9],
    ]);
    expect(planBatches(11, 4)).toEqual([
      [0, 1, 2, 3],
      [3, 4, 5, 6],
      [6, 7, 8, 9],
      [9, 10],
    ]);
  });

  it('covers every frame and every adjacent pair exactly in order', () => {
    for (const n of [1, 2, 3, 4, 5, 7, 16, 21, 48]) {
      for (const size of [1, 2, 3, 4, 6]) {
        const plan = planBatches(n, size);
        const flat = new Set(plan.flat());
        expect(flat.size).toBe(n);
        plan.forEach((b) => expect(b.length).toBeLessThanOrEqual(size));
        if (size > 1) {
          for (let i = 1; i < plan.length; i++) expect(plan[i][0]).toBe(plan[i - 1][plan[i - 1].length - 1]);
        }
        // no trailing batch fully contained in the previous one
        if (plan.length > 1) expect(plan[plan.length - 1].at(-1)).toBe(n - 1);
      }
    }
  });

  it('handles edge cases', () => {
    expect(planBatches(0, 4)).toEqual([]);
    expect(planBatches(3, 4)).toEqual([[0, 1, 2]]);
    expect(planBatches(4, 4)).toEqual([[0, 1, 2, 3]]);
    expect(planBatches(3, 1)).toEqual([[0], [1], [2]]); // size 1 cannot overlap
  });
});

describe('clampBbox', () => {
  it('normalises, clamps and rounds to integer pixels', () => {
    expect(clampBbox({ x0: 300.4, y0: 1900, x1: 120.6, y1: -30 }, 1080, 1920)).toEqual({ x0: 120, y0: 0, x1: 301, y1: 1900 });
    expect(clampBbox({ x0: -10, y0: 5, x1: 2000, y1: 2500 }, 1080, 1920)).toEqual({ x0: 0, y0: 5, x1: 1080, y1: 1920 });
  });

  it('scales normalised 0..1 boxes to pixels', () => {
    expect(clampBbox({ x0: 0.1, y0: 0.25, x1: 0.2, y1: 0.75 }, 1000, 2000)).toEqual({ x0: 100, y0: 500, x1: 200, y1: 1500 });
  });

  it('rejects empty, invalid and outside boxes', () => {
    expect(clampBbox(null, 100, 100)).toBeNull();
    expect(clampBbox({ x0: 10, y0: 10, x1: 10, y1: 50 }, 100, 100)).toBeNull();
    expect(clampBbox({ x0: 200, y0: 10, x1: 300, y1: 50 }, 100, 100)).toBeNull();
    expect(clampBbox({ x0: Number.NaN, y0: 0, x1: 5, y1: 5 }, 100, 100)).toBeNull();
    expect(clampBbox({ x0: 0, y0: 0, x1: 0, y1: 0 }, 100, 100)).toBeNull();
  });
});

describe('clampConfidence', () => {
  it('clamps to 0..1 (percent values scaled)', () => {
    expect(clampConfidence(0.7)).toBe(0.7);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(85)).toBe(0.85);
    expect(clampConfidence(1.2)).toBe(1);
    expect(clampConfidence(1000)).toBe(1);
    expect(clampConfidence(Number.NaN)).toBe(0);
    expect(clampConfidence('0.5')).toBe(0.5);
    expect(clampConfidence(undefined)).toBe(0);
  });
});

describe('observationsToDetections', () => {
  const frames = [
    { id: 'f1', width: 1080, height: 1920 },
    { id: 'f2', width: 1080, height: 1920 },
  ];
  const meta = { collectionId: '123456789', videoId: 'v1', provider: 'mock', model: 'fixture' };
  const obs = (o: Partial<SpineObservation>): SpineObservation => ({
    frame: 1,
    order: 1,
    author: null,
    title: 'Title',
    canonicalAuthor: null,
    canonicalTitle: null,
    publisher: null,
    confidence: 0.9,
    bbox: null,
    ...o,
  });

  it('maps frames by 1-based batch index and cleans fields', () => {
    const out = observationsToDetections(
      [
        obs({ frame: 2, order: 3, author: '  Esterházy   Péter ', title: ' Harmonia  caelestis ', publisher: 'Magvető', confidence: 1.4, bbox: { x0: 10, y0: 20, x1: 1200, y1: 30 }, canonicalAuthor: 'Esterházy Péter', canonicalTitle: 'Harmonia caelestis' }),
        obs({ frame: 1, author: 'null', title: 'A', bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } }),
      ],
      frames,
      meta,
    );
    expect(out).toHaveLength(2);
    expect(out[0].row).toMatchObject({
      frameId: 'f2',
      rawAuthor: 'Esterházy Péter',
      rawTitle: 'Harmonia caelestis',
      publisher: 'Magvető',
      confidence: 1, // slightly above 1 → clamped
      bbox: { x0: 10, y0: 20, x1: 1080, y1: 30 },
      orderInFrame: 3,
      provider: 'mock',
      model: 'fixture',
      collectionId: '123456789',
      videoId: 'v1',
    });
    expect(out[0].hint).toEqual({ canonicalAuthor: 'Esterházy Péter', canonicalTitle: 'Harmonia caelestis' });
    expect(out[1].row).toMatchObject({ frameId: 'f1', rawAuthor: null, bbox: null });
  });

  it('drops empty titles and out-of-range frames, derives missing order', () => {
    const out = observationsToDetections(
      [
        obs({ title: '   ' }),
        obs({ frame: 3 }),
        obs({ frame: 0 }),
        obs({ frame: 1, order: Number.NaN, title: 'first' }),
        obs({ frame: 1, order: 0, title: 'second' }),
      ],
      frames,
      meta,
    );
    expect(out.map((o) => [o.row.rawTitle, o.row.orderInFrame])).toEqual([
      ['first', 1],
      ['second', 2],
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Boundary } from './boundaries';
import { buildSpineCandidates, type FrameGeometry, type FrameMotion } from './tracking';

/** gaps between books on the shelf, in shelf coordinates */
const SHELF = [60, 140, 230, 300, 390, 470, 560, 640, 750, 830, 920, 1000, 1090, 1180, 1260, 1350];
const WIDTH = 1000;
const PAN = -120;

function frame(k: number, extra: Boundary[] = [], drop: number[] = []): FrameGeometry {
  const boundaries = SHELF.map((x) => x + PAN * k)
    .filter((x, i) => x > 0 && x < WIDTH && !drop.includes(i))
    .map((xc) => ({ xc, deg: 2, score: 2.4 }));
  return { width: WIDTH, height: 1600, bands: [{ y0: 600, y1: 1100, boundaries: [...boundaries, ...extra].sort((a, b) => a.xc - b.xc) }] };
}

const steady: FrameMotion = { s: 1, d: PAN, dy: 0, reliable: true };

describe('buildSpineCandidates', () => {
  it('turns a pan into one candidate per book, each seen in several frames', () => {
    const frames = [0, 1, 2, 3, 4].map((k) => frame(k));
    const candidates = buildSpineCandidates(frames, [null, steady, steady, steady, steady]);
    // every neighbouring pair of gaps that is fully inside some frame
    expect(candidates).toHaveLength(SHELF.length - 1);
    expect(new Set(candidates.map((c) => c.chain))).toEqual(new Set([0]));
    expect(candidates.map((c) => c.position)).toEqual(candidates.map((_, i) => i));
    const middle = candidates[5];
    expect(middle.views.length).toBeGreaterThanOrEqual(3);
    for (const v of middle.views) {
      expect(v.right.xc - v.left.xc).toBe(SHELF[6] - SHELF[5]);
      expect(v.band).toEqual({ y0: 600, y1: 1100 });
    }
  });

  it('ignores a line seen in only one of the frames that show its place (a printed stripe, glare)', () => {
    const glare: Boundary = { xc: 350 + PAN * 2, deg: 2, score: 1.1 };
    const frames = [0, 1, 2, 3, 4].map((k) => frame(k, k === 2 ? [glare] : []));
    const candidates = buildSpineCandidates(frames, [null, steady, steady, steady, steady]);
    expect(candidates).toHaveLength(SHELF.length - 1);
  });

  it('keeps a gap that is missed in a single frame', () => {
    const frames = [0, 1, 2, 3, 4].map((k) => frame(k, [], k === 2 ? [6] : []));
    const candidates = buildSpineCandidates(frames, [null, steady, steady, steady, steady]);
    expect(candidates).toHaveLength(SHELF.length - 1);
    // the two books next to the missed gap have no view in frame 2
    const [a, b] = [candidates[5], candidates[6]];
    expect(a.views.some((v) => v.frame === 2)).toBe(false);
    expect(b.views.some((v) => v.frame === 2)).toBe(false);
  });

  it('starts new chains after an unreliable motion step', () => {
    const frames = [0, 1, 2, 3].map((k) => frame(k));
    const unreliable: FrameMotion = { s: 1, d: 0, dy: 0, reliable: false };
    const candidates = buildSpineCandidates(frames, [null, steady, unreliable, steady]);
    expect(new Set(candidates.map((c) => c.chain)).size).toBe(2);
  });

  it('follows the camera moving closer (scale) and up (vertical shift)', () => {
    const zoom = 1.04;
    const frames: FrameGeometry[] = [0, 1, 2, 3].map((k) => {
      const scale = zoom ** k;
      const boundaries = SHELF.map((x) => (x + PAN * k) * scale).filter((x) => x > 0 && x < WIDTH).map((xc) => ({ xc, deg: 0, score: 2 }));
      return { width: WIDTH, height: 1600, bands: [{ y0: 600 + 30 * k, y1: 1100 + 30 * k, boundaries }] };
    });
    const motions: (FrameMotion | null)[] = [null, 1, 2, 3].map((k) =>
      k === null ? null : { s: zoom, d: zoom ** k * PAN, dy: 30, reliable: true },
    );
    const candidates = buildSpineCandidates(frames, motions);
    expect(new Set(candidates.map((c) => c.chain)).size).toBe(1);
    expect(candidates.length).toBeGreaterThanOrEqual(SHELF.length - 3);
    expect(candidates.every((c) => c.views.length >= 1)).toBe(true);
  });

  it('accepts every clear line of a single photo', () => {
    const candidates = buildSpineCandidates([frame(0)], [null]);
    expect(candidates.length).toBe(SHELF.filter((x) => x > 0 && x < WIDTH).length - 1);
  });
});

import { describe, expect, it } from 'vitest';
import { estimateShift, refineWithBoundaries, type Profile } from './motion';

/** A deterministic, non-periodic "shelf" signal: books of varying width and brightness. */
function shelfSignal(length: number, seed = 3): Float32Array {
  const out = new Float32Array(length);
  let s = seed;
  let x = 0;
  while (x < length) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const width = 6 + (s % 17);
    const level = 40 + ((s >> 8) % 180);
    for (let k = 0; k < width && x < length; k++, x++) out[x] = level;
    if (x < length) out[x++] = 10; // dark gap
  }
  return out;
}

function profile(values: Float32Array, step: number): Profile {
  const d = new Float32Array(values.length);
  for (let i = 1; i < values.length - 1; i++) d[i] = (values[i + 1] - values[i - 1]) / 2;
  return { length: values.length, step, features: [values, d] };
}

/** b[x] = a[x - shift] (content moved right by `shift` samples) */
function shifted(a: Float32Array, shift: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let x = 0; x < a.length; x++) out[x] = a[Math.min(a.length - 1, Math.max(0, x - shift))];
  return out;
}

describe('estimateShift', () => {
  const base = shelfSignal(400);
  const a = profile(base.subarray(60, 330), 4);

  it('finds a pan to the left and to the right, in full-resolution pixels', () => {
    const left = profile(base.subarray(100, 370), 4); // content moves 40 samples to the left
    const estLeft = estimateShift(a, left)!;
    expect(estLeft.shift).toBe(-160);
    expect(estLeft.score).toBeGreaterThan(0.95);
    const right = profile(base.subarray(25, 295), 4);
    expect(estimateShift(a, right)!.shift).toBe(140);
  });

  it('reports low confidence for unrelated pictures', () => {
    const other = profile(shelfSignal(270, 99), 4);
    const est = estimateShift(a, other)!;
    expect(est.score).toBeLessThan(0.75);
  });

  it('works on shifts as a share of the width', () => {
    const p = profile(shelfSignal(300, 11), 1 / 300);
    const q = profile(shifted(shelfSignal(300, 11), 45), 1 / 300);
    expect(estimateShift(p, q)!.shift).toBeCloseTo(0.15, 5);
  });
});

describe('refineWithBoundaries', () => {
  it('fits scale and shift through matching gaps and ignores an outlier', () => {
    const prev = [100, 180, 260, 400, 520, 700];
    const next = prev.map((x) => 1.03 * x - 60);
    next[3] += 17; // a gap detected slightly elsewhere
    const t = refineWithBoundaries(prev, next, -55);
    expect(t.s).toBeCloseTo(1.03, 2);
    expect(t.d).toBeCloseTo(-60, 0);
    expect(t.matches).toBeGreaterThanOrEqual(5);
  });

  it('keeps the plain shift when too few gaps match', () => {
    expect(refineWithBoundaries([100], [40], -60)).toEqual({ s: 1, d: -60, matches: 1 });
    const t = refineWithBoundaries([100, 300, 500], [42, 238, 700], -60);
    expect(t.s).toBe(1);
    expect(t.matches).toBe(2);
    expect(t.d).toBeCloseTo(-60, 0);
  });

  it('refuses implausible zoom between two key frames', () => {
    const prev = [100, 400, 700, 1000, 1300];
    const next = prev.map((x) => 1.12 * x - 30);
    const t = refineWithBoundaries(prev, next, 0, 130);
    expect(t.matches).toBe(5);
    expect(t.s).toBe(1);
  });
});

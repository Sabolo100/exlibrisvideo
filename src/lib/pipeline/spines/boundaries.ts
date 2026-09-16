/**
 * Spine boundaries inside a shelf band: long, straight, near-vertical edges. Every edge pixel votes for
 * the lines (tilt angle, x at the band's centre row) it is aligned with; a line covered along a large
 * part of the band height is a boundary between two books. Printed letters make short edges only.
 */
import type { Band } from './bands';
import type { Gradients, GrayImage } from './raster';

export interface Boundary {
  /** x of the line at the band's centre row (working resolution, may lie slightly outside the image) */
  xc: number;
  /** tilt in degrees: > 0 when x grows downwards ("\") */
  deg: number;
  /** aligned edge support relative to the band height (a clean book edge scores ≈ 1.5–3) */
  score: number;
}

export interface BoundaryOptions {
  edgeThreshold: number;
  /** largest tilt considered (degrees) */
  maxDeg?: number;
  stepDeg?: number;
  /** an edge pixel votes for lines within this angle of its own direction */
  toleranceDeg?: number;
  /** two boundaries are at least this share of the band height apart */
  minSeparationFraction?: number;
  minScore?: number;
}

export const DEFAULT_MIN_BOUNDARY_SCORE = 0.9;

export function detectBoundaries(img: GrayImage, grad: Gradients, band: Band, opts: BoundaryOptions): Boundary[] {
  const maxDeg = opts.maxDeg ?? 24;
  const stepDeg = opts.stepDeg ?? 1;
  const tolerance = ((opts.toleranceDeg ?? 9) * Math.PI) / 180;
  const minScore = opts.minScore ?? DEFAULT_MIN_BOUNDARY_SCORE;
  const { width: w } = img;
  const y0 = Math.max(1, band.y0);
  const y1 = Math.min(img.height - 1, band.y1);
  const bandHeight = y1 - y0;
  if (bandHeight < 4) return [];
  const yc = (band.y0 + band.y1) / 2;

  const angles: number[] = [];
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += stepDeg) angles.push(d);
  const tans = angles.map((d) => Math.tan((d * Math.PI) / 180));
  const rads = angles.map((d) => (d * Math.PI) / 180);
  const pad = Math.ceil(Math.tan((maxDeg * Math.PI) / 180) * bandHeight) + 2;
  const span = w + 2 * pad;
  const acc = angles.map(() => new Float32Array(span));

  for (let y = y0; y < y1; y++) {
    const dy = y - yc;
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const gx = grad.gx[row + x];
      const ax = Math.abs(gx);
      if (ax < opts.edgeThreshold) continue;
      const gy = grad.gy[row + x];
      if (ax < 1.5 * Math.abs(gy)) continue;
      // direction of the edge relative to vertical (the gradient is perpendicular to the edge)
      const theta = gx > 0 ? Math.atan2(-gy, gx) : Math.atan2(gy, -gx);
      for (let a = 0; a < angles.length; a++) {
        if (Math.abs(theta - rads[a]) > tolerance) continue;
        const xi = Math.round(x - tans[a] * dy) + pad;
        if (xi >= 0 && xi < span) acc[a][xi] += 1;
      }
    }
  }

  // support of a line: votes in a 3 px wide column (edges are 2–3 px wide), relative to the band height
  const best = new Float32Array(span);
  const bestAngle = new Int16Array(span);
  for (let a = 0; a < angles.length; a++) {
    const col = acc[a];
    for (let x = 0; x < span; x++) {
      const v = ((x > 0 ? col[x - 1] : 0) + col[x] + (x + 1 < span ? col[x + 1] : 0)) / bandHeight;
      if (v > best[x]) {
        best[x] = v;
        bestAngle[x] = a;
      }
    }
  }

  const minSep = Math.max(4, Math.round(bandHeight * (opts.minSeparationFraction ?? 0.035)));
  const out: Boundary[] = [];
  for (let x = 0; x < span; x++) {
    const v = best[x];
    if (v < minScore) continue;
    let isPeak = true;
    for (let k = Math.max(0, x - minSep); k <= Math.min(span - 1, x + minSep); k++) {
      if (best[k] > v || (best[k] === v && k < x)) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) out.push({ xc: x - pad, deg: angles[bestAngle[x]], score: Math.round(v * 1000) / 1000 });
  }
  return out;
}

/**
 * Shelf bands: horizontal stripes of a frame where books stand side by side. Upright spines make many
 * near-vertical edges, so a band is a run of rows whose near-vertical edge density stays high.
 */
import { type Gradients, type GrayImage, smooth1d } from './raster';

export interface Band {
  /** first row (inclusive), working resolution */
  y0: number;
  /** last row (exclusive) */
  y1: number;
  /** mean near-vertical edge density of the rows (0..1) */
  density: number;
}

export interface BandOptions {
  /** |Sobel x| above which a pixel is an edge (0..1020 scale) */
  edgeThreshold: number;
  /** rows count when their smoothed density reaches this share of the frame maximum */
  relativeLevel?: number;
  /** bands lower than this share of the frame height are ignored */
  minHeightFraction?: number;
  /** runs separated by gaps below this share of the frame height are joined */
  joinGapFraction?: number;
  /** the frame maximum must at least reach this density, otherwise there are no books */
  minPeakDensity?: number;
}

export const DEFAULT_EDGE_THRESHOLD = 60;

/** Share of pixels per row that sit on a near-vertical edge (|gx| > threshold, within ~22° of vertical). */
export function verticalEdgeDensity(img: GrayImage, grad: Gradients, edgeThreshold: number): Float32Array {
  const { width: w, height: h } = img;
  const out = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    let n = 0;
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const ax = Math.abs(grad.gx[row + x]);
      if (ax > edgeThreshold && ax > 2.5 * Math.abs(grad.gy[row + x])) n++;
    }
    out[y] = n / w;
  }
  return out;
}

export function detectBands(img: GrayImage, grad: Gradients, opts: BandOptions): Band[] {
  const relativeLevel = opts.relativeLevel ?? 0.45;
  const minHeight = Math.max(4, Math.round(img.height * (opts.minHeightFraction ?? 0.1)));
  const joinGap = Math.round(img.height * (opts.joinGapFraction ?? 0.03));
  const minPeak = opts.minPeakDensity ?? 0.04;

  const density = smooth1d(verticalEdgeDensity(img, grad, opts.edgeThreshold), Math.max(1, Math.round(img.height * 0.01)));
  let peak = 0;
  for (const v of density) peak = Math.max(peak, v);
  if (peak < minPeak) return [];
  const level = peak * relativeLevel;

  const runs: { y0: number; y1: number }[] = [];
  let start = -1;
  for (let y = 0; y <= img.height; y++) {
    const on = y < img.height && density[y] >= level;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const last = runs[runs.length - 1];
      if (last && start - last.y1 <= joinGap) last.y1 = y;
      else runs.push({ y0: start, y1: y });
      start = -1;
    }
  }
  return runs
    .filter((r) => r.y1 - r.y0 >= minHeight)
    .map((r) => {
      let sum = 0;
      for (let y = r.y0; y < r.y1; y++) sum += density[y];
      return { y0: r.y0, y1: r.y1, density: sum / (r.y1 - r.y0) };
    });
}

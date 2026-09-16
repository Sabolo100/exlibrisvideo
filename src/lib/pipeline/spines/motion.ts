/**
 * Camera motion between consecutive frames.
 *
 * Horizontal: the column colour profile of the shelf band (mean colour per column + its derivative) is
 * compared at every shift with normalised cross-correlation. Upright spines keep their column colours
 * when the camera also drifts up or down, so this works for fast, shaky pans where 2D phase correlation
 * fails. The estimate is then refined with the detected boundaries into x_k = s·x_{k-1} + d (s absorbs
 * walking closer to or away from the shelf).
 * Vertical: the same on row profiles of the whole frame.
 */
import sharp from 'sharp';
import { median } from './raster';

export const PROFILE_SCALE = 0.25;

export interface Profile {
  /** samples (columns or rows) at PROFILE_SCALE */
  length: number;
  /** full-resolution px per sample */
  step: number;
  /** level and derivative per channel */
  features: Float32Array[];
}

/**
 * Column profile of rows y0..y1 and row profile of the whole frame, from one decode at PROFILE_SCALE.
 * `y0/y1` are full-resolution rows.
 */
export async function loadProfiles(input: string | Buffer, y0: number, y1: number): Promise<{ columns: Profile; rows: Profile }> {
  const meta = await sharp(input).metadata();
  const fw = meta.width ?? 1;
  const fh = meta.height ?? 1;
  const w = Math.max(8, Math.round(fw * PROFILE_SCALE));
  const h = Math.max(8, Math.round(fh * PROFILE_SCALE));
  const { data } = await sharp(input).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const r0 = Math.max(0, Math.min(h - 1, Math.floor(y0 * PROFILE_SCALE)));
  const r1 = Math.max(r0 + 1, Math.min(h, Math.ceil(y1 * PROFILE_SCALE)));
  const cols = [new Float32Array(w), new Float32Array(w), new Float32Array(w)];
  const rows = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        rows[c][y] += v / w;
        if (y >= r0 && y < r1) cols[c][x] += v / (r1 - r0);
      }
    }
  }
  return {
    columns: { length: w, step: fw / w, features: withDerivatives(cols) },
    rows: { length: h, step: fh / h, features: withDerivatives(rows) },
  };
}

function withDerivatives(levels: Float32Array[]): Float32Array[] {
  const out: Float32Array[] = [];
  for (const level of levels) {
    const d = new Float32Array(level.length);
    for (let i = 1; i < level.length - 1; i++) d[i] = (level[i + 1] - level[i - 1]) / 2;
    out.push(level, d);
  }
  return out;
}

export interface ShiftEstimate {
  /** full-resolution px: content at p in the first frame is at p + shift in the second */
  shift: number;
  /** normalised correlation at the best shift (−1..1) */
  score: number;
  /** best score minus the best score of another peak (ambiguity) */
  margin: number;
}

/**
 * Best shift of `b` against `a` by normalised cross-correlation over all shifts that keep at least
 * `minOverlap` of the profile overlapping. Derivative channels weigh 3× (edges beat lighting).
 */
export function estimateShift(a: Profile, b: Profile, opts: { minOverlap?: number } = {}): ShiftEstimate | null {
  const n = Math.min(a.length, b.length);
  const minOv = Math.max(4, Math.round(n * (opts.minOverlap ?? 0.25)));
  if (n < minOv) return null;
  const scores: { d: number; s: number }[] = [];
  for (let d = -(n - minOv); d <= n - minOv; d++) {
    const x0 = Math.max(0, d);
    const x1 = Math.min(n, n + d);
    const len = x1 - x0;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let f = 0; f < a.features.length; f++) {
      const wt = f % 2 === 1 ? 3 : 1;
      const fa = a.features[f];
      const fb = b.features[f];
      let ma = 0;
      let mb = 0;
      for (let x = x0; x < x1; x++) {
        ma += fa[x - d];
        mb += fb[x];
      }
      ma /= len;
      mb /= len;
      for (let x = x0; x < x1; x++) {
        const va = fa[x - d] - ma;
        const vb = fb[x] - mb;
        num += wt * va * vb;
        da += wt * va * va;
        db += wt * vb * vb;
      }
    }
    scores.push({ d, s: num / Math.sqrt(da * db + 1e-9) });
  }
  const peaks = scores.filter((p, i) => (i === 0 || p.s >= scores[i - 1].s) && (i === scores.length - 1 || p.s >= scores[i + 1].s));
  if (peaks.length === 0) return null;
  peaks.sort((p, q) => q.s - p.s);
  const best = peaks[0];
  const second = peaks.find((p) => Math.abs(p.d - best.d) > 4);
  return { shift: best.d * a.step, score: best.s, margin: best.s - (second?.s ?? -1) };
}

export interface XTransform {
  /** x_k = s·x_{k-1} + d */
  s: number;
  d: number;
  /** boundary pairs that support the transform */
  matches: number;
}

/**
 * Refines a horizontal shift with matching boundary positions of the two frames (each boundary of the
 * first frame pairs with the nearest one of the second within `window` px of the predicted position) and
 * fits scale + shift through them with one outlier-removal round. Falls back to the plain shift.
 */
export function refineWithBoundaries(prev: readonly number[], next: readonly number[], shift: number, window = 24): XTransform {
  const pairs: [number, number][] = [];
  for (const x of prev) {
    let best: number | null = null;
    for (const y of next) {
      const r = Math.abs(y - x - shift);
      if (r <= window && (best === null || r < Math.abs(best - x - shift))) best = y;
    }
    if (best !== null) pairs.push([x, best]);
  }
  if (pairs.length < 2) return { s: 1, d: shift, matches: pairs.length };
  if (pairs.length < 4) return { s: 1, d: median(pairs.map(([x, y]) => y - x)), matches: pairs.length };
  let current = pairs;
  let fit = fitLine(current);
  for (let round = 0; round < 2; round++) {
    const residuals = current.map(([x, y]) => Math.abs(y - (fit.s * x + fit.d)));
    const limit = Math.max(6, 2.5 * median(residuals));
    const kept = current.filter((_, i) => residuals[i] <= limit);
    if (kept.length === current.length || kept.length < 4) break;
    current = kept;
    fit = fitLine(current);
  }
  return { ...fit, matches: current.length };
}

function fitLine(pairs: readonly [number, number][]): { s: number; d: number } {
  const n = pairs.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pairs) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
  }
  let s = sxx > 1e-6 ? sxy / sxx : 1;
  // zooming more than 10 % between two key frames is not a pan: keep a plain shift
  if (!(s > 0.9 && s < 1.1)) s = 1;
  return { s, d: my - s * mx };
}

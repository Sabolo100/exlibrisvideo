/**
 * Small raster helpers for the spine geometry (pure except loadGray / loadColumns).
 */
import sharp from 'sharp';

export interface GrayImage {
  width: number;
  height: number;
  /** row-major grey values 0..255 */
  data: Float32Array;
}

export interface Gradients {
  gx: Float32Array;
  gy: Float32Array;
}

/** Greyscale copy of an image scaled by `scale` (0 < scale ≤ 1) plus the original size. */
export async function loadGray(
  input: string | Buffer,
  scale: number,
): Promise<{ image: GrayImage; fullWidth: number; fullHeight: number }> {
  const meta = await sharp(input).metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  const width = Math.max(1, Math.round(fullWidth * scale));
  const height = Math.max(1, Math.round(fullHeight * scale));
  const { data } = await sharp(input).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { image: { width, height, data: Float32Array.from(data) }, fullWidth, fullHeight };
}

/** 3×3 Sobel derivatives (borders stay 0). */
export function sobel(img: GrayImage): Gradients {
  const { width: w, height: h, data: g } = img;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1];
      const b = g[i - w];
      const c = g[i - w + 1];
      const d = g[i - 1];
      const f = g[i + 1];
      const p = g[i + w - 1];
      const q = g[i + w];
      const r = g[i + w + 1];
      gx[i] = c + 2 * f + r - (a + 2 * d + p);
      gy[i] = p + 2 * q + r - (a + 2 * b + c);
    }
  }
  return { gx, gy };
}

/** Box filter of radius `radius` (window 2r+1, shrunk at the ends). */
export function smooth1d(values: ArrayLike<number>, radius: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const r = Math.max(0, Math.floor(radius));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Variance of the 4-neighbour Laplacian – a focus measure (higher = sharper). */
export function laplacianVariance(img: GrayImage): number {
  const { width: w, height: h, data: g } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += v;
      sq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sq / n - mean * mean;
}

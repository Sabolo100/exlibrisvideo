/**
 * Frame quality helpers (SPEC §4.2 steps 2 and 4).
 *
 * - laplacianVariance: greyscale → 640 px long edge → 3×3 Laplacian convolution (sharp) → variance.
 *   Motion blur flattens edges, so a blurred frame has a much lower variance than a crisp one.
 * - grayscaleSignature + meanAbsDiff: a tiny 16×9 (or 9×16) greyscale thumbnail used to detect
 *   frames where the camera did not move.
 */
import sharp from 'sharp';

export type ImageInput = string | Buffer;

export const SHARPNESS_EDGE = 640;
export const SIGNATURE_LONG = 16;
export const SIGNATURE_SHORT = 9;

const LAPLACIAN = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 0 };

export interface GreySignature {
  width: number;
  height: number;
  /** width × height greyscale values 0..255 */
  data: Uint8Array;
}

export interface FrameQuality {
  sharpness: number;
  signature: GreySignature;
}

function float32View(buf: Buffer): Float32Array {
  const count = Math.floor(buf.length / 4);
  if (buf.byteOffset % 4 === 0) return new Float32Array(buf.buffer, buf.byteOffset, count);
  // Misaligned view on a pooled buffer: copy into a fresh, aligned ArrayBuffer.
  const copy = new Uint8Array(count * 4);
  copy.set(buf.subarray(0, count * 4));
  return new Float32Array(copy.buffer);
}

/** Population variance of a numeric array (0 for empty input). */
export function variance(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

/** Greyscale raw pixels, long edge ≤ SHARPNESS_EDGE (EXIF orientation applied). */
async function greyPreview(input: ImageInput): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input, { failOn: 'truncated' })
    .rotate()
    .greyscale()
    .resize({ width: SHARPNESS_EDGE, height: SHARPNESS_EDGE, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function laplacianVarianceOfGrey(grey: { data: Buffer; width: number; height: number }): Promise<number> {
  if (grey.width < 3 || grey.height < 3) return 0;
  // Float output keeps the negative Laplacian responses (a uchar pipeline would clip them to 0).
  const conv = await sharp(grey.data, { raw: { width: grey.width, height: grey.height, channels: 1 } })
    .convolve(LAPLACIAN)
    .raw({ depth: 'float' })
    .toBuffer();
  const values = float32View(conv);
  // Ignore the 1 px border (padding artefacts of the convolution).
  const w = grey.width;
  const h = grey.height;
  if (values.length < w * h) return variance(values);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const v = values[row + x];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

async function signatureOfGrey(grey: { data: Buffer; width: number; height: number }): Promise<GreySignature> {
  const landscape = grey.width >= grey.height;
  const width = landscape ? SIGNATURE_LONG : SIGNATURE_SHORT;
  const height = landscape ? SIGNATURE_SHORT : SIGNATURE_LONG;
  const data = await sharp(grey.data, { raw: { width: grey.width, height: grey.height, channels: 1 } })
    .resize({ width, height, fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, width * height) };
}

/** Variance of the Laplacian of the greyscale image scaled to a 640 px long edge. Higher = sharper. */
export async function laplacianVariance(input: ImageInput): Promise<number> {
  return laplacianVarianceOfGrey(await greyPreview(input));
}

/** 16×9 (landscape) or 9×16 (portrait) greyscale thumbnail. */
export async function grayscaleSignature(input: ImageInput): Promise<GreySignature> {
  return signatureOfGrey(await greyPreview(input));
}

/** Sharpness + signature with a single decode. */
export async function analyzeFrame(input: ImageInput): Promise<FrameQuality> {
  const grey = await greyPreview(input);
  const [sharpness, signature] = await Promise.all([laplacianVarianceOfGrey(grey), signatureOfGrey(grey)]);
  return { sharpness, signature };
}

/**
 * Mean absolute difference (0..255) between two signatures. Signatures of different shapes
 * (orientation change) are maximally different.
 */
export function meanAbsDiff(a: GreySignature, b: GreySignature): number {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return 255;
  const n = a.data.length;
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(a.data[i] - b.data[i]);
  return total / n;
}

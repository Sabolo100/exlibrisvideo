/**
 * Cutting spines out of frames: the (tilted) spine rectangle of a view, its upright crop, the picture
 * sent for reading (the crop turned on its side both ways) and a focus measure to pick the best view.
 */
import sharp from 'sharp';
import type { BBox, RotatedRect } from '@/lib/types';
import { laplacianVariance, loadGray } from './raster';
import type { SpineView } from './tracking';

/** share of the band height added above and below the band (book tops often stick out of it) */
export const STRIP_VERTICAL_MARGIN = 0.28;
/** px added along both long edges of a spine */
export const STRIP_SIDE_PAD = 6;
/** reading pictures: each turned strip is at least this thick (thin spines are enlarged) … */
export const READING_MIN_THICKNESS = 72;
/** … and at most this long (close-ups are reduced) */
export const READING_MAX_LENGTH = 1280;
const READING_GAP = 10;

/**
 * The rectangle of the spine in a view, in frame pixels. `span` (fractions of the spine width, left to
 * right) cuts out one of several books standing in it.
 */
export function spineRect(view: SpineView, frameHeight: number, span: readonly [number, number] = [0, 1]): RotatedRect {
  const deg = (view.left.deg + view.right.deg) / 2;
  const rad = (deg * Math.PI) / 180;
  const bandHeight = view.band.y1 - view.band.y0;
  const across = (view.right.xc - view.left.xc) * Math.cos(rad);
  const from = Math.max(0, Math.min(1, span[0]));
  const to = Math.max(from, Math.min(1, span[1]));
  const whole = from === 0 && to === 1;
  const width = across * (to - from);
  // centre of the span along the across axis u = (cos, -sin)
  const offset = ((from + to) / 2 - 0.5) * across;
  const cx = (view.left.xc + view.right.xc) / 2 + offset * Math.cos(rad);
  const cy = (view.band.y0 + view.band.y1) / 2 - offset * Math.sin(rad);
  const height = Math.min(frameHeight, bandHeight * (1 + 2 * STRIP_VERTICAL_MARGIN));
  return { cx, cy, width: width + (whole ? 2 * STRIP_SIDE_PAD : 0), height, deg };
}

/**
 * Where to cut an upright strip that shows `parts` books side by side: the strongest long vertical edges
 * (gaps between books), at least half a book apart and away from the strip edges. Returns the cut
 * positions as fractions of the strip width, left to right (fewer when no clear edges exist).
 */
export async function splitPositions(upright: Buffer, parts: number): Promise<number[]> {
  if (parts < 2) return [];
  const meta = await sharp(upright).metadata();
  const long = Math.max(meta.width ?? 1, meta.height ?? 1);
  const { image } = await loadGray(upright, Math.min(1, 640 / long));
  const { width: w, height: h, data } = image;
  const r0 = Math.floor(h * 0.2);
  const r1 = Math.ceil(h * 0.8);
  const column = new Float32Array(w);
  for (let y = Math.max(1, r0); y < Math.min(h - 1, r1); y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - (data[i - w - 1] + 2 * data[i - 1] + data[i + w - 1]);
      const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - (data[i - w - 1] + 2 * data[i - w] + data[i - w + 1]);
      if (Math.abs(gx) > 30 && Math.abs(gx) > 1.5 * Math.abs(gy)) column[x] += 1;
    }
  }
  const book = w / parts;
  const minGap = Math.max(3, Math.round(book * 0.5));
  const edge = Math.max(2, Math.round(book * 0.25));
  const cuts: number[] = [];
  const taken = (x: number) => cuts.some((c) => Math.abs(c - x) < minGap);
  const order = Array.from({ length: w }, (_, x) => x)
    .filter((x) => x >= edge && x <= w - edge)
    .sort((a, b) => column[b] + column[b - 1] + column[b + 1] - (column[a] + column[a - 1] + column[a + 1]));
  for (const x of order) {
    if (cuts.length >= parts - 1) break;
    // a real gap runs along most of the book height
    if ((column[x] + column[x - 1] + column[x + 1]) / (r1 - r0) < 0.35) break;
    if (!taken(x)) cuts.push(x);
  }
  return cuts.sort((a, b) => a - b).map((x) => x / w);
}

/** Axis-aligned bounding box of a rotated rectangle, clamped to the frame, with the rectangle attached. */
export function rectBoundingBox(rect: RotatedRect, frameWidth: number, frameHeight: number): BBox {
  const rad = (rect.deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [su, sv] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    // across u = (cos, -sin), along v = (sin, cos)
    xs.push(rect.cx + su * hw * cos + sv * hh * sin);
    ys.push(rect.cy - su * hw * sin + sv * hh * cos);
  }
  const clampX = (v: number) => Math.min(frameWidth, Math.max(0, v));
  const clampY = (v: number) => Math.min(frameHeight, Math.max(0, v));
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    x0: Math.floor(clampX(Math.min(...xs))),
    y0: Math.floor(clampY(Math.min(...ys))),
    x1: Math.ceil(clampX(Math.max(...xs))),
    y1: Math.ceil(clampY(Math.max(...ys))),
    rect: { cx: round(rect.cx), cy: round(rect.cy), width: round(rect.width), height: round(rect.height), deg: round(rect.deg) },
  };
}

/**
 * The spine upright: the frame region around the rectangle is turned by `deg` (sharp turns clockwise for
 * positive angles, which straightens "\" spines) and the rectangle is cut out of the result.
 */
export async function cutUpright(input: string | Buffer, rect: RotatedRect, quality = 90): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const fw = meta.width ?? 0;
  const fh = meta.height ?? 0;
  const box = rectBoundingBox(rect, fw, fh);
  const margin = 30;
  const left = Math.max(0, box.x0 - margin);
  const top = Math.max(0, box.y0 - margin);
  const width = Math.max(1, Math.min(fw, box.x1 + margin) - left);
  const height = Math.max(1, Math.min(fh, box.y1 + margin) - top);
  const region = await sharp(input).extract({ left, top, width, height }).toBuffer();
  const turned = await sharp(region).rotate(rect.deg, { background: '#000000' }).toBuffer({ resolveWithObject: true });
  const rad = (rect.deg * Math.PI) / 180;
  const dx = rect.cx - left - width / 2;
  const dy = rect.cy - top - height / 2;
  const cx = turned.info.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad);
  const cy = turned.info.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad);
  const sx = Math.max(0, Math.min(turned.info.width - 1, Math.round(cx - rect.width / 2)));
  const sy = Math.max(0, Math.min(turned.info.height - 1, Math.round(cy - rect.height / 2)));
  const sw = Math.max(1, Math.min(Math.round(rect.width), turned.info.width - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height), turned.info.height - sy));
  return sharp(turned.data).extract({ left: sx, top: sy, width: sw, height: sh }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** an upright strip at least this wide for its height also goes into the reading picture as it stands */
export const UPRIGHT_ASPECT = 0.2;

/**
 * The picture sent for reading: the upright spine turned counter-clockwise (top-to-bottom text reads
 * left to right) above the same spine turned clockwise (bottom-to-top text reads left to right). Wide
 * spines (or `withUpright`) are also shown standing, to the right, for horizontally printed text.
 */
export async function readingImage(upright: Buffer, opts: { withUpright?: boolean } = {}): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const meta = await sharp(upright).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  let scale = 1;
  if (w < READING_MIN_THICKNESS) scale = READING_MIN_THICKNESS / w;
  if (h * scale > READING_MAX_LENGTH) scale = READING_MAX_LENGTH / h;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const base = await sharp(upright).resize(tw, th, { fit: 'fill' }).toBuffer();
  const ccw = await sharp(base).rotate(-90).toBuffer();
  const cw = await sharp(base).rotate(90).toBuffer();
  const rowsHeight = 2 * tw + READING_GAP;
  const composites: { input: Buffer; left: number; top: number }[] = [
    { input: ccw, left: 0, top: 0 },
    { input: cw, left: 0, top: tw + READING_GAP },
  ];
  let width = th;
  if (opts.withUpright || w / h >= UPRIGHT_ASPECT) {
    // standing copy as tall as both turned strips together
    const standW = Math.max(1, Math.round((tw * rowsHeight) / th));
    composites.push({ input: await sharp(base).resize(standW, rowsHeight, { fit: 'fill' }).toBuffer(), left: th + READING_GAP * 2, top: 0 });
    width = th + READING_GAP * 2 + standW;
  }
  const jpeg = await sharp({ create: { width, height: rowsHeight, channels: 3, background: '#ffffff' } })
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { jpeg, width, height: rowsHeight };
}

/** Focus measure of a cut spine (only comparable between views of the same spine). */
export async function stripSharpness(upright: Buffer): Promise<number> {
  const meta = await sharp(upright).metadata();
  const long = Math.max(meta.width ?? 1, meta.height ?? 1);
  const { image } = await loadGray(upright, Math.min(1, 320 / long));
  return laplacianVariance(image);
}

/**
 * Spine crops (SPEC §4.5): books.bestFrameId + bestBbox → expand 6 % on each side, clamp, extract,
 * resize to ≤ 900 px long edge, JPEG q82 → spines/<cid>/<bookId>.jpg; spineColor = dominant colour
 * (sharp stats().dominant of the spine centre – without the 6 % margin, shelf background and neighbours –
 * refined from the coarse histogram cell centre to the mean colour of the pixels around it).
 *
 * Note: books.updated_at is deliberately NOT touched – enrichment uses updated_at > created_at as a
 * "the owner edited this book" signal.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { db } from '@/db';
import { books, frames } from '@/db/schema';
import { describeError } from '@/lib/jobs/errors';
import { abs, ensureDirFor, rel } from '@/lib/storage';
import type { BBox } from '@/lib/types';

export const CROP_EXPAND = 0.06;
export const CROP_MIN_PX = 12;
export const CROP_MAX_EDGE = 900;
export const CROP_JPEG_QUALITY = 82;
const CROP_CONCURRENCY = 3;

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Expands a bbox by `expand` of its size on each side and clamps it to the image. Returns null for
 * invalid boxes or when the clamped crop is smaller than CROP_MIN_PX in either dimension.
 * `scaleX/scaleY` map frame coordinates to the actual image pixels (normally 1).
 */
export function cropRect(
  bbox: BBox | null | undefined,
  imageWidth: number,
  imageHeight: number,
  opts: { expand?: number; expandX?: number; expandY?: number; minPx?: number; scaleX?: number; scaleY?: number } = {},
): CropRect | null {
  if (!bbox || imageWidth <= 0 || imageHeight <= 0) return null;
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const vals = [bbox.x0, bbox.y0, bbox.x1, bbox.y1].map(Number);
  if (!vals.every(Number.isFinite)) return null;
  const x0 = Math.min(vals[0], vals[2]) * sx;
  const x1 = Math.max(vals[0], vals[2]) * sx;
  const y0 = Math.min(vals[1], vals[3]) * sy;
  const y1 = Math.max(vals[1], vals[3]) * sy;
  const minPx = opts.minPx ?? CROP_MIN_PX;
  // the raw box itself must be a real spine, not a speck
  if (x1 - x0 < minPx || y1 - y0 < minPx) return null;
  const expand = opts.expand ?? CROP_EXPAND;
  // negative factors shrink the box (colour sampling of the spine centre)
  const dx = (x1 - x0) * Math.max(-0.49, opts.expandX ?? expand);
  const dy = (y1 - y0) * Math.max(-0.49, opts.expandY ?? expand);
  const left = Math.max(0, Math.floor(x0 - dx));
  const top = Math.max(0, Math.floor(y0 - dy));
  const right = Math.min(imageWidth, Math.ceil(x1 + dx));
  const bottom = Math.min(imageHeight, Math.ceil(y1 + dy));
  const width = right - left;
  const height = bottom - top;
  if (width < minPx || height < minPx) return null;
  return { left, top, width, height };
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * sharp's stats().dominant is the centre of the fullest cell of a 16×16×16 histogram (e.g. #a82818 for a
 * #b03020 spine – libvips' cell boundaries are not exactly multiples of 16). Pixels within this distance
 * (per channel) of that centre belong to the dominant cell or its immediate border.
 */
const DOMINANT_RADIUS = 12;

/**
 * Refines sharp's dominant colour (a coarse histogram cell centre) to the mean of the pixels around it,
 * which is the actual spine tint. Falls back to the cell centre when no pixel is close.
 */
export function refineDominant(
  raw: Uint8Array,
  channels: number,
  dominant: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const step = Math.max(3, Math.floor(channels));
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let i = 0; i + 2 < raw.length; i += step) {
    if (
      Math.abs(raw[i] - dominant.r) <= DOMINANT_RADIUS &&
      Math.abs(raw[i + 1] - dominant.g) <= DOMINANT_RADIUS &&
      Math.abs(raw[i + 2] - dominant.b) <= DOMINANT_RADIUS
    ) {
      sr += raw[i];
      sg += raw[i + 1];
      sb += raw[i + 2];
      n++;
    }
  }
  return n > 0 ? { r: sr / n, g: sg / n, b: sb / n } : dominant;
}

/** Colour sample of a spine: the centre of the unexpanded box (no shelf background, no neighbours). */
export const COLOR_SAMPLE_SHRINK_X = -0.2;
export const COLOR_SAMPLE_SHRINK_Y = -0.1;
const COLOR_SAMPLE_PIXELS = 64 * 64;

export async function dominantSpineColor(image: Sharp, rect: CropRect): Promise<string> {
  const scale = Math.min(1, Math.sqrt(COLOR_SAMPLE_PIXELS / (rect.width * rect.height)));
  const { data, info } = await image
    .clone()
    .extract(rect)
    .resize({ width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)), fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { dominant } = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).stats();
  return toHex(refineDominant(data, info.channels, dominant));
}

export interface CropSpinesResult {
  cropped: number;
  skipped: number;
  failed: number;
}

/** Crops spine photos for the given books. Missing frames / degenerate boxes are skipped. */
export async function cropSpines(
  bookIds: string[],
  onProgress?: (fraction: number) => void | Promise<void>,
): Promise<CropSpinesResult> {
  const ids = [...new Set(bookIds.filter(Boolean))];
  const result: CropSpinesResult = { cropped: 0, skipped: 0, failed: 0 };
  if (ids.length === 0) return result;

  const rows = await db()
    .select({
      id: books.id,
      collectionId: books.collectionId,
      bestBbox: books.bestBbox,
      frameId: frames.id,
      framePath: frames.storagePath,
      frameWidth: frames.width,
      frameHeight: frames.height,
    })
    .from(books)
    .leftJoin(frames, eq(frames.id, books.bestFrameId))
    .where(inArray(books.id, ids));
  result.skipped += ids.length - rows.length; // books deleted meanwhile

  let done = 0;
  let next = 0;
  const tick = async () => {
    done++;
    if (onProgress) await onProgress(done / rows.length);
  };

  const cropOne = async (row: (typeof rows)[number]): Promise<'cropped' | 'skipped' | 'failed'> => {
    if (!row.frameId || !row.framePath || !row.bestBbox) return 'skipped';
    const framePath = abs(row.framePath);
    let meta: Metadata;
    try {
      meta = await sharp(framePath).metadata();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const missing = code === 'ENOENT' || /missing|does not exist|no such file/i.test((err as Error).message ?? '');
      if (!missing) console.warn('[pipeline] crops: frame unreadable', { bookId: row.id, error: describeError(err, 200) });
      return missing ? 'skipped' : 'failed';
    }
    const fw = row.frameWidth && row.frameWidth > 0 ? row.frameWidth : meta.width;
    const fh = row.frameHeight && row.frameHeight > 0 ? row.frameHeight : meta.height;
    const scale = { scaleX: meta.width / fw, scaleY: meta.height / fh };
    const rect = cropRect(row.bestBbox, meta.width, meta.height, scale);
    if (!rect) return 'skipped';
    try {
      const image = sharp(framePath);
      const crop = await image
        .clone()
        .extract(rect)
        .resize({ width: CROP_MAX_EDGE, height: CROP_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: CROP_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      const sampleRect =
        cropRect(row.bestBbox, meta.width, meta.height, {
          ...scale,
          expandX: COLOR_SAMPLE_SHRINK_X,
          expandY: COLOR_SAMPLE_SHRINK_Y,
          minPx: 2,
        }) ?? rect;
      const spineColor = await dominantSpineColor(image, sampleRect);
      const spinePath = rel.spine(row.collectionId, row.id);
      const target = await ensureDirFor(spinePath);
      const tmp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(tmp, crop);
      await fs.rename(tmp, target);
      const updated = await db()
        .update(books)
        .set({ spinePath, spineColor })
        .where(eq(books.id, row.id))
        .returning({ id: books.id });
      if (updated.length === 0) {
        // book (or the whole collection) deleted while cropping – do not leave orphan files/dirs behind
        await fs.rm(target, { force: true });
        await fs.rmdir(path.dirname(target)).catch(() => {}); // only succeeds when empty
        return 'skipped';
      }
      return 'cropped';
    } catch (err) {
      console.warn('[pipeline] crops: crop failed', { bookId: row.id, error: describeError(err, 200) });
      return 'failed';
    }
  };

  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const outcome = await cropOne(rows[i]);
      result[outcome]++;
      await tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CROP_CONCURRENCY, rows.length) }, () => lane()));
  return result;
}

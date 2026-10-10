/**
 * Browser side of "add a book from a photo": shrink the picked photo to an upright JPEG (≤ 1600 px, a few
 * hundred kB – fast on mobile data) and read an ISBN barcode on the device when the browser can
 * (BarcodeDetector: Chrome on Android); the server reads it otherwise.
 */

const MAX_EDGE = 1600;

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface PreparedPhoto {
  jpeg: Blob;
  /** object URL of `jpeg` for the preview (revoke when done) */
  url: string;
  /** EAN-13 digits read on the device, or null */
  barcode: string | null;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

async function detectBarcode(bitmap: ImageBitmap): Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['ean_13'];
    if (!formats.includes('ean_13')) return null;
    const codes = await new Ctor({ formats: ['ean_13'] }).detect(bitmap);
    return codes.find((c) => /^97[89]\d{10}$/.test(c.rawValue))?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Shrinks the photo (keeps the original when the browser cannot decode it) and looks for a barcode. */
export async function preparePhoto(file: File, opts: { barcode?: boolean } = {}): Promise<PreparedPhoto> {
  const bitmap = await loadBitmap(file);
  if (!bitmap) return { jpeg: file, url: URL.createObjectURL(file), barcode: null };
  const barcode = opts.barcode ? await detectBarcode(bitmap) : null;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { jpeg: file, url: URL.createObjectURL(file), barcode };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  const out = jpeg ?? file;
  return { jpeg: out, url: URL.createObjectURL(out), barcode };
}

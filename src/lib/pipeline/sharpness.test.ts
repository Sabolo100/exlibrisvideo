import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeFrame, grayscaleSignature, laplacianVariance, meanAbsDiff, variance } from './sharpness';

async function stripes(width: number, height: number, blur?: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw[y * width + x] = Math.floor(x / 6) % 2 === 0 ? 30 : 220;
  }
  let img = sharp(raw, { raw: { width, height, channels: 1 } });
  if (blur) img = img.blur(blur);
  return img.jpeg({ quality: 95 }).toBuffer();
}

describe('variance', () => {
  it('computes the population variance', () => {
    expect(variance([1, 2, 3, 4])).toBeCloseTo(1.25, 6);
    expect(variance([])).toBe(0);
    expect(variance([5, 5, 5])).toBe(0);
  });
});

describe('laplacianVariance', () => {
  it('scores a crisp image far above a motion-blurred one', async () => {
    const crisp = await laplacianVariance(await stripes(1080, 1920));
    const blurred = await laplacianVariance(await stripes(1080, 1920, 6));
    expect(crisp).toBeGreaterThan(0);
    expect(crisp).toBeGreaterThan(blurred * 5);
  });

  it('is zero for a flat image and handles tiny inputs', async () => {
    const flat = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#808080' } }).png().toBuffer();
    expect(await laplacianVariance(flat)).toBeCloseTo(0, 3);
    const tiny = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer();
    expect(await laplacianVariance(tiny)).toBe(0);
  });
});

describe('signatures', () => {
  it('uses 16×9 for landscape and 9×16 for portrait', async () => {
    const land = await grayscaleSignature(await stripes(640, 360));
    expect([land.width, land.height, land.data.length]).toEqual([16, 9, 144]);
    const port = await analyzeFrame(await stripes(360, 640));
    expect([port.signature.width, port.signature.height]).toEqual([9, 16]);
  });

  it('meanAbsDiff is 0 for identical, large for different, 255 for mismatched shapes', () => {
    const a = { width: 2, height: 2, data: Uint8Array.from([0, 10, 20, 30]) };
    const b = { width: 2, height: 2, data: Uint8Array.from([10, 0, 20, 50]) };
    expect(meanAbsDiff(a, a)).toBe(0);
    expect(meanAbsDiff(a, b)).toBe(10);
    expect(meanAbsDiff(a, { width: 4, height: 1, data: a.data })).toBe(255);
  });
});

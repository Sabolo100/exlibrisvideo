import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: () => { throw new Error('db not available in unit tests'); } }));

const { COLOR_SAMPLE_SHRINK_X, COLOR_SAMPLE_SHRINK_Y, cropRect, dominantSpineColor, refineDominant, toHex } = await import('./crops');

describe('cropRect', () => {
  it('expands the box by 6 % on each side', () => {
    expect(cropRect({ x0: 100, y0: 200, x1: 200, y1: 700 }, 1080, 1920)).toEqual({
      left: 94,
      top: 170,
      width: 112,
      height: 560,
    });
  });

  it('clamps to the image and normalises swapped corners', () => {
    expect(cropRect({ x0: 1070, y0: 1900, x1: 1000, y1: 1500 }, 1080, 1920)).toEqual({
      left: 995,
      top: 1476,
      width: 80,
      height: 444,
    });
    expect(cropRect({ x0: -50, y0: -50, x1: 60, y1: 400 }, 1080, 1920)).toMatchObject({ left: 0, top: 0 });
  });

  it('skips degenerate boxes (< 12 px) and invalid input', () => {
    expect(cropRect({ x0: 10, y0: 10, x1: 21, y1: 500 }, 1080, 1920)).toBeNull();
    expect(cropRect({ x0: 10, y0: 10, x1: 400, y1: 15 }, 1080, 1920)).toBeNull();
    expect(cropRect(null, 1080, 1920)).toBeNull();
    expect(cropRect({ x0: Number.NaN, y0: 0, x1: 100, y1: 100 }, 1080, 1920)).toBeNull();
    // entirely outside the frame
    expect(cropRect({ x0: 2000, y0: 0, x1: 2100, y1: 500 }, 1080, 1920)).toBeNull();
  });

  it('scales frame coordinates when the stored JPEG differs in size', () => {
    expect(cropRect({ x0: 100, y0: 100, x1: 200, y1: 300 }, 540, 960, { scaleX: 0.5, scaleY: 0.5, expand: 0 })).toEqual({
      left: 50,
      top: 50,
      width: 50,
      height: 100,
    });
  });
});

describe('spine colour', () => {
  it('refineDominant averages the pixels around the dominant histogram cell', () => {
    // two pixels near the cell centre and one outlier
    const raw = Uint8Array.from([150, 130, 90, 155, 140, 94, 10, 10, 10]);
    expect(refineDominant(raw, 3, { r: 152, g: 136, b: 88 })).toEqual({ r: 152.5, g: 135, b: 92 });
    // 4 channels are stepped correctly; no pixel close → cell centre
    const rgba = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(refineDominant(rgba, 4, { r: 120, g: 120, b: 120 })).toEqual({ r: 120, g: 120, b: 120 });
  });

  it('samples the centre of the spine box, not the dark shelf around it', async () => {
    const width = 300;
    const height = 500;
    // dark shelf with a thin red spine (x 100–116, y 120–480); the model's box is a little too wide and
    // also covers the dark gap above the books
    const frame = await sharp({ create: { width, height, channels: 3, background: '#101010' } })
      .composite([{ input: { create: { width: 16, height: 360, channels: 3, background: '#b03020' } }, left: 100, top: 120 }])
      .png()
      .toBuffer();
    const bbox = { x0: 96, y0: 60, x1: 120, y1: 480 };
    const image = sharp(frame);

    // the plain dominant colour of the expanded crop is the shelf (spine ≈ 44 % of the crop)
    const expanded = cropRect(bbox, width, height)!;
    const { dominant } = await sharp(await image.clone().extract(expanded).png().toBuffer()).stats();
    expect(dominant.r).toBeLessThan(0x40);

    const sample = cropRect(bbox, width, height, { expandX: COLOR_SAMPLE_SHRINK_X, expandY: COLOR_SAMPLE_SHRINK_Y, minPx: 2 })!;
    expect(sample).toEqual({ left: 100, top: 102, width: 16, height: 336 });
    const hex = await dominantSpineColor(image, sample);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    [0xb0, 0x30, 0x20].forEach((c, i) => expect(Math.abs(rgb[i] - c)).toBeLessThanOrEqual(4));
  });
});

describe('toHex', () => {
  it('formats dominant colours', () => {
    expect(toHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010');
    expect(toHex({ r: 300, g: -4, b: 15.6 })).toBe('#ff0010');
  });
});

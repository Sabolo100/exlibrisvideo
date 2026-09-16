import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cutUpright, readingImage, READING_MAX_LENGTH, rectBoundingBox, spineRect, splitPositions, STRIP_SIDE_PAD, STRIP_VERTICAL_MARGIN } from './strips';
import type { SpineView } from './tracking';

const view = (left: number, right: number, deg = 0): SpineView => ({
  frame: 0,
  band: { y0: 600, y1: 1100 },
  left: { xc: left, deg },
  right: { xc: right, deg },
  centrality: 1,
});

describe('spineRect / rectBoundingBox', () => {
  it('covers the spine with a margin above and below the band', () => {
    const r = spineRect(view(400, 480), 1920);
    expect(r).toMatchObject({ cx: 440, cy: 850, deg: 0 });
    expect(r.width).toBe(80 + 2 * STRIP_SIDE_PAD);
    expect(r.height).toBeCloseTo(500 * (1 + 2 * STRIP_VERTICAL_MARGIN), 6);
    const box = rectBoundingBox(r, 1080, 1920);
    expect(box).toMatchObject({ x0: 440 - 46, x1: 440 + 46, y0: 850 - 390, y1: 850 + 390 });
    expect(box.rect).toMatchObject({ cx: 440, cy: 850, width: 92 });
  });

  it('cuts out one of several books along the tilted spine', () => {
    const deg = 10;
    const whole = spineRect(view(400, 700, deg), 1920);
    const first = spineRect(view(400, 700, deg), 1920, [0, 1 / 3]);
    const last = spineRect(view(400, 700, deg), 1920, [2 / 3, 1]);
    const across = 300 * Math.cos((deg * Math.PI) / 180);
    expect(first.width).toBeCloseTo(across / 3, 6);
    // the parts sit symmetrically on the across axis (cos, -sin)
    expect(first.cx + last.cx).toBeCloseTo(2 * whole.cx, 6);
    expect(first.cy + last.cy).toBeCloseTo(2 * whole.cy, 6);
    expect(first.cx).toBeLessThan(whole.cx);
    expect(first.cy).toBeGreaterThan(whole.cy);
  });

  it('clamps the bounding box to the frame', () => {
    const box = rectBoundingBox({ cx: 10, cy: 1900, width: 100, height: 400, deg: 5 }, 1080, 1920);
    expect(box.x0).toBe(0);
    expect(box.y1).toBe(1920);
  });
});

describe('cutUpright', () => {
  it('straightens a tilted spine without taking its neighbours', async () => {
    const deg = 8;
    // a red spine between two blue ones, turned clockwise → "/" lines, i.e. deg -8 in our convention
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
      <rect width="600" height="900" fill="#202020"/>
      <g transform="rotate(${deg} 300 450)">
        <rect x="170" y="150" width="100" height="600" fill="#1f4fb0"/>
        <rect x="270" y="150" width="60" height="600" fill="#d02020"/>
        <rect x="330" y="150" width="100" height="600" fill="#1f4fb0"/>
      </g>
    </svg>`;
    const frame = await sharp(Buffer.from(svg)).png().toBuffer();
    const redShare = async (tilt: number) => {
      const upright = await cutUpright(frame, { cx: 300, cy: 450, width: 56, height: 560, deg: tilt });
      const { data, info } = await sharp(upright).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let red = 0;
      for (let i = 0; i < info.width * info.height; i++) {
        if (data[i * 3] > 150 && data[i * 3 + 2] < 90) red++;
      }
      return red / (info.width * info.height);
    };
    expect(await redShare(-deg)).toBeGreaterThan(0.9);
    // the wrong direction cuts across the neighbours
    expect(await redShare(deg)).toBeLessThan(0.75);
  });
});

describe('readingImage', () => {
  it('shows a narrow spine turned both ways, thickened and not longer than the limit', async () => {
    const upright = await sharp({ create: { width: 40, height: 2000, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
    const img = await readingImage(upright);
    const meta = await sharp(img.jpeg).metadata();
    expect(meta.width).toBe(img.width);
    expect(meta.height).toBe(img.height);
    expect(img.width).toBe(READING_MAX_LENGTH);
    // two strips of the scaled thickness plus the gap
    expect(img.height).toBe(2 * Math.round(40 * (READING_MAX_LENGTH / 2000)) + 10);
  });

  it('adds the standing spine for wide spines', async () => {
    const upright = await sharp({ create: { width: 300, height: 900, channels: 3, background: '#123456' } }).jpeg().toBuffer();
    const img = await readingImage(upright);
    expect(img.height).toBe(2 * 300 + 10);
    expect(img.width).toBeGreaterThan(900 + 20);
  });
});

describe('splitPositions', () => {
  it('finds the gaps between books standing in one picture', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="800">
      <rect width="300" height="800" fill="#101010"/>
      <rect x="0" y="40" width="96" height="720" fill="#c0392b"/>
      <rect x="104" y="80" width="90" height="680" fill="#f1c40f"/>
      <rect x="202" y="20" width="98" height="740" fill="#2980b9"/>
    </svg>`;
    const upright = await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
    const cuts = await splitPositions(upright, 3);
    expect(cuts).toHaveLength(2);
    expect(cuts[0] * 300).toBeGreaterThan(90);
    expect(cuts[0] * 300).toBeLessThan(110);
    expect(cuts[1] * 300).toBeGreaterThan(190);
    expect(cuts[1] * 300).toBeLessThan(210);
    expect(await splitPositions(upright, 1)).toEqual([]);
  });

  it('does not invent gaps on a single plain spine', async () => {
    const upright = await sharp({ create: { width: 200, height: 700, channels: 3, background: '#7a5c3e' } }).jpeg().toBuffer();
    expect(await splitPositions(upright, 2)).toEqual([]);
  });
});

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeFrame, analyzeVideoGeometry, keepBand } from './geometry';

const COLORS = ['#e8e0cc', '#2f5d8a', '#c23b22', '#f2c14e', '#3c7a4a', '#dcdcdc', '#7b3f61', '#f28c28', '#1d1d1d', '#9bb7d4'];
const WIDTHS = [70, 95, 55, 110, 80, 64, 100, 58, 90, 76, 84, 68, 105, 60];

/** Deterministic pseudo random numbers (tests must not flake). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

interface Shelf {
  svg: string;
  /** x of every gap between two books, before rotation */
  gaps: number[];
}

/** A dark shelf with upright books (with fake lettering) from y 700 to 1250, turned by `deg` (clockwise). */
function shelf(offsetX: number, deg: number, width = 1080, height = 1920): Shelf {
  const random = rng(7);
  let x = -200 + offsetX;
  const parts: string[] = [];
  const gaps: number[] = [];
  WIDTHS.concat(WIDTHS).forEach((w, i) => {
    const top = 700 + Math.round(random() * 60);
    parts.push(`<rect x="${x}" y="${top}" width="${w}" height="${1250 - top}" fill="${COLORS[i % COLORS.length]}"/>`);
    // lettering: letters of different widths at different places across the spine, like printed text
    for (let k = 0; k < 9; k++) {
      const ly = top + 60 + k * 48;
      const lw = w * (0.15 + 0.3 * random());
      const lx = x + (w - lw) * (0.2 + 0.6 * random());
      parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="${14 + Math.round(random() * 18)}" fill="${i % 3 === 0 ? '#ffffff' : '#101010'}"/>`);
    }
    x += w;
    gaps.push(x + 2);
    parts.push(`<rect x="${x}" y="690" width="4" height="570" fill="#0b0704"/>`);
    x += 4;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#3a2414"/>
    <g transform="rotate(${deg} ${width / 2} ${height / 2})">
      <rect x="-400" y="660" width="${width + 800}" height="620" fill="#140b06"/>
      ${parts.join('\n')}
      <rect x="-400" y="1250" width="${width + 800}" height="40" fill="#6b4226"/>
    </g>
  </svg>`;
  return { svg, gaps };
}

const render = (s: Shelf) => sharp(Buffer.from(s.svg)).jpeg({ quality: 92 }).toBuffer();

describe('spine geometry of a frame', () => {
  it('finds the shelf band and the gaps between the books with their tilt', async () => {
    const s = shelf(0, 4);
    const { geometry } = await analyzeFrame(await render(s));
    expect(geometry.width).toBe(1080);
    expect(geometry.bands).toHaveLength(1);
    const band = geometry.bands[0];
    expect(band.y0).toBeGreaterThan(560);
    expect(band.y0).toBeLessThan(820);
    expect(band.y1).toBeGreaterThan(1150);
    expect(band.y1).toBeLessThan(1330);

    // expected gap positions after the clockwise turn around (540, 960), at the band's centre row
    const yc = (band.y0 + band.y1) / 2;
    const rad = (4 * Math.PI) / 180;
    const expected = s.gaps
      .map((gx) => {
        // the point of the vertical line x = gx that lands on row yc after turning
        const t = (yc - 960 - (gx - 540) * Math.sin(rad)) / Math.cos(rad);
        return 540 + (gx - 540) * Math.cos(rad) - t * Math.sin(rad);
      })
      .filter((x) => x > 40 && x < 1040);
    const found = band.boundaries.filter((b) => b.xc > 40 && b.xc < 1040);
    // every visible gap is found within a few px (the rotation of a line through its centre row)
    const matched = expected.filter((ex) => found.some((b) => Math.abs(b.xc - ex) < 14));
    expect(matched.length).toBeGreaterThanOrEqual(expected.length - 1);
    // a clockwise turn makes "/" lines: x shrinks downwards
    const tilts = found.map((b) => b.deg).sort((a, b) => a - b);
    expect(tilts[tilts.length >> 1]).toBeGreaterThanOrEqual(-5);
    expect(tilts[tilts.length >> 1]).toBeLessThanOrEqual(-3);
  });

  it('drops thin bands cut off by the frame edge but keeps close-ups', () => {
    expect(keepBand({ y0: 0, y1: 300 }, 1920)).toBe(false);
    expect(keepBand({ y0: 1700, y1: 1920 }, 1920)).toBe(false);
    expect(keepBand({ y0: 0, y1: 1100 }, 1920)).toBe(true);
    expect(keepBand({ y0: 700, y1: 1250 }, 1920)).toBe(true);
  });
});

describe('spine geometry of a pan', () => {
  it('tracks the camera and finds every fully visible book once, with several views', async () => {
    const frames = await Promise.all([0, -90, -180, -270, -360].map((dx) => render(shelf(dx, 0))));
    const video = await analyzeVideoGeometry(frames);
    video.motions.slice(1).forEach((m) => {
      expect(m?.reliable).toBe(true);
      expect(m!.d + (m!.s - 1) * 540).toBeGreaterThan(-100);
      expect(m!.d + (m!.s - 1) * 540).toBeLessThan(-80);
    });
    const candidates = video.candidates;
    expect(new Set(candidates.map((c) => c.chain)).size).toBe(1);
    // books fully visible in at least one frame: between x = 0 and 1080 in some frame of the pan
    expect(candidates.length).toBeGreaterThanOrEqual(14);
    expect(candidates.length).toBeLessThanOrEqual(18);
    const multiView = candidates.filter((c) => c.views.length >= 2).length;
    expect(multiView).toBeGreaterThanOrEqual(10);
    // spines follow each other left to right without overlaps in the first frame they share
    for (let i = 0; i + 1 < candidates.length; i++) {
      const a = candidates[i];
      const b = candidates[i + 1];
      const shared = a.views.find((v) => b.views.some((w) => w.frame === v.frame));
      if (!shared) continue;
      const w = b.views.find((v) => v.frame === shared.frame)!;
      expect(w.left.xc).toBeCloseTo(shared.right.xc, 0);
    }
  }, 30_000);
});

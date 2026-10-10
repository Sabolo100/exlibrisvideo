/**
 * EAN-13 barcode reader for the photo of a book's back (ISBN barcode), no extra package: grey scan lines
 * across the image, run lengths, guard patterns, digit patterns by nearest widths, parity → first digit,
 * check digit. Several lines must agree. `decodeEan13` is pure; `readEan13FromImage` adds sharp.
 */
import { isValidEan13 } from './isbn';

/** widths (in modules) of the 4 elements of each digit: L codes are space-bar-space-bar, R codes bar-space-bar-space */
const DIGIT_WIDTHS: readonly (readonly number[])[] = [
  [3, 2, 1, 1],
  [2, 2, 2, 1],
  [2, 1, 2, 2],
  [1, 4, 1, 1],
  [1, 1, 3, 2],
  [1, 2, 3, 1],
  [1, 1, 1, 4],
  [1, 3, 1, 2],
  [1, 2, 1, 3],
  [3, 1, 1, 2],
];
/** first digit from the parity of the 6 left digits (L = odd, G = even) */
const PARITY: Record<string, number> = {
  LLLLLL: 0,
  LLGLGG: 1,
  LLGGLG: 2,
  LLGGGL: 3,
  LGLLGG: 4,
  LGGLLG: 5,
  LGGGLL: 6,
  LGLGLG: 7,
  LGLGGL: 8,
  LGGLGL: 9,
};
/** runs of one symbol: guard 3 + 6×4 + middle 5 + 6×4 + guard 3 */
const SYMBOL_RUNS = 59;
const MAX_DIGIT_ERROR = 1.4;

interface Match {
  digit: number;
  /** 'L' or 'G' (left half); 'R' on the right */
  set: 'L' | 'G' | 'R';
  error: number;
}

function matchDigit(widths: readonly number[], right: boolean): Match | null {
  const total = widths[0] + widths[1] + widths[2] + widths[3];
  if (total <= 0) return null;
  const norm = widths.map((w) => (w * 7) / total);
  let best: Match | null = null;
  for (let d = 0; d < 10; d++) {
    const p = DIGIT_WIDTHS[d];
    const candidates: { set: Match['set']; pattern: readonly number[] }[] = right
      ? [{ set: 'R', pattern: p }]
      : [
          { set: 'L', pattern: p },
          { set: 'G', pattern: [p[3], p[2], p[1], p[0]] },
        ];
    for (const c of candidates) {
      let error = 0;
      for (let i = 0; i < 4; i++) error += Math.abs(norm[i] - c.pattern[i]);
      if (!best || error < best.error) best = { digit: d, set: c.set, error };
    }
  }
  return best && best.error <= MAX_DIGIT_ERROR ? best : null;
}

/** Decodes one EAN-13 from run lengths that start with a bar at `start`; null when it is not one. */
function decodeAt(runs: readonly number[], start: number): string | null {
  if (start + SYMBOL_RUNS > runs.length) return null;
  let total = 0;
  for (let i = 0; i < SYMBOL_RUNS; i++) total += runs[start + i];
  const module = total / 95;
  const near = (w: number, modules: number) => Math.abs(w - modules * module) <= Math.max(1.2, 0.7 * module);
  // start, middle and end guards are one module per element
  for (const g of [0, 1, 2, 27, 28, 29, 30, 31, 56, 57, 58]) if (!near(runs[start + g], 1)) return null;
  // a quiet zone before the start guard
  if (start > 0 && runs[start - 1] < 3 * module) return null;

  const digits: number[] = [];
  let parity = '';
  for (let k = 0; k < 6; k++) {
    const o = start + 3 + k * 4;
    const m = matchDigit([runs[o], runs[o + 1], runs[o + 2], runs[o + 3]], false);
    if (!m) return null;
    digits.push(m.digit);
    parity += m.set;
  }
  for (let k = 0; k < 6; k++) {
    const o = start + 32 + k * 4;
    const m = matchDigit([runs[o], runs[o + 1], runs[o + 2], runs[o + 3]], true);
    if (!m) return null;
    digits.push(m.digit);
  }
  const first = PARITY[parity];
  if (first === undefined) return null;
  const code = `${first}${digits.join('')}`;
  return isValidEan13(code) ? code : null;
}

/** Run lengths of one grey line (dark = bar); `firstIsBar` tells the colour of runs[0]. */
export function lineRuns(line: ArrayLike<number>): { runs: number[]; firstIsBar: boolean } {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] < lo) lo = line[i];
    if (line[i] > hi) hi = line[i];
  }
  if (hi - lo < 40) return { runs: [], firstIsBar: false };
  const threshold = (lo + hi) / 2;
  const runs: number[] = [];
  let dark = line[0] < threshold;
  const firstIsBar = dark;
  let len = 0;
  for (let i = 0; i < line.length; i++) {
    const d = line[i] < threshold;
    if (d === dark) len++;
    else {
      runs.push(len);
      dark = d;
      len = 1;
    }
  }
  runs.push(len);
  return { runs, firstIsBar };
}

/** Every EAN-13 found on one grey line (read in both directions). */
export function decodeLine(line: ArrayLike<number>): string[] {
  const found: string[] = [];
  const { runs, firstIsBar } = lineRuns(line);
  if (runs.length < SYMBOL_RUNS) return found;
  const scan = (r: readonly number[], barFirst: boolean) => {
    for (let s = barFirst ? 0 : 1; s + SYMBOL_RUNS <= r.length; s += 2) {
      const code = decodeAt(r, s);
      if (code) found.push(code);
    }
  };
  scan(runs, firstIsBar);
  const reversed = [...runs].reverse();
  const lastIsBar = runs.length % 2 === 1 ? firstIsBar : !firstIsBar;
  scan(reversed, lastIsBar);
  return found;
}

/**
 * The EAN-13 of a grey image (row-major, one byte per pixel) read along `lines` horizontal scan lines;
 * the code at least two lines agree on (or the only one found), else null.
 */
export function decodeEan13(gray: ArrayLike<number>, width: number, height: number, lines = 48): string | null {
  const votes = new Map<string, number>();
  for (let k = 0; k < lines; k++) {
    const y = Math.round(((k + 0.5) / lines) * (height - 1));
    const row = Array.prototype.slice.call(gray, y * width, (y + 1) * width) as number[];
    for (const code of new Set(decodeLine(row))) votes.set(code, (votes.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestVotes = 0;
  for (const [code, n] of votes) {
    if (n > bestVotes) {
      best = code;
      bestVotes = n;
    }
  }
  return best && (bestVotes >= 2 || votes.size === 1) ? best : null;
}

/** Reads an EAN-13 from a photo (any orientation, EXIF respected). null when none is found. */
export async function readEan13FromImage(image: Buffer): Promise<string | null> {
  const sharp = (await import('sharp')).default;
  for (const angle of [0, 90]) {
    for (const width of [1400, 900, 2000]) {
      const { data, info } = await sharp(image)
        .rotate()
        .rotate(angle)
        .greyscale()
        .resize({ width, withoutEnlargement: false })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const code = decodeEan13(data, info.width, info.height);
      if (code) return code;
    }
  }
  return null;
}

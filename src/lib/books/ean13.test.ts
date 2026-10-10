import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeEan13, readEan13FromImage } from './ean13';
import { ean13CheckDigit, toIsbn13 } from './isbn';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((code) => [...code].map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
const R = L.map((code) => [...code].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** 0/1 modules of an EAN-13 with quiet zones */
function modules(code: string): string {
  const d = [...code].map(Number);
  let bits = '0'.repeat(11) + '101';
  for (let i = 1; i <= 6; i++) bits += PARITY[d[0]][i - 1] === 'L' ? L[d[i]] : G[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101' + '0'.repeat(11);
}

/** grey image of the barcode: `scale` px per module (fractional ok), light noise */
function render(code: string, scale: number, height = 40, flip = false): { gray: Uint8Array; width: number; height: number } {
  const bits = modules(code);
  const width = Math.round(bits.length * scale);
  const gray = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    const bit = bits[Math.min(bits.length - 1, Math.floor(x / scale))];
    for (let y = 0; y < height; y++) {
      const noise = ((x * 31 + y * 17) % 23) - 11;
      gray[y * width + (flip ? width - 1 - x : x)] = Math.max(0, Math.min(255, (bit === '1' ? 30 : 225) + noise));
    }
  }
  return { gray, width, height };
}

const isbn = (first12: string) => `${first12}${ean13CheckDigit(first12)}`;

describe('EAN-13 reader', () => {
  it.each([
    ['978963079012', 3],
    ['978615500103', 2.37],
    ['979123456789', 4.6],
  ])('reads %s at %d px per module', (first12, scale) => {
    const code = isbn(first12);
    const img = render(code, scale);
    expect(decodeEan13(img.gray, img.width, img.height)).toBe(code);
  });

  it('reads an upside-down barcode', () => {
    const code = isbn('978963184321');
    const img = render(code, 3, 40, true);
    expect(decodeEan13(img.gray, img.width, img.height)).toBe(code);
  });

  it('finds nothing in an empty picture', () => {
    expect(decodeEan13(new Uint8Array(400 * 40).fill(200), 400, 40)).toBeNull();
  });

  it('reads a barcode photo through sharp (rotated, inside a larger picture)', async () => {
    const code = isbn('978963142580');
    const img = render(code, 3, 120);
    const barcode = await sharp(Buffer.from(img.gray), { raw: { width: img.width, height: img.height, channels: 1 } }).png().toBuffer();
    const photo = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#e8e4dc' } })
      .composite([{ input: barcode, left: 250, top: 300 }])
      .rotate(90)
      .jpeg({ quality: 88 })
      .toBuffer();
    expect(await readEan13FromImage(photo)).toBe(code);
  });
});

describe('ISBN', () => {
  it('validates and converts', () => {
    expect(toIsbn13('ISBN 978-963-07-9012-' + ean13CheckDigit('978963079012'))).toBe(isbn('978963079012'));
    expect(toIsbn13('963 07 9012 X')).toBeNull();
    expect(toIsbn13('0-306-40615-2')).toBe('9780306406157');
    expect(toIsbn13('9780306406158')).toBeNull();
    expect(toIsbn13('5901234123457')).toBeNull(); // a valid EAN-13 but not an ISBN
  });
});

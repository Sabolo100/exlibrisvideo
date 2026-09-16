/**
 * Magic-byte sniffing of uploaded sources (owner: api). Pure.
 *
 *   mp4 / mov / 3gp   "ftyp" at offset 4 (image brands such as HEIC/AVIF are rejected)
 *   webm / mkv        1A 45 DF A3
 *   jpeg              FF D8 FF
 *   png               89 50 4E 47
 *   webp              "RIFF" .... "WEBP"
 */
import type { SourceKind } from '@/lib/types';

export interface SniffResult {
  kind: SourceKind;
  format: 'mp4' | 'matroska' | 'jpeg' | 'png' | 'webp';
  mimeType: string;
}

/** ISO-BMFF major brands that are still images, not videos. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis']);

/** Minimum number of leading bytes `sniffMedia` needs. */
export const SNIFF_BYTES = 16;

export function sniffMedia(head: Uint8Array): SniffResult | null {
  const b = head;
  const ascii = (from: number, to: number) =>
    b.length >= to ? String.fromCharCode(...Array.from(b.subarray(from, to))) : '';

  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12).toLowerCase();
    if (IMAGE_BRANDS.has(brand)) return null;
    return { kind: 'video', format: 'mp4', mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { kind: 'video', format: 'matroska', mimeType: 'video/webm' };
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'image', format: 'jpeg', mimeType: 'image/jpeg' };
  }
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { kind: 'image', format: 'png', mimeType: 'image/png' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { kind: 'image', format: 'webp', mimeType: 'image/webp' };
  }
  return null;
}

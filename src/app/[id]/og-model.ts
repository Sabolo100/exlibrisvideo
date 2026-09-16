/**
 * Open Graph card model (owner: collection-shell): size, spine row, title sizing and the fonts for
 * next/og / satori. Server-only, no JSX – unit-tested in og-model.test.ts; the markup is og-card.tsx.
 *
 * Fonts: satori reads ttf/otf/woff (not woff2). @fontsource ships unicode-range subsets – `latin` lacks
 * the Hungarian ő ű Ő Ű, `latin-ext` lacks ASCII – so both subsets are registered under separate family
 * names and every text node lists them in order (satori falls back per character).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SPINE_PALETTE, hashString, parseHexColor } from '@/lib/book-utils';

export const OG_SIZE = { width: 1200, height: 630 } as const;

export interface OgSummary {
  title: string | null;
  ownerName: string | null;
  bookCount: number;
  authorCount: number;
  spineColors: string[];
  titles: string[];
}

type OgFontWeight = 400 | 600 | 700;
export interface OgFont {
  name: string;
  data: Buffer;
  weight: OgFontWeight;
  style: 'normal' | 'italic';
}

/** font-family lists for satori (latin first, latin-ext for ő ű …) */
export const OG_SERIF = 'ExlSerif, ExlSerifExt';
export const OG_SANS = 'ExlSans, ExlSansExt';

export const OG_COLORS = {
  paper: '#f6efe2',
  paperDeep: '#efe5d3',
  ink: '#1e1914',
  muted: '#6d6152',
  primary: '#1f4d3a',
  primaryInk: '#fbf6ec',
  accent: '#a87a2e',
  woodLight: '#9a6a42',
  wood: '#6f4527',
  woodDark: '#3f2615',
} as const;

/* ------------------------------------------------------------------ */
/* fonts                                                               */
/* ------------------------------------------------------------------ */

const FONT_FILES: { name: string; family: 'noto-serif' | 'noto-sans'; subset: 'latin' | 'latin-ext'; weight: OgFontWeight; style: 'normal' | 'italic' }[] = [
  { name: 'ExlSerif', family: 'noto-serif', subset: 'latin', weight: 700, style: 'normal' },
  { name: 'ExlSerifExt', family: 'noto-serif', subset: 'latin-ext', weight: 700, style: 'normal' },
  { name: 'ExlSerif', family: 'noto-serif', subset: 'latin', weight: 400, style: 'italic' },
  { name: 'ExlSerifExt', family: 'noto-serif', subset: 'latin-ext', weight: 400, style: 'italic' },
  { name: 'ExlSans', family: 'noto-sans', subset: 'latin', weight: 600, style: 'normal' },
  { name: 'ExlSansExt', family: 'noto-sans', subset: 'latin-ext', weight: 600, style: 'normal' },
];

function fontsourceDir(family: string): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', '@fontsource', family, 'files');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let fontsPromise: Promise<OgFont[]> | null = null;

/** Loads (once per process) the Noto woff files; resolves to [] when they are missing (satori's default font is used). */
export function loadOgFonts(): Promise<OgFont[]> {
  fontsPromise ??= (async () => {
    try {
      return await Promise.all(
        FONT_FILES.map(async (spec) => {
          const dir = fontsourceDir(spec.family);
          if (!dir) throw new Error(`@fontsource/${spec.family} not found`);
          const file = path.join(dir, `${spec.family}-${spec.subset}-${spec.weight}-${spec.style}.woff`);
          return { name: spec.name, data: await readFile(file), weight: spec.weight, style: spec.style };
        }),
      );
    } catch (err) {
      console.warn('[collection] OG fonts unavailable, using the default font', { error: err instanceof Error ? err.message : String(err) });
      fontsPromise = null;
      return [];
    }
  })();
  return fontsPromise;
}

/* ------------------------------------------------------------------ */
/* model                                                               */
/* ------------------------------------------------------------------ */

export interface OgSpine {
  color: string;
  width: number;
  height: number;
  /** gilt bands near the top and bottom */
  bands: boolean;
  /** a lighter title label block */
  label: boolean;
}

export const OG_SHELF_INNER_WIDTH = 1000;
export const OG_SPINE_GAP = 3;
const MAX_SPINES = 40;
/** a share card with a handful of spines looks unfinished: small collections get a fuller, decorative row */
const MIN_SPINES = 24;
/** widest a spine may grow when a short row is stretched to the shelf width */
const MAX_STRETCH = 1.6;

function validColor(color: string | undefined): color is string {
  return typeof color === 'string' && parseHexColor(color) !== null;
}

/** murmur3 finaliser: FNV-1a alone barely changes its bit fields between "seed:1" and "seed:2". */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 24–40 spines: the collection's own spine colours in shelf order, the rest from the deterministic palette
 * (seeded by the collection id). The row is stretched (≤ 1.6×) or shrunk to fill the shelf width.
 */
export function ogSpines(seed: string, colors: readonly string[], bookCount: number, innerWidth = OG_SHELF_INNER_WIDTH): OgSpine[] {
  const count = Math.max(MIN_SPINES, Math.min(MAX_SPINES, Math.max(0, Math.floor(bookCount))));
  const own = colors.filter(validColor);
  const spines: OgSpine[] = Array.from({ length: count }, (_, i) => {
    const h = mix32(hashString(`${seed}:${i}`));
    return {
      color: own[i] ?? SPINE_PALETTE[h % SPINE_PALETTE.length],
      width: 20 + ((h >>> 3) % 13),
      height: 112 + ((h >>> 9) % 49),
      bands: (h >>> 17) % 3 !== 0,
      label: (h >>> 21) % 4 === 0,
    };
  });
  const gaps = OG_SPINE_GAP * Math.max(0, count - 1);
  const widths = spines.reduce((sum, s) => sum + s.width, 0);
  const factor = Math.min(MAX_STRETCH, (innerWidth - gaps) / widths);
  if (factor !== 1) {
    for (const spine of spines) spine.width = Math.max(10, Math.floor(spine.width * factor));
  }
  return spines;
}

/** Title font size by length (the card has room for two lines). */
export function ogTitleSize(title: string): number {
  const len = [...title].length;
  if (len <= 18) return 76;
  if (len <= 28) return 66;
  if (len <= 42) return 56;
  if (len <= 64) return 48;
  return 42;
}

export function truncate(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}

/**
 * Embedded Noto fonts for the PDF catalogue.
 *
 * @fontsource ships every family as unicode-range subsets: `latin` has basic ASCII and
 * Western accents (á é ö ü) but NOT the Hungarian double-acute ő ű Ő Ű, which live in
 * `latin-ext` – and `latin-ext` in turn has no ASCII letters. So text is split into runs,
 * each drawn with the first subset (in a fallback chain) that really contains the glyphs.
 * Only subsets that are actually used end up embedded in the PDF.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export type FontStyle = 'serif' | 'serifBold' | 'serifItalic' | 'sans' | 'sansBold';

type Family = 'noto-serif' | 'noto-sans';

const STYLE_SPECS: Record<FontStyle, { family: Family; weight: 400 | 700; style: 'normal' | 'italic' }> = {
  serif: { family: 'noto-serif', weight: 400, style: 'normal' },
  serifBold: { family: 'noto-serif', weight: 700, style: 'normal' },
  serifItalic: { family: 'noto-serif', weight: 400, style: 'italic' },
  sans: { family: 'noto-sans', weight: 400, style: 'normal' },
  sansBold: { family: 'noto-sans', weight: 700, style: 'normal' },
};

/** Fallback chain; the first two are mandatory, the rest are loaded only when a character needs them. */
export const FONT_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'] as const;
type Subset = (typeof FONT_SUBSETS)[number];

export interface TextRun {
  /** registered pdfkit font name */
  font: string;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Font files (process-wide cache)                                     */
/* ------------------------------------------------------------------ */

const dirCache = new Map<Family, string>();
const bufferCache = new Map<string, Buffer | null>();
const rangeCache = new Map<Family, Map<string, [number, number][]>>();

/** Locates `node_modules/@fontsource/<family>` starting at the working directory and walking up. */
export function fontPackageDir(family: Family): string {
  const cached = dirCache.get(family);
  if (cached) return cached;
  const tried: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', '@fontsource', family);
    tried.push(candidate);
    if (fs.existsSync(path.join(candidate, 'files'))) {
      dirCache.set(family, candidate);
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`PDF fonts not found: @fontsource/${family} (looked in ${tried.join(', ')})`);
}

export function fontFilePath(style: FontStyle, subset: Subset): string {
  const spec = STYLE_SPECS[style];
  return path.join(fontPackageDir(spec.family), 'files', `${spec.family}-${subset}-${spec.weight}-${spec.style}.woff`);
}

/**
 * WOFF 1.0 → plain SFNT (TrueType/OpenType) using native zlib.
 * fontkit can read WOFF directly, but it re-inflates the whole `glyf` table with a pure-JS
 * inflater for every glyph it decodes, which makes subsetting seconds slower per document.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.length < 44 || woff.readUInt32BE(0) !== 0x774f4646) {
    // not WOFF – assume it is already an SFNT
    return woff;
  }
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const entries: { tag: number; checksum: number; data: Buffer }[] = [];
  for (let i = 0; i < numTables; i++) {
    const base = 44 + i * 20;
    const tag = woff.readUInt32BE(base);
    const offset = woff.readUInt32BE(base + 4);
    const compLength = woff.readUInt32BE(base + 8);
    const origLength = woff.readUInt32BE(base + 12);
    const checksum = woff.readUInt32BE(base + 16);
    if (offset + compLength > woff.length) throw new Error('Corrupt WOFF font (table out of range)');
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error('Corrupt WOFF font (bad table length)');
    entries.push({ tag, checksum, data });
  }
  entries.sort((a, b) => a.tag - b.tag);
  const pow2 = 2 ** Math.floor(Math.log2(Math.max(1, numTables)));
  const headerSize = 12 + numTables * 16;
  const total = entries.reduce((sum, e) => sum + e.data.length + ((4 - (e.data.length % 4)) % 4), headerSize);
  const out = Buffer.alloc(total);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(pow2 * 16, 6);
  out.writeUInt16BE(Math.log2(pow2), 8);
  out.writeUInt16BE(numTables * 16 - pow2 * 16, 10);
  let offset = headerSize;
  entries.forEach((e, i) => {
    const rec = 12 + i * 16;
    out.writeUInt32BE(e.tag, rec);
    out.writeUInt32BE(e.checksum, rec + 4);
    out.writeUInt32BE(offset, rec + 8);
    out.writeUInt32BE(e.data.length, rec + 12);
    e.data.copy(out, offset);
    offset += e.data.length + ((4 - (e.data.length % 4)) % 4);
  });
  return out;
}

function readFont(file: string, required: boolean): Buffer | null {
  if (bufferCache.has(file)) {
    const b = bufferCache.get(file) ?? null;
    if (!b && required) throw new Error(`PDF font file missing: ${file}`);
    return b;
  }
  let buf: Buffer | null = null;
  try {
    buf = woffToSfnt(fs.readFileSync(file));
  } catch (err) {
    if (required) throw new Error(`PDF font file unusable: ${file} (${(err as Error).message})`);
  }
  bufferCache.set(file, buf);
  return buf;
}

/** Plain SFNT bytes of a font file (cached), for pdfkit's initial font. */
export function fontBytes(style: FontStyle, subset: Subset): Buffer {
  const b = readFont(fontFilePath(style, subset), true);
  if (!b) throw new Error(`PDF font missing for ${style}/${subset}`);
  return b;
}

function parseRanges(spec: string): [number, number][] {
  return spec
    .split(',')
    .map((p) => p.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((p) => {
      const [a, b] = p.split('-');
      const start = Number.parseInt(a, 16);
      return [start, b ? Number.parseInt(b, 16) : start] as [number, number];
    });
}

/** unicode-range fallback from @fontsource/<family>/unicode.json (used only if glyph lookup is unavailable). */
function subsetRanges(family: Family, subset: Subset): [number, number][] {
  let map = rangeCache.get(family);
  if (!map) {
    map = new Map();
    try {
      const json = JSON.parse(fs.readFileSync(path.join(fontPackageDir(family), 'unicode.json'), 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(json)) map.set(k, parseRanges(v));
    } catch {
      /* no range data – coverage then falls back to "latin only" */
    }
    rangeCache.set(family, map);
  }
  return map.get(subset) ?? [];
}

/* ------------------------------------------------------------------ */
/* Per-document font set                                               */
/* ------------------------------------------------------------------ */

interface FontkitLike {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

interface LoadedSubset {
  name: string;
  covers: (cp: number) => boolean;
}

/** Characters that must never be drawn (format controls, variation selectors). */
const INVISIBLE = /[\p{Cc}\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export class PdfFonts {
  private readonly loaded = new Map<string, LoadedSubset | null>();
  private readonly coverage = new Map<string, number>();

  constructor(private readonly doc: PDFKit.PDFDocument) {
    // fail fast if the mandatory files are missing
    for (const style of Object.keys(STYLE_SPECS) as FontStyle[]) {
      readFont(fontFilePath(style, 'latin'), true);
      readFont(fontFilePath(style, 'latin-ext'), true);
    }
  }

  private subset(style: FontStyle, idx: number): LoadedSubset | null {
    const key = `${style}:${idx}`;
    if (this.loaded.has(key)) return this.loaded.get(key) ?? null;
    const subset = FONT_SUBSETS[idx];
    const buf = readFont(fontFilePath(style, subset), idx < 2);
    if (!buf) {
      this.loaded.set(key, null);
      return null;
    }
    const name = `exl-${style}-${subset}`;
    this.doc.registerFont(name, buf);
    // Select it once so pdfkit parses it; glyph coverage is read from the underlying fontkit font.
    // (Drawing code always selects its font explicitly, so changing the current font is harmless.)
    this.doc.font(name);
    const fk = (this.doc as unknown as { _font?: { font?: Partial<FontkitLike> } })._font?.font;
    let covers: (cp: number) => boolean;
    if (fk && typeof fk.hasGlyphForCodePoint === 'function') {
      const f = fk as FontkitLike;
      covers = (cp) => f.hasGlyphForCodePoint(cp);
    } else {
      const ranges = subsetRanges(STYLE_SPECS[style].family, subset);
      covers = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
    }
    const loaded = { name, covers };
    this.loaded.set(key, loaded);
    return loaded;
  }

  /** Index of the first subset in the chain containing the code point, or -1. */
  private coveringIndex(style: FontStyle, cp: number): number {
    const key = `${style}:${cp}`;
    const hit = this.coverage.get(key);
    if (hit !== undefined) return hit;
    let found = -1;
    for (let i = 0; i < FONT_SUBSETS.length; i++) {
      const s = this.subset(style, i);
      if (s && s.covers(cp)) {
        found = i;
        break;
      }
    }
    this.coverage.set(key, found);
    return found;
  }

  /** Registered font name of the primary (latin) subset of a style. */
  primary(style: FontStyle): string {
    const s = this.subset(style, 0);
    if (!s) throw new Error(`PDF font missing for style ${style}`);
    return s.name;
  }

  /**
   * Splits text into runs that can each be drawn with a single embedded subset.
   * Characters no subset covers become "?" (letters/digits) or are dropped (symbols, emoji).
   */
  runs(text: string, style: FontStyle): TextRun[] {
    const out: TextRun[] = [];
    const normalized = text.normalize('NFC');
    let curIdx = -1;
    let buf = '';
    const flush = () => {
      if (buf && curIdx >= 0) {
        const s = this.subset(style, curIdx);
        if (s) out.push({ font: s.name, text: buf });
      }
      buf = '';
    };
    for (const rawCh of normalized) {
      let ch = rawCh;
      if (ch === '\n' || ch === '\r' || ch === '\t') ch = ' ';
      else if (INVISIBLE.test(ch)) continue;
      const cp = ch.codePointAt(0) ?? 0x3f;
      let idx: number;
      const cur = curIdx >= 0 ? this.subset(style, curIdx) : null;
      if (cur && cur.covers(cp)) {
        idx = curIdx;
      } else {
        idx = this.coveringIndex(style, cp);
        if (idx < 0) {
          if (!LETTER_OR_DIGIT.test(ch)) continue;
          ch = '?';
          idx = curIdx >= 0 ? curIdx : 0;
          const s = this.subset(style, idx);
          if (!s || !s.covers(0x3f)) idx = 0;
        }
      }
      if (idx !== curIdx) {
        flush();
        curIdx = idx;
      }
      buf += ch;
    }
    flush();
    return out;
  }
}

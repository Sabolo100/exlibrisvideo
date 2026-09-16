import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { buildExport } from './index';
import { PdfFonts, fontBytes, woffToSfnt } from './pdf-fonts';
import { Typesetter } from './pdf-text';
import { makeSampleCollection } from './testing/sample-collection';

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

/** All FlateDecode streams of a pdfkit document, inflated. */
function inflatedStreams(pdf: Buffer): string[] {
  const src = pdf.toString('latin1');
  const out: string[] = [];
  const re = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('\nendstream', start);
    if (end < 0) break;
    const raw = Buffer.from(src.slice(start, end), 'latin1');
    try {
      out.push(zlib.inflateSync(raw).toString('latin1'));
    } catch {
      out.push(raw.toString('latin1'));
    }
    re.lastIndex = end + 1;
  }
  return out;
}

describe('PDF fonts', () => {
  it('converts WOFF to a plain SFNT', () => {
    const ttf = fontBytes('serif', 'latin-ext');
    expect(ttf.readUInt32BE(0)).toBe(0x00010000);
    expect(woffToSfnt(ttf)).toBe(ttf);
  });

  it('switches font subsets per run so ő/ű/Ő/Ű get real glyphs', () => {
    const doc = new PDFDocument({ autoFirstPage: false, font: null as unknown as string });
    const fonts = new PdfFonts(doc);
    expect(fonts.runs('Tőzsér Árpád', 'serif')).toEqual([
      { font: 'exl-serif-latin', text: 'T' },
      { font: 'exl-serif-latin-ext', text: 'ő' },
      { font: 'exl-serif-latin', text: 'zsér Árpád' },
    ]);
    expect(fonts.runs('ŐSZ ŰR', 'sansBold').map((r) => r.font)).toEqual([
      'exl-sansBold-latin-ext',
      'exl-sansBold-latin',
      'exl-sansBold-latin-ext',
      'exl-sansBold-latin',
    ]);
    // combining sequences are normalised to the precomposed letter
    expect(fonts.runs('Erdo\u030B', 'serifItalic').map((r) => r.text)).toEqual(['Erd', 'ő']);
    expect(fonts.runs('Война и мир', 'serif')[0].font).toBe('exl-serif-cyrillic');
    expect(fonts.runs('\u{1F4DA} Könyv\u200B', 'serif').map((r) => r.text).join('')).toBe(' Könyv');
    expect(fonts.runs('日本', 'serif').map((r) => r.text).join('')).toBe('??');
  });

  it('wraps mixed-subset text without breaking words apart', () => {
    const doc = new PDFDocument({ autoFirstPage: false, font: null as unknown as string });
    const ts = new Typesetter(doc, new PdfFonts(doc));
    const lines = ts.layout(
      [{ text: 'Lázár Ervin: A Négyszögletű Kerek Erdő és a Tőzsér-féle őszi ütőkártyák', style: 'serif', size: 12, color: '#000' }],
      120,
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(120.01);
    const words = lines.map((l) => l.pieces.map((p) => p.text).join('').trim());
    expect(words.join(' ')).toBe('Lázár Ervin: A Négyszögletű Kerek Erdő és a Tőzsér-féle őszi ütőkártyák');
    const truncated = ts.layout([{ text: 'Nagyon hosszú cím, ami nem fér ki két sorba sehogyan sem, ő ű', style: 'serif', size: 12, color: '#000' }], 90, {
      maxLines: 2,
    });
    expect(truncated).toHaveLength(2);
    expect(truncated[1].pieces.map((p) => p.text).join('').endsWith('…')).toBe(true);
  });
});

describe('PDF export', () => {
  it('renders an empty collection as a single cover page', async () => {
    const file = await buildExport(makeSampleCollection({ bookCount: 0 }), 'pdf', 'hu');
    expect(file.filename).toBe('exlibris-334345435.pdf');
    expect(file.contentType).toBe('application/pdf');
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(file.body.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(pageCount(file.body)).toBe(1);
  });

  it('renders one book: cover, catalogue and topic index', async () => {
    const file = await buildExport(makeSampleCollection({ bookCount: 1 }), 'pdf', 'en');
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(file.body)).toBe(3);
  });

  it('renders 300 books over multiple pages with real double-acute glyphs', async () => {
    const c = makeSampleCollection({ bookCount: 300 });
    const file = await buildExport(c, 'pdf', 'hu', { isOwner: true });
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pages = pageCount(file.body);
    expect(pages).toBeGreaterThan(5);

    const streams = inflatedStreams(file.body);
    const cmaps = streams.filter((s) => s.includes('begincmap'));
    const unicode = cmaps.join('\n').toLowerCase();
    for (const cp of ['0151', '0171', '0150', '0170']) expect(unicode).toContain(`<${cp}>`);

    // no .notdef (glyph 0) shown anywhere: every TJ hex string is a run of 4-digit glyph ids
    const content = streams.filter((s) => / TJ/.test(s)).join('\n');
    const hexRuns = [...content.matchAll(/\[([^\]]*)\]\s*TJ/g)].flatMap((m) => [...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]));
    expect(hexRuns.length).toBeGreaterThan(300);
    for (const hex of hexRuns) {
      for (let i = 0; i < hex.length; i += 4) expect(hex.slice(i, i + 4)).not.toBe('0000');
    }

    // document metadata: UTF-16BE title with the double acute intact
    const raw = file.body.toString('latin1');
    expect(raw).toMatch(/\/Title \d+ 0 R/);
    expect(raw).toContain(Buffer.from(c.title ?? '', 'utf16le').swap16().toString('latin1'));
  });
});

/**
 * Printable A4 PDF catalogue (pdfkit, embedded Noto Serif / Noto Sans):
 *   1. cover – title, vector ex-libris bookplate, counts, date, link
 *   2. books grouped by the family-name initial of the author (two columns)
 *   3. topic index with page references
 * Footer "x / y" on every page but the cover. Scales to thousands of books.
 */
import PDFDocument from 'pdfkit';
import { topicLabel } from '@/lib/taxonomy';
import type { BookDTO } from '@/lib/types';
import { PdfFonts } from './pdf-fonts';
import { Typesetter, type Line, type Span } from './pdf-text';
import {
  NO_AUTHOR_GROUP,
  absoluteUrl,
  authorGroupOf,
  distinctAuthorCount,
  distinctTopicCount,
  longDate,
  primaryAuthor,
  type ExportContext,
} from './shared';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_X = 54;
const M_TOP = 56;
const M_BOTTOM = 66;
const COL_GAP = 26;
const COL_W = (PAGE_W - 2 * M_X - COL_GAP) / 2;
const CONTENT_BOTTOM = PAGE_H - M_BOTTOM;

const C = {
  green: '#1f4d3a',
  gold: '#a87a2e',
  ink: '#1d1a16',
  muted: '#6b645a',
  faint: '#9a9184',
  cream: '#fbf6ec',
  rule: '#d9cdb6',
};

const SIZE = {
  letter: 19,
  author: 10,
  title: 9.6,
  meta: 7.4,
  indexTopic: 10.5,
  indexEntry: 8,
};

const LH = 1.28;
const BOOK_INDENT = 9;

/* ------------------------------------------------------------------ */
/* Column flow                                                         */
/* ------------------------------------------------------------------ */

class Flow {
  col = 0;
  y = M_TOP;
  colTop = M_TOP;

  constructor(private readonly doc: PDFKit.PDFDocument) {}

  get x(): number {
    return M_X + this.col * (COL_W + COL_GAP);
  }

  /** 1-based physical page number of the current page */
  get page(): number {
    return this.doc.bufferedPageRange().count;
  }

  newPage(): void {
    this.doc.addPage({ size: 'A4', margin: 0 });
    this.col = 0;
    this.y = M_TOP;
    this.colTop = M_TOP;
  }

  /** Starts the two-column area at the current y (below a page heading). */
  startColumns(): void {
    this.col = 0;
    this.colTop = this.y;
  }

  fits(h: number): boolean {
    return this.y + h <= CONTENT_BOTTOM;
  }

  /** Moves to the next column/page when `h` does not fit. Returns true when a break happened. */
  ensure(h: number): boolean {
    if (this.fits(h)) return false;
    if (this.y <= this.colTop + 0.5) return false; // already at the top of a column – draw anyway
    this.nextColumn();
    return true;
  }

  nextColumn(): void {
    if (this.col === 0) {
      this.col = 1;
      this.y = this.colTop;
    } else {
      this.newPage();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

function hRule(doc: PDFKit.PDFDocument, x1: number, x2: number, y: number, color: string, width = 0.6): void {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}

function diamond(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number, color: string): void {
  doc.save().moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath().fillColor(color).fill().restore();
}

/** Decorative divider: ——— ◆ ——— */
function divider(doc: PDFKit.PDFDocument, cx: number, y: number, halfWidth: number): void {
  hRule(doc, cx - halfWidth, cx - 8, y, C.gold, 0.7);
  hRule(doc, cx + 8, cx + halfWidth, y, C.gold, 0.7);
  diamond(doc, cx, y, 3.2, C.gold);
}

/** Vector ex-libris bookplate: gold rings, green disc, laurel, open book, "EX LIBRIS". */
function drawBookplate(doc: PDFKit.PDFDocument, fonts: PdfFonts, label: string, cx: number, cy: number, R: number): void {
  doc.save();
  doc.lineWidth(1.8).strokeColor(C.gold).circle(cx, cy, R).stroke();
  doc.lineWidth(0.6).strokeColor(C.gold).circle(cx, cy, R - 5).stroke();
  doc.fillColor(C.green).circle(cx, cy, R - 9).fill();
  doc.lineWidth(0.5).strokeColor(C.gold).circle(cx, cy, R - 14).stroke();

  // laurel branches along the lower half
  const lr = R - 25;
  for (const side of [-1, 1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const deg = 90 + side * (18 + i * 14);
      const th = (deg * Math.PI) / 180;
      const px = cx + lr * Math.cos(th);
      const py = cy + lr * Math.sin(th);
      pts.push([px, py]);
      const leafSize = 6.2 - i * 0.35;
      for (const offset of [-1, 1]) {
        const tangent = deg + side * 90;
        const angle = tangent + offset * 38 * side;
        const ar = (angle * Math.PI) / 180;
        const lx = px + Math.cos(ar) * leafSize * 0.55 * (offset === 1 ? 1 : 0.2);
        const ly = py + Math.sin(ar) * leafSize * 0.55 * (offset === 1 ? 1 : 0.2);
        doc.save();
        doc.rotate(angle, { origin: [lx, ly] });
        doc.ellipse(lx, ly, leafSize * 0.62, leafSize * 0.24).fillColor(C.gold).fill();
        doc.restore();
      }
    }
    doc.save().lineWidth(0.8).strokeColor(C.gold);
    doc.moveTo(pts[0][0], pts[0][1]);
    for (const [px, py] of pts.slice(1)) doc.lineTo(px, py);
    doc.stroke().restore();
  }

  // open book
  const by = cy + R * 0.02;
  const bw = R * 0.42;
  const bh = R * 0.26;
  for (const side of [-1, 1]) {
    const s = side;
    doc
      .moveTo(cx, by + bh * 0.5)
      .bezierCurveTo(cx + s * bw * 0.3, by + bh * 0.28, cx + s * bw * 0.72, by + bh * 0.34, cx + s * bw, by + bh * 0.55)
      .lineTo(cx + s * bw, by - bh * 0.5)
      .bezierCurveTo(cx + s * bw * 0.72, by - bh * 0.72, cx + s * bw * 0.3, by - bh * 0.66, cx, by - bh * 0.42)
      .closePath()
      .fillColor(C.cream)
      .fill();
    doc.lineWidth(0.55).strokeColor(C.green);
    for (let k = 1; k <= 4; k++) {
      const yy = by - bh * 0.42 + k * bh * 0.18;
      doc
        .moveTo(cx + s * bw * 0.14, yy + bh * 0.02)
        .bezierCurveTo(cx + s * bw * 0.38, yy - bh * 0.1, cx + s * bw * 0.64, yy - bh * 0.08, cx + s * bw * 0.86, yy + bh * 0.02)
        .stroke();
    }
  }
  doc.lineWidth(0.9).strokeColor(C.gold).moveTo(cx, by - bh * 0.42).lineTo(cx, by + bh * 0.5).stroke();

  // "EX LIBRIS"
  const size = R * 0.15;
  const spacing = size * 0.28;
  const runs = fonts.runs(label, 'serifBold');
  let w = 0;
  for (const r of runs) {
    doc.font(r.font).fontSize(size);
    w += doc.widthOfString(r.text, { characterSpacing: spacing }) + spacing;
  }
  w -= spacing;
  let x = cx - w / 2;
  const baseline = cy - R * 0.38;
  for (const r of runs) {
    doc.font(r.font).fontSize(size).fillColor(C.cream);
    doc.text(r.text, x, baseline, { lineBreak: false, baseline: 'alphabetic', characterSpacing: spacing });
    x += doc.widthOfString(r.text, { characterSpacing: spacing }) + spacing;
  }
  diamond(doc, cx - w / 2 - 8, baseline - size * 0.33, 1.8, C.gold);
  diamond(doc, cx + w / 2 + 8, baseline - size * 0.33, 1.8, C.gold);
  diamond(doc, cx, cy + R * 0.42, 2.6, C.gold);
  doc.restore();
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function drawCover(doc: PDFKit.PDFDocument, ts: Typesetter, fonts: PdfFonts, ctx: ExportContext): void {
  const { collection: c, books, tr } = ctx;
  doc.addPage({ size: 'A4', margin: 0 });
  doc.save().rect(0, 0, PAGE_W, PAGE_H).fillColor(C.cream).fill().restore();
  doc.save().lineWidth(1.4).strokeColor(C.green).rect(28, 28, PAGE_W - 56, PAGE_H - 56).stroke().restore();
  doc.save().lineWidth(0.5).strokeColor(C.gold).rect(35, 35, PAGE_W - 70, PAGE_H - 70).stroke().restore();
  for (const [x, y] of [
    [35, 35],
    [PAGE_W - 35, 35],
    [35, PAGE_H - 35],
    [PAGE_W - 35, PAGE_H - 35],
  ] as const) {
    diamond(doc, x, y, 4, C.gold);
  }

  const cx = PAGE_W / 2;
  drawBookplate(doc, fonts, tr.t('exporting.pdf.exLibris'), cx, 232, 86);

  const textW = PAGE_W - 170;
  let y = 352;
  const titleLines = ts.layout([{ text: ctx.title, style: 'serifBold', size: 28, color: C.green }], textW, { maxLines: 3 });
  y = ts.drawLines(titleLines, M_X + (PAGE_W - 2 * M_X - textW) / 2, y, { lineHeight: 1.18, align: 'center', width: textW });
  y += 6;
  const sub = ts.layout([{ text: tr.t('exporting.pdf.subtitle'), style: 'serifItalic', size: 14, color: C.gold }], textW, { maxLines: 1 });
  y = ts.drawLines(sub, M_X + (PAGE_W - 2 * M_X - textW) / 2, y, { align: 'center', width: textW });
  const owner = c.ownerName?.trim();
  if (owner && c.title?.trim()) {
    const ol = ts.layout([{ text: owner, style: 'sans', size: 11, color: C.muted }], textW, { maxLines: 1 });
    y = ts.drawLines(ol, M_X + (PAGE_W - 2 * M_X - textW) / 2, y + 2, { align: 'center', width: textW });
  }
  y += 16;
  divider(doc, cx, y, 70);
  y += 18;

  const counts = [
    tr.tp('exporting.pdf.books', books.length),
    tr.tp('exporting.pdf.authors', distinctAuthorCount(books)),
    tr.tp('exporting.pdf.topics', distinctTopicCount(books)),
  ].join('  ·  ');
  const cl = ts.layout([{ text: counts, style: 'sans', size: 11.5, color: C.ink }], textW, { maxLines: 2 });
  y = ts.drawLines(cl, M_X + (PAGE_W - 2 * M_X - textW) / 2, y, { align: 'center', width: textW });

  const description = c.description?.trim();
  if (description) {
    const dl = ts.layout([{ text: description, style: 'serifItalic', size: 10.5, color: C.muted }], textW - 40, { maxLines: 5 });
    y = ts.drawLines(dl, M_X + (PAGE_W - 2 * M_X - (textW - 40)) / 2, y + 12, { lineHeight: 1.4, align: 'center', width: textW - 40 });
  }
  if (books.length === 0) {
    const el = ts.layout([{ text: tr.t('exporting.pdf.empty'), style: 'serifItalic', size: 11, color: C.muted }], textW - 40, {
      maxLines: 4,
    });
    ts.drawLines(el, M_X + (PAGE_W - 2 * M_X - (textW - 40)) / 2, y + 22, { lineHeight: 1.4, align: 'center', width: textW - 40 });
  }

  // bottom block
  let by = PAGE_H - 168;
  const compiled = ts.layout([{ text: tr.t('exporting.pdf.compiled', { date: longDate(ctx.now, ctx.locale) }), style: 'sans', size: 9.5, color: C.muted }], textW, {
    maxLines: 1,
  });
  by = ts.drawLines(compiled, M_X + (PAGE_W - 2 * M_X - textW) / 2, by, { align: 'center', width: textW });
  by += 10;
  const url = absoluteUrl(c.publicUrl, ctx.origin) ?? c.publicUrl;
  const online = ts.layout([{ text: tr.t('exporting.pdf.online'), style: 'sans', size: 9, color: C.muted }], textW, { maxLines: 1 });
  by = ts.drawLines(online, M_X + (PAGE_W - 2 * M_X - textW) / 2, by, { align: 'center', width: textW });
  const link = /^https?:\/\//.test(url) ? url : undefined;
  const ul = ts.layout([{ text: url.replace(/^https?:\/\//, ''), style: 'sansBold', size: 12, color: C.green, link }], textW, { maxLines: 1 });
  by = ts.drawLines(ul, M_X + (PAGE_W - 2 * M_X - textW) / 2, by + 2, { align: 'center', width: textW });

  const credit = ts.singleLine([{ text: tr.t('exporting.pdf.madeWith'), style: 'sans', size: 7.5, color: C.gold }], textW);
  ts.drawLine(credit, M_X + (PAGE_W - 2 * M_X - textW) / 2, PAGE_H - 50, 'center', textW);
}

interface CatalogueResult {
  /** book id → physical page number */
  pageOf: Map<string, number>;
}

function bookSpans(book: BookDTO, ctx: ExportContext): { title: Span[]; meta: Span[] } {
  const title: Span[] = [{ text: book.title, style: 'serifItalic', size: SIZE.title, color: C.ink }];
  if (book.subtitle?.trim()) {
    title.push({ text: ` – ${book.subtitle.trim()}`, style: 'serifItalic', size: SIZE.title, color: C.muted });
  }
  const parts: string[] = [];
  const year = book.firstPublishedYear ?? book.editionYear;
  if (year) parts.push(String(year));
  if (book.publisher?.trim()) parts.push(book.publisher.trim());
  if (book.category) parts.push(topicLabel(book.category, ctx.locale));
  const meta: Span[] = parts.length ? [{ text: parts.join(' · '), style: 'sans', size: SIZE.meta, color: C.muted }] : [];
  return { title, meta };
}

function drawCatalogue(doc: PDFKit.PDFDocument, ts: Typesetter, ctx: ExportContext): CatalogueResult {
  const pageOf = new Map<string, number>();
  const flow = new Flow(doc);
  flow.newPage();

  const heading = ts.layout([{ text: ctx.t('exporting.pdf.catalogueHeading'), style: 'serifBold', size: 20, color: C.green }], PAGE_W - 2 * M_X, {
    maxLines: 2,
  });
  flow.y = ts.drawLines(heading, M_X, flow.y, { lineHeight: 1.2 });
  hRule(doc, M_X, PAGE_W - M_X, flow.y + 4, C.gold, 0.8);
  flow.y += 18;
  flow.startColumns();

  const textW = COL_W - BOOK_INDENT;
  let currentGroup: string | null = null;
  let currentAuthor: string | null = null;
  let authorLines: Line[] = [];

  const authorLineHeight = (lines: Line[]) => Typesetter.heightOf(lines, LH) + 1.5;

  for (const book of ctx.books) {
    const group = authorGroupOf(book, ctx.locale);
    const author = book.author?.trim() || null;
    const { title, meta } = bookSpans(book, ctx);
    const titleLines = ts.layout(title, textW, { maxLines: 4 });
    const metaLines = meta.length ? ts.layout(meta, textW, { maxLines: 2 }) : [];
    const bookH = Typesetter.heightOf(titleLines, LH) + Typesetter.heightOf(metaLines, 1.3) + 4;

    const groupChanged = group.key !== currentGroup;
    const authorChanged = groupChanged || author !== currentAuthor;
    if (authorChanged) {
      authorLines =
        author && group.key !== NO_AUTHOR_GROUP
          ? ts.layout([{ text: author, style: 'serifBold', size: SIZE.author, color: C.ink }], COL_W, { maxLines: 3 })
          : [];
    }

    if (groupChanged) {
      const label = group.key === NO_AUTHOR_GROUP ? ctx.t('exporting.pdf.noAuthorHeading') : group.key;
      const size = group.key === NO_AUTHOR_GROUP ? 13 : SIZE.letter;
      const letterH = size * 1.05 + 7;
      flow.ensure(letterH + authorLineHeight(authorLines) + bookH);
      if (flow.y > flow.colTop + 0.5) flow.y += 6;
      const ll = ts.singleLine([{ text: label, style: 'serifBold', size, color: C.green }], COL_W);
      const baseline = flow.y + size * 0.95;
      const endX = ts.drawLine(ll, flow.x, baseline);
      hRule(doc, endX + 7, flow.x + COL_W, baseline - size * 0.28, C.gold, 0.6);
      flow.y += letterH;
      currentGroup = group.key;
    }

    if (authorChanged) {
      currentAuthor = author;
      if (authorLines.length) {
        flow.ensure(authorLineHeight(authorLines) + bookH);
        flow.y = ts.drawLines(authorLines, flow.x, flow.y, { lineHeight: LH }) + 1.5;
      }
    } else if (flow.ensure(bookH) && authorLines.length) {
      // column/page break inside an author's list – repeat the author
      const cont = ts.singleLine(
        [
          { text: author ?? '', style: 'serifBold', size: SIZE.author, color: C.ink },
          { text: ` ${ctx.t('exporting.pdf.continued')}`, style: 'sans', size: SIZE.meta, color: C.faint },
        ],
        COL_W,
      );
      flow.y = ts.drawLines([cont], flow.x, flow.y, { lineHeight: LH }) + 1.5;
    }

    if (!flow.fits(bookH)) flow.ensure(bookH);
    pageOf.set(book.id, flow.page);
    let y = ts.drawLines(titleLines, flow.x + BOOK_INDENT, flow.y, { lineHeight: LH });
    if (metaLines.length) y = ts.drawLines(metaLines, flow.x + BOOK_INDENT, y, { lineHeight: 1.3 });
    flow.y = y + 4;
  }
  return { pageOf };
}

function drawTopicIndex(doc: PDFKit.PDFDocument, ts: Typesetter, ctx: ExportContext, pageOf: Map<string, number>): void {
  const uncategorised = ctx.t('exporting.value.uncategorised');
  const groups = new Map<string | null, BookDTO[]>();
  for (const b of ctx.books) {
    const key = b.category || null;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()]
    .map(([key, books]) => ({ key, label: key ? topicLabel(key, ctx.locale) : uncategorised, books }))
    .sort((a, b) => {
      if ((a.key === null) !== (b.key === null)) return a.key === null ? 1 : -1;
      return ctx.collator.compare(a.label, b.label);
    });

  const flow = new Flow(doc);
  flow.newPage();
  const heading = ts.layout([{ text: ctx.t('exporting.pdf.topicIndex'), style: 'serifBold', size: 20, color: C.green }], PAGE_W - 2 * M_X, {
    maxLines: 1,
  });
  flow.y = ts.drawLines(heading, M_X, flow.y, { lineHeight: 1.2 });
  const hint = ts.layout([{ text: ctx.t('exporting.pdf.topicIndexHint'), style: 'sans', size: 8.5, color: C.muted }], PAGE_W - 2 * M_X, {
    maxLines: 2,
  });
  flow.y = ts.drawLines(hint, M_X, flow.y + 1);
  hRule(doc, M_X, PAGE_W - M_X, flow.y + 4, C.gold, 0.8);
  flow.y += 16;
  flow.startColumns();

  const entryH = SIZE.indexEntry * 1.42;
  const numW = 24;
  for (const group of ordered) {
    const headerSpans: Span[] = [
      { text: group.label, style: 'serifBold', size: SIZE.indexTopic, color: C.green },
      { text: `  ${ctx.tr.n(group.books.length)}`, style: 'sans', size: 7.5, color: C.faint },
    ];
    const header = ts.singleLine(headerSpans, COL_W);
    const headerH = SIZE.indexTopic * 1.5 + 3;
    flow.ensure(headerH + entryH);
    if (flow.y > flow.colTop + 0.5) flow.y += 5;
    ts.drawLine(header, flow.x, flow.y + SIZE.indexTopic * 1.05);
    hRule(doc, flow.x, flow.x + COL_W, flow.y + SIZE.indexTopic * 1.38, C.rule, 0.5);
    flow.y += headerH;

    for (const book of group.books) {
      if (flow.ensure(entryH)) {
        const cont = ts.singleLine(
          [
            { text: group.label, style: 'serifBold', size: SIZE.indexEntry + 0.5, color: C.green },
            { text: ` ${ctx.t('exporting.pdf.continued')}`, style: 'sans', size: 7, color: C.faint },
          ],
          COL_W,
        );
        ts.drawLine(cont, flow.x, flow.y + SIZE.indexEntry * 1.1);
        flow.y += entryH + 1;
      }
      const author = primaryAuthor(book);
      const spans: Span[] = [];
      if (author) {
        spans.push({ text: author, style: 'serif', size: SIZE.indexEntry, color: C.ink });
        spans.push({ text: ' – ', style: 'serif', size: SIZE.indexEntry, color: C.faint });
      }
      spans.push({ text: book.title, style: 'serifItalic', size: SIZE.indexEntry, color: C.ink });
      const line = ts.singleLine(spans, COL_W - numW - 6);
      const baseline = flow.y + SIZE.indexEntry * 1.05;
      const endX = ts.drawLine(line, flow.x, baseline);
      const page = pageOf.get(book.id);
      const num = ts.singleLine([{ text: page ? String(page) : '–', style: 'sans', size: SIZE.indexEntry, color: C.muted }], numW);
      const numX = flow.x + COL_W - num.width;
      ts.drawLine(num, numX, baseline);
      if (numX - endX > 10) {
        doc
          .save()
          .moveTo(endX + 3, baseline - 1)
          .lineTo(numX - 3, baseline - 1)
          .lineWidth(0.6)
          .dash(0.6, { space: 2.2 })
          .strokeColor(C.rule)
          .stroke()
          .undash()
          .restore();
      }
      flow.y += entryH;
    }
  }
}

function drawFooters(doc: PDFKit.PDFDocument, ts: Typesetter, ctx: ExportContext): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const footerText = ctx.t('exporting.pdf.footer', { title: ctx.title });
  for (let i = range.start; i < range.start + range.count; i++) {
    if (i === range.start) continue; // cover
    doc.switchToPage(i);
    const y = PAGE_H - 44;
    hRule(doc, M_X, PAGE_W - M_X, y, C.rule, 0.5);
    const pageLabel = ts.singleLine(
      [{ text: ctx.t('exporting.pdf.pageOf', { page: i + 1, total }), style: 'sans', size: 8, color: C.muted }],
      80,
    );
    ts.drawLine(pageLabel, PAGE_W - M_X - pageLabel.width, y + 14);
    const left = ts.singleLine([{ text: footerText, style: 'sans', size: 7.5, color: C.faint }], PAGE_W - 2 * M_X - pageLabel.width - 24);
    ts.drawLine(left, M_X, y + 14);
  }
}

export async function buildPdf(ctx: ExportContext): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    pdfVersion: '1.7',
    lang: ctx.locale === 'hu' ? 'hu-HU' : 'en-GB',
    displayTitle: true,
    // No initial font: skips loading pdfkit's Helvetica AFM data, and an initial font with the same
    // bytes as a registered one would defeat pdfkit's font cache (it re-parses the font on every
    // doc.font() call when two cache entries share a PostScript name and checksum).
    font: null as unknown as string,
    info: {
      Title: ctx.title,
      Author: ctx.collection.ownerName?.trim() || 'Ex Libris Video',
      Subject: ctx.tr.tp('exporting.pdf.docSubject', ctx.books.length),
      Keywords: 'Ex Libris Video, catalogue, books',
      Creator: 'Ex Libris Video',
      Producer: 'Ex Libris Video (PDFKit)',
      CreationDate: ctx.now,
      ModDate: ctx.now,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  try {
    const fonts = new PdfFonts(doc);
    const ts = new Typesetter(doc, fonts);
    drawCover(doc, ts, fonts, ctx);
    if (ctx.books.length > 0) {
      const { pageOf } = drawCatalogue(doc, ts, ctx);
      drawTopicIndex(doc, ts, ctx, pageOf);
    }
    drawFooters(doc, ts, ctx);
    doc.end();
  } catch (err) {
    doc.end();
    await done.catch(() => undefined);
    throw err;
  }
  return done;
}

/**
 * Excel export (exceljs): localized Books / Authors / Topics / Summary sheets with
 * a frozen, filterable, branded header row, zebra rows, hyperlinks and number formats.
 */
import ExcelJS from 'exceljs';
import type { BookDTO } from '@/lib/types';
import {
  absoluteUrl,
  authorStats,
  clampText,
  distinctAuthorCount,
  distinctTopicCount,
  languageName,
  primaryTopicLabel,
  ratingStars,
  readingStatusLabel,
  secondaryTopicLabels,
  sourceLabel,
  topicStats,
  utcDateOf,
  yesNo,
  type ExportContext,
} from './shared';

const GREEN = 'FF1F4D3A';
const CREAM = 'FFFBF6EC';
const GOLD = 'FFA87A2E';
const ZEBRA = 'FFF6EFE2';
const RULE = 'FFE3D8C3';
const MUTED = 'FF6B645A';
const AMBER = 'FFB45309';

const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
const zebraFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
const headerFont: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: CREAM } };
const bodyFont: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, color: { argb: 'FF1D1A16' } };
const linkFont: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, color: { argb: GREEN }, underline: true };
const rowBorder: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: RULE } } };

type ColKind = 'text' | 'int' | 'year' | 'percent' | 'date' | 'link' | 'stars' | 'flag' | 'wrap';

interface ColumnDef {
  header: string;
  width: number;
  kind: ColKind;
  value: (book: BookDTO, index: number) => ExcelJS.CellValue;
}

function dateFormat(ctx: ExportContext): string {
  return ctx.locale === 'hu' ? 'yyyy.mm.dd.' : 'd mmm yyyy';
}

function link(url: string | null): ExcelJS.CellValue {
  if (!url) return null;
  // Excel refuses hyperlinks longer than 2 079 characters
  if (url.length > 2000) return url;
  return { text: url, hyperlink: url, tooltip: url };
}

function text(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? clampText(v) : null;
}

function bookColumns(ctx: ExportContext): ColumnDef[] {
  const { t, locale, isOwner, origin } = ctx;
  const cols: (ColumnDef | false)[] = [
    { header: t('exporting.col.index'), width: 6, kind: 'int', value: (_b, i) => i + 1 },
    { header: t('exporting.col.author'), width: 28, kind: 'text', value: (b) => text(b.author) },
    { header: t('exporting.col.title'), width: 42, kind: 'text', value: (b) => text(b.title) },
    { header: t('exporting.col.subtitle'), width: 28, kind: 'text', value: (b) => text(b.subtitle) },
    { header: t('exporting.col.originalTitle'), width: 28, kind: 'text', value: (b) => text(b.originalTitle) },
    { header: t('exporting.col.series'), width: 22, kind: 'text', value: (b) => text(b.series) },
    { header: t('exporting.col.publisher'), width: 22, kind: 'text', value: (b) => text(b.publisher) },
    { header: t('exporting.col.firstPublished'), width: 12, kind: 'year', value: (b) => b.firstPublishedYear },
    { header: t('exporting.col.editionYear'), width: 12, kind: 'year', value: (b) => b.editionYear },
    { header: t('exporting.col.language'), width: 14, kind: 'text', value: (b) => languageName(b.language, locale) || null },
    { header: t('exporting.col.topic'), width: 24, kind: 'text', value: (b) => primaryTopicLabel(b, locale) || null },
    {
      header: t('exporting.col.otherTopics'),
      width: 30,
      kind: 'text',
      value: (b) => secondaryTopicLabels(b, locale).join(', ') || null,
    },
    {
      header: t('exporting.col.readingStatus'),
      width: 18,
      kind: 'text',
      value: (b) => (b.readingStatus === 'unknown' ? null : readingStatusLabel(b.readingStatus, locale)),
    },
    { header: t('exporting.col.rating'), width: 12, kind: 'stars', value: (b) => ratingStars(b.rating) || null },
    { header: t('exporting.col.favorite'), width: 10, kind: 'flag', value: (b) => (b.favorite ? yesNo(true, locale) : null) },
    isOwner && { header: t('exporting.col.notes'), width: 40, kind: 'wrap', value: (b) => text(b.notes) },
    isOwner && { header: t('exporting.col.lentTo'), width: 20, kind: 'text', value: (b) => text(b.lentTo) },
    isOwner && { header: t('exporting.col.lentAt'), width: 16, kind: 'date', value: (b) => utcDateOf(b.lentAt) },
    { header: t('exporting.col.isbn'), width: 17, kind: 'text', value: (b) => text(b.isbn) },
    { header: t('exporting.col.pages'), width: 10, kind: 'int', value: (b) => b.pageCount },
    {
      header: t('exporting.col.coverUrl'),
      width: 34,
      kind: 'link',
      value: (b) => link(absoluteUrl(b.coverImage, origin)),
    },
    {
      header: t('exporting.col.confidence'),
      width: 14,
      kind: 'percent',
      value: (b) => Math.max(0, Math.min(1, b.confidence ?? 0)),
    },
    {
      header: t('exporting.col.needsReview'),
      width: 14,
      kind: 'flag',
      value: (b) => yesNo(b.needsReview, locale),
    },
    { header: t('exporting.col.source'), width: 16, kind: 'text', value: (b) => sourceLabel(b.source, locale) },
    { header: t('exporting.col.added'), width: 14, kind: 'date', value: (b) => utcDateOf(b.createdAt) },
  ];
  return cols.filter((c): c is ColumnDef => Boolean(c));
}

function styleHeaderRow(row: ExcelJS.Row, columnCount: number): void {
  row.height = 30;
  for (let c = 1; c <= columnCount; c++) {
    const cell = row.getCell(c);
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: GOLD } } };
  }
}

function applyBodyStyle(cell: ExcelJS.Cell, kind: ColKind, zebra: boolean, dateFmt: string): void {
  if (zebra) cell.fill = zebraFill;
  cell.border = rowBorder;
  cell.font = bodyFont;
  cell.alignment = { vertical: 'top', wrapText: kind === 'wrap' };
  switch (kind) {
    case 'int':
      cell.numFmt = '#,##0';
      cell.alignment = { vertical: 'top', horizontal: 'right' };
      break;
    case 'year':
      cell.numFmt = '0';
      cell.alignment = { vertical: 'top', horizontal: 'center' };
      break;
    case 'percent':
      cell.numFmt = '0%';
      cell.alignment = { vertical: 'top', horizontal: 'right' };
      break;
    case 'date':
      cell.numFmt = dateFmt;
      cell.alignment = { vertical: 'top', horizontal: 'left' };
      break;
    case 'link':
      if (cell.value && typeof cell.value === 'object') cell.font = linkFont;
      break;
    case 'stars':
      cell.font = { ...bodyFont, color: { argb: GOLD } };
      break;
    case 'flag':
      cell.alignment = { vertical: 'top', horizontal: 'center' };
      break;
    default:
      break;
  }
}

function finishTable(ws: ExcelJS.Worksheet, columnCount: number, xSplit = 0): void {
  ws.views = [{ state: 'frozen', xSplit, ySplit: 1, topLeftCell: undefined, activeCell: 'A2', showGridLines: true }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, columnCount) } };
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
  };
}

function addBooksSheet(wb: ExcelJS.Workbook, ctx: ExportContext): void {
  const ws = wb.addWorksheet(ctx.t('exporting.sheet.books'), { properties: { tabColor: { argb: GREEN } } });
  const cols = bookColumns(ctx);
  ws.columns = cols.map((c) => ({ width: c.width }));
  const header = ws.getRow(1);
  header.values = cols.map((c) => c.header);
  styleHeaderRow(header, cols.length);
  const needsReviewCol = cols.findIndex((c) => c.header === ctx.t('exporting.col.needsReview')) + 1;
  const yes = yesNo(true, ctx.locale);
  const dateFmt = dateFormat(ctx);

  ctx.books.forEach((book, i) => {
    const row = ws.getRow(i + 2);
    const zebra = i % 2 === 1;
    cols.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      const v = col.value(book, i);
      cell.value = v === undefined ? null : v;
      applyBodyStyle(cell, col.kind, zebra, dateFmt);
    });
    if (needsReviewCol > 0 && row.getCell(needsReviewCol).value === yes) {
      row.getCell(needsReviewCol).font = { ...bodyFont, bold: true, color: { argb: AMBER } };
    }
  });
  finishTable(ws, cols.length, 3);
}

function addAuthorsSheet(wb: ExcelJS.Workbook, ctx: ExportContext): void {
  const ws = wb.addWorksheet(ctx.t('exporting.sheet.authors'));
  ws.columns = [{ width: 36 }, { width: 14 }, { width: 110 }];
  const header = ws.getRow(1);
  header.values = [ctx.t('exporting.col.author'), ctx.t('exporting.col.bookCount'), ctx.t('exporting.col.titles')];
  styleHeaderRow(header, 3);
  const stats = authorStats(ctx.books, ctx.collator);
  const dateFmt = dateFormat(ctx);
  stats.forEach((s, i) => {
    const row = ws.getRow(i + 2);
    const zebra = i % 2 === 1;
    const values: [ExcelJS.CellValue, ColKind][] = [
      [clampText(s.name), 'text'],
      [s.count, 'int'],
      [clampText(s.titles.join('; ')), 'text'],
    ];
    values.forEach(([v, kind], ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      applyBodyStyle(cell, kind, zebra, dateFmt);
    });
  });
  finishTable(ws, 3, 1);
}

function addTopicsSheet(wb: ExcelJS.Workbook, ctx: ExportContext): void {
  const ws = wb.addWorksheet(ctx.t('exporting.sheet.topics'));
  ws.columns = [{ width: 32 }, { width: 14 }, { width: 12 }, { width: 20 }];
  const header = ws.getRow(1);
  header.values = [
    ctx.t('exporting.col.topic'),
    ctx.t('exporting.col.bookCount'),
    ctx.t('exporting.col.share'),
    ctx.t('exporting.col.secondaryCount'),
  ];
  styleHeaderRow(header, 4);
  const stats = topicStats(ctx.books, ctx.locale, ctx.collator);
  const dateFmt = dateFormat(ctx);
  stats.forEach((s, i) => {
    const row = ws.getRow(i + 2);
    const zebra = i % 2 === 1;
    const values: [ExcelJS.CellValue, ColKind][] = [
      [s.label, 'text'],
      [s.count, 'int'],
      [s.share, 'percent'],
      [s.secondary, 'int'],
    ];
    values.forEach(([v, kind], ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      applyBodyStyle(cell, kind, zebra, dateFmt);
    });
    row.getCell(3).numFmt = '0.0%';
  });
  const totalRow = ws.getRow(stats.length + 2);
  totalRow.values = [ctx.t('exporting.value.total'), ctx.books.length, ctx.books.length ? 1 : 0, null];
  for (let c = 1; c <= 4; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { ...bodyFont, bold: true };
    cell.border = { top: { style: 'thin', color: { argb: GREEN } } };
  }
  totalRow.getCell(2).numFmt = '#,##0';
  totalRow.getCell(3).numFmt = '0.0%';
  finishTable(ws, 4, 1);
  // the total row must not take part in filtering/sorting
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, stats.length + 1), column: 4 } };
}

function addSummarySheet(wb: ExcelJS.Workbook, ctx: ExportContext): void {
  const { t, collection: c, books, locale } = ctx;
  const ws = wb.addWorksheet(t('exporting.sheet.summary'), { properties: { tabColor: { argb: GOLD } } });
  ws.columns = [{ width: 40 }, { width: 48 }, { width: 14 }];
  ws.views = [{ showGridLines: false }];
  const labelFont: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: MUTED } };
  const dateFmt = dateFormat(ctx);
  let r = 1;

  ws.mergeCells(r, 1, r, 3);
  const h = ws.getCell(r, 1);
  h.value = t('exporting.summary.heading');
  h.font = { name: 'Georgia', size: 18, bold: true, color: { argb: GREEN } };
  ws.getRow(r).height = 30;
  r++;
  ws.mergeCells(r, 1, r, 3);
  const st = ws.getCell(r, 1);
  st.value = ctx.title;
  st.font = { name: 'Georgia', size: 14, italic: true, color: { argb: GOLD } };
  ws.getRow(r).height = 22;
  r += 2;

  const kv = (label: string, value: ExcelJS.CellValue, opts: { numFmt?: string; font?: Partial<ExcelJS.Font>; wrap?: boolean } = {}) => {
    const lc = ws.getCell(r, 1);
    lc.value = label;
    lc.font = labelFont;
    lc.alignment = { vertical: 'top' };
    ws.mergeCells(r, 2, r, 3);
    const vc = ws.getCell(r, 2);
    vc.value = value;
    vc.font = opts.font ?? bodyFont;
    vc.alignment = { vertical: 'top', horizontal: 'left', wrapText: opts.wrap ?? false };
    if (opts.numFmt) vc.numFmt = opts.numFmt;
    r++;
  };
  const section = (labels: string[]) => {
    const row = ws.getRow(r);
    row.values = labels;
    styleHeaderRow(row, 3);
    row.height = 22;
    r++;
  };

  kv(t('exporting.summary.catalogue'), ctx.title);
  if (c.ownerName?.trim()) kv(t('exporting.summary.owner'), c.ownerName.trim());
  if (c.description?.trim()) {
    kv(t('exporting.summary.description'), clampText(c.description.trim()), { wrap: true });
    const lines = Math.min(10, Math.ceil(c.description.trim().length / 55));
    ws.getRow(r - 1).height = Math.max(15, lines * 15);
  }
  const url = absoluteUrl(c.publicUrl, ctx.origin);
  kv(t('exporting.summary.link'), url ? { text: url, hyperlink: url, tooltip: url } : c.publicUrl, { font: url ? linkFont : bodyFont });
  kv(t('exporting.summary.created'), utcDateOf(c.createdAt), { numFmt: dateFmt });
  kv(t('exporting.summary.exported'), utcDateOf(ctx.now), { numFmt: dateFmt });
  r++;

  section([t('exporting.summary.totals'), '', '']);
  const intFmt = '#,##0';
  kv(t('exporting.summary.books'), books.length, { numFmt: intFmt });
  kv(t('exporting.summary.authors'), distinctAuthorCount(books), { numFmt: intFmt });
  kv(t('exporting.summary.topics'), distinctTopicCount(books), { numFmt: intFmt });
  kv(t('exporting.summary.read'), books.filter((b) => b.readingStatus === 'read').length, { numFmt: intFmt });
  kv(t('exporting.summary.favorites'), books.filter((b) => b.favorite).length, { numFmt: intFmt });
  kv(t('exporting.summary.needsReview'), books.filter((b) => b.needsReview).length, { numFmt: intFmt });
  if (ctx.isOwner) kv(t('exporting.summary.lentOut'), books.filter((b) => Boolean(b.lentTo?.trim())).length, { numFmt: intFmt });
  kv(
    t('exporting.summary.pages'),
    books.reduce((sum, b) => sum + (b.pageCount && b.pageCount > 0 ? b.pageCount : 0), 0),
    { numFmt: intFmt },
  );
  r++;

  const authors = authorStats(books, ctx.collator).slice(0, 10);
  if (authors.length) {
    section([t('exporting.summary.topAuthors'), t('exporting.col.bookCount'), '']);
    authors.forEach((a, i) => {
      const row = ws.getRow(r);
      row.getCell(1).value = a.name;
      row.getCell(2).value = a.count;
      [1, 2, 3].forEach((ci) => applyBodyStyle(row.getCell(ci), ci === 2 ? 'int' : 'text', i % 2 === 1, dateFmt));
      row.getCell(2).alignment = { horizontal: 'left' };
      r++;
    });
    r++;
  }

  const topics = topicStats(books, locale, ctx.collator)
    .filter((s) => s.count > 0)
    .slice(0, 10);
  if (topics.length) {
    section([t('exporting.summary.topTopics'), t('exporting.col.bookCount'), t('exporting.col.share')]);
    topics.forEach((s, i) => {
      const row = ws.getRow(r);
      row.getCell(1).value = s.label;
      row.getCell(2).value = s.count;
      row.getCell(3).value = s.share;
      applyBodyStyle(row.getCell(1), 'text', i % 2 === 1, dateFmt);
      applyBodyStyle(row.getCell(2), 'int', i % 2 === 1, dateFmt);
      applyBodyStyle(row.getCell(3), 'percent', i % 2 === 1, dateFmt);
      row.getCell(2).alignment = { horizontal: 'left' };
      row.getCell(3).numFmt = '0.0%';
      r++;
    });
    r++;
  }

  ws.mergeCells(r, 1, r, 3);
  const note = ws.getCell(r, 1);
  note.value = t('exporting.summary.madeWith');
  note.font = { name: 'Georgia', size: 11, italic: true, color: { argb: MUTED } };
  r++;
  if (ctx.origin) {
    ws.mergeCells(r, 1, r, 3);
    const home = ws.getCell(r, 1);
    home.value = { text: ctx.origin.replace(/^https?:\/\//, ''), hyperlink: ctx.origin };
    home.font = linkFont;
  }
  ws.pageSetup = { ...ws.pageSetup, paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function buildXlsx(ctx: ExportContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ex Libris Video';
  wb.lastModifiedBy = 'Ex Libris Video';
  wb.company = 'Ex Libris Video';
  wb.created = ctx.now;
  wb.modified = ctx.now;
  wb.title = ctx.title;
  wb.subject = ctx.t('exporting.pdf.subtitle');
  wb.keywords = 'Ex Libris Video';
  wb.description = ctx.collection.publicUrl;

  addBooksSheet(wb, ctx);
  addAuthorsSheet(wb, ctx);
  addTopicsSheet(wb, ctx);
  addSummarySheet(wb, ctx);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

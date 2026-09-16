/**
 * CSV export: UTF-8 with BOM (so Excel detects the encoding), ";" for Hungarian (Excel's
 * list separator there), "," for English, RFC 4180 quoting, CRLF line endings and a
 * spreadsheet formula-injection guard.
 */
import type { Locale } from '@/lib/types';
import {
  isoDate,
  languageName,
  primaryTopicLabel,
  readingStatusLabel,
  secondaryTopicLabels,
  sourceLabel,
  yesNo,
  type ExportContext,
} from './shared';

export type CsvValue = string | number | null | undefined;

const UTF8_BOM = '\uFEFF';

export function csvDelimiter(locale: Locale): ';' | ',' {
  return locale === 'hu' ? ';' : ',';
}

/**
 * Cells starting with = + - @ TAB or CR are interpreted as formulas by spreadsheet apps
 * (CSV injection). Prefix them with an apostrophe so they are shown as text.
 */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One CSV field: guarded, quoted when it contains the delimiter, a quote, CR or LF (quotes doubled). */
export function escapeCsvField(value: CsvValue, delimiter: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  const s = guardFormula(String(value));
  const needsQuotes = s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r');
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvValue[][], opts: { delimiter: string; bom?: boolean }): Buffer {
  const lines = rows.map((row) => row.map((v) => escapeCsvField(v, opts.delimiter)).join(opts.delimiter));
  const text = (opts.bom === false ? '' : UTF8_BOM) + lines.join('\r\n') + (lines.length ? '\r\n' : '');
  return Buffer.from(text, 'utf8');
}

/** Core catalogue columns; owner-only columns (notes, lent to, lent on) only for owners. */
export function csvRows(ctx: ExportContext): CsvValue[][] {
  const { t, locale, isOwner } = ctx;
  const header: CsvValue[] = [
    t('exporting.col.author'),
    t('exporting.col.title'),
    t('exporting.col.subtitle'),
    t('exporting.col.originalTitle'),
    t('exporting.col.series'),
    t('exporting.col.publisher'),
    t('exporting.col.firstPublished'),
    t('exporting.col.editionYear'),
    t('exporting.col.language'),
    t('exporting.col.topic'),
    t('exporting.col.otherTopics'),
    t('exporting.col.readingStatus'),
    t('exporting.col.rating'),
    t('exporting.col.favorite'),
    ...(isOwner ? [t('exporting.col.notes'), t('exporting.col.lentTo'), t('exporting.col.lentAt')] : []),
    t('exporting.col.isbn'),
    t('exporting.col.pages'),
    t('exporting.col.confidence'),
    t('exporting.col.needsReview'),
    t('exporting.col.source'),
    t('exporting.col.added'),
  ];
  const rows: CsvValue[][] = [header];
  for (const b of ctx.books) {
    rows.push([
      b.author,
      b.title,
      b.subtitle,
      b.originalTitle,
      b.series,
      b.publisher,
      b.firstPublishedYear,
      b.editionYear,
      languageName(b.language, locale),
      primaryTopicLabel(b, locale),
      secondaryTopicLabels(b, locale).join(', '),
      b.readingStatus === 'unknown' ? '' : readingStatusLabel(b.readingStatus, locale),
      b.rating != null && b.rating > 0 ? b.rating : null,
      b.favorite ? yesNo(true, locale) : '',
      ...(isOwner ? [b.notes, b.lentTo, isoDate(b.lentAt)] : []),
      b.isbn,
      b.pageCount,
      Math.round((b.confidence ?? 0) * 100),
      yesNo(b.needsReview, locale),
      sourceLabel(b.source, locale),
      isoDate(b.createdAt),
    ]);
  }
  return rows;
}

export function buildCsv(ctx: ExportContext): Buffer {
  return toCsv(csvRows(ctx), { delimiter: csvDelimiter(ctx.locale), bom: true });
}

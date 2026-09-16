/**
 * Export entry point (owner: export-email). Builds a downloadable file of a collection in
 * one of the EXPORT_FORMATS. Used by GET /api/collections/:id/export and the e-mail job.
 */
import type { CollectionWithBooksDTO, ExportFormat, Locale } from '@/lib/types';
import { buildCsv } from './csv';
import { buildGoodreadsCsv } from './goodreads';
import { buildJson } from './json';
import { buildPdf } from './pdf';
import { EXPORT_CONTENT_TYPES, createExportContext, exportFilename, type ExportOptions } from './shared';
import { buildXlsx } from './xlsx';

export { EXPORT_CONTENT_TYPES, exportFilename, type ExportOptions } from './shared';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * @param opts.isOwner include owner-only columns (notes, lent to, lent on); defaults to `collection.isOwner`.
 *                     The DTO already has those fields nulled for non-owners.
 */
export async function buildExport(
  collection: CollectionWithBooksDTO,
  format: ExportFormat,
  locale: Locale,
  opts?: ExportOptions,
): Promise<ExportFile> {
  const ctx = createExportContext(collection, locale === 'en' ? 'en' : 'hu', opts);
  let body: Buffer;
  switch (format) {
    case 'xlsx':
      body = await buildXlsx(ctx);
      break;
    case 'csv':
      body = buildCsv(ctx);
      break;
    case 'goodreads':
      body = buildGoodreadsCsv(ctx);
      break;
    case 'json':
      body = buildJson(ctx);
      break;
    case 'pdf':
      body = await buildPdf(ctx);
      break;
    default: {
      const never: never = format;
      throw new Error(`Unsupported export format: ${String(never)}`);
    }
  }
  return { filename: exportFilename(collection.id, format), contentType: EXPORT_CONTENT_TYPES[format], body };
}

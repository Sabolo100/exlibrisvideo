import { localeFromRequest } from '@/i18n/server';
import { enforceRateLimit, requireCollection, requireViewer } from '@/lib/collections/guards';
import { buildCollectionWithBooks } from '@/lib/collections/queries';
import { exportFormatSchema } from '@/lib/collections/validation';
import { buildExport } from '@/lib/export';
import { contentDisposition, getClientIp, HttpError, withErrorHandling } from '@/lib/http';
import type { ExportFormat } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const EXTENSION: Record<ExportFormat, string> = {
  xlsx: 'xlsx',
  csv: 'csv',
  json: 'json',
  pdf: 'pdf',
  goodreads: 'csv',
};

/** GET /api/collections/:id/export?format=xlsx|csv|json|pdf|goodreads&lang=hu|en – file download. */
export const GET = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const parsedFormat = exportFormatSchema.safeParse(url.searchParams.get('format') ?? 'xlsx');
  if (!parsedFormat.success) {
    throw new HttpError(400, 'invalid', { issues: [{ path: 'format', code: 'invalid_value', message: 'Unknown export format' }] });
  }
  const format = parsedFormat.data;

  const collection = await requireCollection(id);
  const viewer = requireViewer(req, collection);
  await enforceRateLimit(`export:ip:${getClientIp(req)}`, 60, 10 * 60);

  const locale = localeFromRequest(req);
  const data = await buildCollectionWithBooks(collection, viewer.isOwner);
  const file = await buildExport(data, format, locale);

  const defaultName = `exlibris-${collection.id}.${EXTENSION[format]}`;
  const filename = file.filename && file.filename.trim() !== '' ? file.filename : defaultName;
  const body = new Uint8Array(file.body.buffer, file.body.byteOffset, file.body.byteLength).slice();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType || 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      'Content-Disposition': contentDisposition(filename, 'attachment'),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

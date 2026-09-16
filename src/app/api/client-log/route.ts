import { z } from 'zod';
import { enforceRateLimit } from '@/lib/collections/guards';
import { getClientIp, noContent, parseJson, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reportSchema = z.object({
  kind: z.literal('upload_failed'),
  code: z.string().max(40),
  detail: z.string().max(300).optional(),
  videoId: z.string().uuid().optional(),
  mimeType: z.string().max(100),
  extension: z.string().max(10),
  sizeBytes: z.number().int().nonnegative(),
  bytesSent: z.number().int().nonnegative(),
  lastModifiedKnown: z.boolean(),
});

/**
 * POST /api/client-log – why an upload failed on a visitor's device (no file names, no personal data).
 * Only logged: real phones cannot be debugged otherwise. Rate: 30 / hour per IP.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const report = await parseJson(req, reportSchema, 4 * 1024);
  await enforceRateLimit(`client-log:ip:${getClientIp(req)}`, 30, 3600);
  console.warn('[client] upload failed', { ...report, userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null });
  return noContent();
});

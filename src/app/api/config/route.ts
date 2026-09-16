/**
 * GET /api/config – the public upload limits for the browser (owner: frontend-landing):
 * `{ maxUploadMb, maxSourcesPerCollection, maxVideoSeconds }` from MAX_UPLOAD_MB, MAX_SOURCES_PER_COLLECTION and
 * MAX_VIDEO_SECONDS. Nothing else is exposed. Browsers and proxies may cache the answer for 5 minutes.
 */
import { serverUploadLimits } from '@/components/upload/server-limits';
import { json, withErrorHandling } from '@/lib/http';

export const runtime = 'nodejs';
// read at request time: the environment of a deployed container is not known at build time
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async () => json(serverUploadLimits(), { headers: { 'Cache-Control': 'public, max-age=300' } }));

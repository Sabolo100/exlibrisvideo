/**
 * Server only (Server Components, GET /api/config): the upload limits from the environment.
 * Never import this from a client component – @/lib/env reads process.env and node modules.
 */
import { env } from '@/lib/env';
import type { UploadLimits } from './limits';

export function serverUploadLimits(): UploadLimits {
  const e = env();
  return { maxUploadMb: e.MAX_UPLOAD_MB, maxSourcesPerCollection: e.MAX_SOURCES_PER_COLLECTION, maxVideoSeconds: e.MAX_VIDEO_SECONDS };
}

/**
 * Non-owner view counting (owner: api). Server-only, no Next.js dependencies.
 *
 * A view is counted at most once per VIEW_WINDOW_SEC per viewer. The API additionally sets the
 * `exl_seen_<id>` cookie; the collection page (Server Component, cannot set cookies) and the API share a
 * database throttle keyed by a hashed (IP, User-Agent) fingerprint, so one visitor opening the page and
 * then polling the API is counted once.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { collections } from '@/db/schema';
import { checkRateLimit } from '@/lib/rate-limit';
import { clientIpFromHeaders } from '@/lib/security/cookies';
import { sha256Hex } from '@/lib/security/tokens';

/** a viewer is counted at most once per this many seconds (matches the exl_seen_<id> cookie lifetime) */
export const VIEW_WINDOW_SEC = 30 * 60;

/** Stable, non-reversible viewer key from request headers (hashed IP + User-Agent). */
export function viewerFingerprint(headers: Pick<Headers, 'get'>): string {
  const ua = (headers.get('user-agent') ?? '').slice(0, 512);
  return sha256Hex(`${clientIpFromHeaders(headers)}|${ua}`).slice(0, 32);
}

/** Increments `view_count` and `last_viewed_at` unconditionally. */
export async function recordCollectionView(collectionId: string): Promise<void> {
  await db()
    .update(collections)
    .set({ viewCount: sql`${collections.viewCount} + 1`, lastViewedAt: new Date() })
    .where(eq(collections.id, collectionId));
}

/**
 * Counts one view unless this fingerprint was already counted for the collection within VIEW_WINDOW_SEC.
 * Never throws (view counting must not break reading a collection). Returns true when a view was counted.
 */
export async function countCollectionView(collectionId: string, fingerprint: string): Promise<boolean> {
  try {
    const gate = await checkRateLimit(`view:${collectionId}:${fingerprint}`, 1, VIEW_WINDOW_SEC);
    if (!gate.allowed) return false;
    await recordCollectionView(collectionId);
    return true;
  } catch (err) {
    console.warn('[api] view count failed', { collectionId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

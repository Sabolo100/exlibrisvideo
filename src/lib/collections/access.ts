/**
 * Ownership / PIN access (SPEC §2 cookies). Server-only (owner: api).
 *
 * Owner: valid `exl_own_<id>` cookie (HMAC of the stored owner-token hash) or
 *        `Authorization: Bearer <ownerToken>`.
 * Viewer: owner, or visibility 'link', or a valid `exl_pin_<id>` cookie (HMAC of the current PIN hash –
 *         changing the PIN invalidates every PIN cookie).
 */
import type { CollectionRow } from '@/db/schema';
import { publicCollectionUrl } from '@/lib/env';
import { parseCookieHeader, serializeCookie } from '@/lib/security/cookies';
import {
  ownerCookieValue,
  pinCookieValue,
  signRecovery,
  timingSafeEqualStr,
  verifyOwnerToken,
} from '@/lib/security/tokens';

export interface Viewer {
  isOwner: boolean;
  /** owner, or visibility 'link', or a valid PIN cookie */
  canView: boolean;
}

export const ownerCookieName = (collectionId: string) => `exl_own_${collectionId}`;
export const pinCookieName = (collectionId: string) => `exl_pin_${collectionId}`;
export const seenCookieName = (collectionId: string) => `exl_seen_${collectionId}`;

/** 400 days (the maximum browsers honour). */
export const OWNER_COOKIE_MAX_AGE = 400 * 24 * 3600;
export const PIN_COOKIE_MAX_AGE = 180 * 24 * 3600;
/** a non-owner view is counted at most once per this many seconds per browser */
export const SEEN_COOKIE_MAX_AGE = 30 * 60;

/** Pure access resolution shared by the page and route-handler variants. */
export function resolveViewer(
  collection: Pick<CollectionRow, 'id' | 'ownerTokenHash' | 'visibility' | 'pinHash'>,
  getCookie: (name: string) => string | undefined,
  authorization: string | null | undefined,
): Viewer {
  let isOwner = false;

  const ownCookie = getCookie(ownerCookieName(collection.id));
  if (ownCookie && timingSafeEqualStr(ownCookie, ownerCookieValue(collection.id, collection.ownerTokenHash))) {
    isOwner = true;
  }

  if (!isOwner && authorization) {
    const m = /^Bearer\s+([A-Za-z0-9_\-]{16,256})\s*$/i.exec(authorization);
    if (m && verifyOwnerToken(m[1], collection.ownerTokenHash)) isOwner = true;
  }

  if (isOwner) return { isOwner: true, canView: true };
  if (collection.visibility !== 'pin') return { isOwner: false, canView: true };

  // PIN-protected: a PIN collection without a stored hash cannot be unlocked by anyone but the owner.
  if (!collection.pinHash) return { isOwner: false, canView: false };
  const pinCookie = getCookie(pinCookieName(collection.id));
  const canView = !!pinCookie && timingSafeEqualStr(pinCookie, pinCookieValue(collection.id, collection.pinHash));
  return { isOwner: false, canView };
}

/** For Server Components (reads cookies via next/headers). */
export async function getViewerForPage(collection: CollectionRow): Promise<Viewer> {
  // Dynamic import keeps next/headers out of the worker / scripts that import this module.
  const { cookies, headers } = await import('next/headers');
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolveViewer(collection, (name) => cookieStore.get(name)?.value, headerStore.get('authorization'));
}

/** For Route Handlers (cookie header or `Authorization: Bearer <ownerToken>`). */
export function getViewerFromRequest(req: Request, collection: CollectionRow): Viewer {
  const jar = parseCookieHeader(req.headers.get('cookie'));
  return resolveViewer(collection, (name) => jar.get(name), req.headers.get('authorization'));
}

/** `/<id>?r=<exp>.<sig>` valid for `hours` (default 24). Absolute URL. */
export function buildRecoveryUrl(collection: CollectionRow, hours?: number): string {
  const h = hours !== undefined && Number.isFinite(hours) && hours > 0 ? hours : 24;
  const exp = Math.floor(Date.now() / 1000) + Math.round(h * 3600);
  return `${publicCollectionUrl(collection.id)}?r=${signRecovery(collection.id, collection.ownerTokenHash, exp)}`;
}

/** `Set-Cookie` value granting ownership of `collection` to this browser. */
export function ownerSetCookie(req: Request, collection: Pick<CollectionRow, 'id' | 'ownerTokenHash'>): string {
  return serializeCookie(req, ownerCookieName(collection.id), ownerCookieValue(collection.id, collection.ownerTokenHash), {
    maxAge: OWNER_COOKIE_MAX_AGE,
  });
}

/** `Set-Cookie` value unlocking a PIN collection (bound to the current PIN hash). */
export function pinSetCookie(req: Request, collection: Pick<CollectionRow, 'id'>, pinHash: string): string {
  return serializeCookie(req, pinCookieName(collection.id), pinCookieValue(collection.id, pinHash), {
    maxAge: PIN_COOKIE_MAX_AGE,
  });
}

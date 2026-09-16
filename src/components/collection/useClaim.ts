'use client';

/**
 * Owner-link handling shared by the catalogue and the PIN gate:
 * - `/<id>?k=<token>` and `/<id>?r=<exp>.<sig>` → POST /claim → owner cookie → router.refresh().
 *   The parameters are stripped from the address bar immediately (the token must not linger in
 *   history or get copied along with the URL), a token is remembered in localStorage on success.
 * - A token remembered on this device re-claims silently when the owner cookie is missing
 *   (cookie cleared / expired), at most once per browser session.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import { getOwnerToken, rememberCollection } from '@/lib/client/my-collections';
import { apiErrorMessage, isNetworkError } from './errors';
import { hrefWithSearch, withoutParams } from './url-state';

export const CLAIM_PARAMS = ['k', 'r'] as const;

type ClaimBody = { token: string } | { recovery: string };

/** in-flight claims per collection+credential (React StrictMode runs effects twice) */
const inflight = new Map<string, Promise<void>>();

function stripClaimParams() {
  const current = new URLSearchParams(window.location.search);
  if (!CLAIM_PARAMS.some((p) => current.has(p))) return;
  const href = hrefWithSearch(window.location.pathname, withoutParams(current, CLAIM_PARAMS)) + window.location.hash;
  try {
    window.history.replaceState(null, '', href);
  } catch {
    /* ignore */
  }
}

function sessionFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setSessionFlag(key: string) {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    /* storage unavailable */
  }
}

export interface ClaimInfo {
  title: string | null;
  bookCount?: number;
  createdAt?: string;
  /** already the owner (skip the silent re-claim) */
  isOwner: boolean;
}

export function useClaimFromUrl(collectionId: string, info: ClaimInfo): { claiming: boolean } {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [claiming, setClaiming] = useState(false);
  const infoRef = useRef(info);
  infoRef.current = info;

  const claim = useCallback(
    (body: ClaimBody, opts: { silent: boolean }): Promise<void> => {
      const credential = 'token' in body ? `k:${body.token}` : `r:${body.recovery}`;
      const key = `${collectionId}:${credential}`;
      const existing = inflight.get(key);
      if (existing) return existing;

      const run = (async () => {
        if (!opts.silent) setClaiming(true);
        try {
          await api.claim(collectionId, body);
          const current = infoRef.current;
          rememberCollection({
            id: collectionId,
            token: 'token' in body ? body.token : null,
            title: current.title,
            bookCount: current.bookCount,
            createdAt: current.createdAt,
          });
          if (!opts.silent) toast({ id: `claim-${collectionId}`, title: t('collection.claim.success'), tone: 'success' });
          router.refresh();
        } catch (err) {
          if (opts.silent) return;
          toast({
            id: `claim-${collectionId}`,
            title: t('collection.claim.failed'),
            description: apiErrorMessage(err, t),
            tone: 'error',
            action: isNetworkError(err)
              ? {
                  label: t('common.action.retry'),
                  onClick: () => {
                    inflight.delete(key);
                    void claim(body, { silent: false });
                  },
                }
              : undefined,
          });
        } finally {
          if (!opts.silent) setClaiming(false);
          // keep failed/finished entries briefly so a StrictMode re-run doesn't fire a second request
          window.setTimeout(() => inflight.delete(key), 5000);
        }
      })();
      inflight.set(key, run);
      return run;
    },
    [collectionId, router, t, toast],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('k')?.trim();
    const recovery = params.get('r')?.trim();
    const flag = `exl_reclaim_${collectionId}`;
    if (token || recovery) {
      stripClaimParams();
      setSessionFlag(flag);
      void claim(token ? { token } : { recovery: recovery as string }, { silent: false });
      return;
    }
    if (infoRef.current.isOwner) return;
    const stored = getOwnerToken(collectionId);
    if (!stored || sessionFlag(flag)) return;
    setSessionFlag(flag);
    void claim({ token: stored }, { silent: true });
    // run once per collection page mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  return { claiming };
}

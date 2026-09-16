/**
 * Open Graph image of `/<id>` (link previews in chats, social networks, e-mail clients).
 * A shelf of the collection's spine colours with the title and counts; unknown or PIN-protected
 * collections get the generic brand card (nothing about a protected library is revealed).
 */
import { ImageResponse } from 'next/og';
import { translate } from '@/i18n';
import { getRequestLocale } from '@/i18n/server';
import { findCollectionRow, getOgSummary } from '@/lib/collections/queries';
import { env } from '@/lib/env';
import type { Locale } from '@/lib/types';
import { OgCard } from './og-card';
import { OG_SIZE, loadOgFonts, type OgSummary } from './og-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = translate('hu', 'collection.og.alt');

const COLLECTION_ID_RE = /^[1-9]\d{8}$/;

/** Counts change and a collection can become PIN-protected: keep caches short (Next defaults to a year). */
const CACHE_CONTROL = 'public, max-age=900, stale-while-revalidate=86400';
const CACHE_CONTROL_GENERIC = 'public, max-age=300';

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return 'exlibrisvideo.hu';
  }
}

type Props = { params: { id: string } | Promise<{ id: string }> };

export default async function OpenGraphImage({ params }: Props) {
  const { id } = await params;
  let summary: OgSummary | null = null;
  let locale: Locale | null = null;

  if (COLLECTION_ID_RE.test(id)) {
    try {
      const [og, row] = await Promise.all([getOgSummary(id), findCollectionRow(id)]);
      summary = og;
      // the owner's language is the best guess for everyone the link is shared with
      locale = row?.locale === 'en' || row?.locale === 'hu' ? row.locale : null;
    } catch (err) {
      console.warn('[collection] OG summary failed', { id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  locale ??= await getRequestLocale().catch((): Locale => 'hu');

  const fonts = await loadOgFonts();
  return new ImageResponse(<OgCard id={id} locale={locale} summary={summary} host={hostOf(env().APP_URL)} />, {
    ...OG_SIZE,
    fonts: fonts.length > 0 ? fonts : undefined,
    headers: { 'cache-control': summary ? CACHE_CONTROL : CACHE_CONTROL_GENERIC },
  });
}

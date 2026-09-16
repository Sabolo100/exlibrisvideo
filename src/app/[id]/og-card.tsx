/**
 * Open Graph card markup of a collection (1200×630, rendered by next/og / satori). Server-only.
 * Satori needs explicit flex layout on every element with several children.
 */
import type { ReactElement } from 'react';
import { translate, translatePlural } from '@/i18n';
import type { Locale } from '@/lib/types';
import { OG_COLORS as COLORS, OG_SANS as SANS, OG_SERIF as SERIF, OG_SIZE, OG_SPINE_GAP as SPINE_GAP, ogSpines, ogTitleSize, truncate, type OgSpine, type OgSummary } from './og-model';

/* ------------------------------------------------------------------ */
/* markup                                                              */
/* ------------------------------------------------------------------ */

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={Math.round((size * 36) / 32)} viewBox="0 0 32 36">
      <path d="M6.5 1.5h19a5 5 0 0 0 5 5v23a5 5 0 0 0-5 5h-19a5 5 0 0 0-5-5v-23a5 5 0 0 0 5-5Z" fill={COLORS.primary} />
      <path
        d="M8 4h16a4.5 4.5 0 0 0 4 4v20a4.5 4.5 0 0 0-4 4H8a4.5 4.5 0 0 0-4-4V8a4.5 4.5 0 0 0 4-4Z"
        fill="none"
        stroke={COLORS.accent}
        strokeWidth="0.9"
      />
      <rect x="8.6" y="12.2" width="4" height="14.8" rx="0.6" fill={COLORS.primaryInk} opacity="0.92" />
      <rect x="13.6" y="9" width="5.6" height="18" rx="0.7" fill={COLORS.primaryInk} />
      <rect x="13.6" y="10.8" width="5.6" height="1" fill={COLORS.accent} />
      <rect x="13.6" y="24.2" width="5.6" height="1" fill={COLORS.accent} />
      <path d="M14.9 15.4v5.2l4-2.6Z" fill={COLORS.primary} />
      <rect x="21.2" y="13.2" width="3.6" height="14.4" rx="0.6" fill={COLORS.primaryInk} opacity="0.8" transform="rotate(9 23 27.4)" />
      <rect x="6.8" y="27.2" width="18.4" height="1.5" rx="0.5" fill={COLORS.accent} />
    </svg>
  );
}

function ShelfRow({ spines }: { spines: OgSpine[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 1040 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          height: 172,
          padding: '0 20px',
          gap: SPINE_GAP,
          borderRadius: '10px 10px 0 0',
          // mid walnut, so the (often very dark) real spine colours still stand out
          backgroundImage: 'linear-gradient(180deg, #4a2e1a, #6c4428)',
        }}
      >
        {spines.map((spine, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'stretch',
              width: spine.width,
              height: spine.height,
              padding: '10px 0 12px',
              borderRadius: '3px 3px 1px 1px',
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              borderRight: '1px solid rgba(0,0,0,0.35)',
              backgroundColor: spine.color,
              backgroundImage: 'linear-gradient(90deg, rgba(0,0,0,0.26), rgba(255,255,255,0.12) 38%, rgba(0,0,0,0.05) 62%, rgba(0,0,0,0.3))',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {spine.bands ? <div style={{ height: 3, backgroundColor: 'rgba(220,176,104,0.85)' }} /> : null}
              {spine.label ? (
                <div style={{ height: Math.round(spine.height * 0.22), margin: '6px 3px 0', borderRadius: 2, backgroundColor: 'rgba(251,246,236,0.72)' }} />
              ) : null}
            </div>
            {spine.bands ? <div style={{ height: 3, backgroundColor: 'rgba(220,176,104,0.85)' }} /> : null}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          height: 22,
          borderRadius: 3,
          backgroundImage: `linear-gradient(180deg, ${COLORS.woodLight}, ${COLORS.wood} 58%, ${COLORS.woodDark})`,
          boxShadow: '0 12px 20px rgba(63,38,21,0.35)',
        }}
      />
    </div>
  );
}

export interface OgCardInput {
  id: string;
  locale: Locale;
  /** null → generic card (unknown or PIN-protected collection) */
  summary: OgSummary | null;
  /** host shown in the corner, e.g. "exlibrisvideo.hu" */
  host: string;
}

export function OgCard({ id, locale, summary, host }: OgCardInput): ReactElement {
  const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate(locale, key, vars);
  const generic = summary === null;
  const ownerName = summary?.ownerName?.replace(/\s+/g, ' ').trim() || null;
  const title = generic
    ? 'Ex Libris Video'
    : truncate(summary.title?.trim() || (ownerName ? t('collection.title.ownerLibrary', { name: ownerName }) : t('collection.title.fallback', { id })), 80);
  const ownerLine = !generic && summary.title?.trim() && ownerName ? t('collection.title.ownerLibrary', { name: ownerName }) : null;
  const counts =
    !generic && summary.bookCount > 0
      ? t('collection.og.counts', {
          books: translatePlural(locale, 'collection.header.books', summary.bookCount),
          authors: translatePlural(locale, 'collection.header.authors', summary.authorCount),
        })
      : null;
  const subline = counts ?? t('collection.og.tagline');
  const spines = ogSpines(generic ? 'exlibris' : id, summary?.spineColors ?? [], summary?.bookCount ?? 0);

  return (
    <div
      style={{
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: COLORS.paper,
        backgroundImage: `radial-gradient(circle at 50% -10%, #fbf3e2 0%, ${COLORS.paper} 55%, ${COLORS.paperDeep} 100%)`,
        fontFamily: SERIF,
        color: COLORS.ink,
      }}
    >
      {/* bookplate frame */}
      <div style={{ position: 'absolute', top: 22, left: 22, right: 22, bottom: 22, display: 'flex', border: `2px solid rgba(168,122,46,0.55)`, borderRadius: 18 }} />
      <div style={{ position: 'absolute', top: 32, left: 32, right: 32, bottom: 32, display: 'flex', border: `1px solid rgba(168,122,46,0.28)`, borderRadius: 12 }} />

      {/* heading */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '58px 80px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Mark size={40} />
            <div style={{ display: 'flex', fontSize: 24, letterSpacing: 7, color: COLORS.accent, fontStyle: 'italic', fontWeight: 400 }}>EX LIBRIS</div>
          </div>
          <div style={{ display: 'flex', fontFamily: SANS, fontSize: 22, fontWeight: 600, color: COLORS.muted, letterSpacing: 0.5 }}>{host}</div>
        </div>

        <div
          style={{
            display: 'block',
            marginTop: 26,
            maxWidth: 1040,
            fontSize: ogTitleSize(title),
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -0.5,
            lineClamp: 2,
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
        {ownerLine ? (
          <div style={{ display: 'flex', marginTop: 8, fontSize: 30, fontStyle: 'italic', fontWeight: 400, color: COLORS.muted }}>{ownerLine}</div>
        ) : null}
        <div style={{ display: 'flex', marginTop: ownerLine ? 10 : 16, fontFamily: SANS, fontSize: 30, fontWeight: 600, color: COLORS.primary }}>
          {subline}
        </div>
      </div>

      {/* shelf */}
      <div style={{ position: 'absolute', left: 80, bottom: 44, display: 'flex' }}>
        <ShelfRow spines={spines} />
      </div>
    </div>
  );
}

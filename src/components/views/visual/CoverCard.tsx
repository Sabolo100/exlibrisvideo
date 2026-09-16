'use client';

/**
 * One card of the cover wall: the UI kit's BookCover (real or generated) that flips on hover or
 * keyboard focus to a library catalogue card with author, year, topics, the description in the
 * reader's language, rating and reading status. The back face mounts on first interest only.
 */
import { Heart, Star } from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { BookCover, READING_STATUS_META, ReadingStatusBadge, spineLabel } from '@/components/books';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import { bookTopicKeys, isPendingReview, spineColor } from '@/lib/book-utils';
import { topicDef, topicLabel } from '@/lib/taxonomy';
import type { BookDTO, Locale } from '@/lib/types';
import { localizedDescription } from './covers-layout';
import { yearLabel } from './timeline-layout';

const CARD_RADIUS = 'rounded-[2px_5px_5px_2px]';
/** the pointer has to rest this long before a cover flips (sweeping across the wall flips nothing) */
const HOVER_INTENT_MS = 220;

export interface CoverCardProps {
  book: BookDTO;
  locale: Locale;
  onOpen: (id: string) => void;
  /** book currently open in the drawer */
  active: boolean;
  priority?: boolean;
}

export const CoverCard = memo(function CoverCard({ book, locale, onOpen, active, priority = false }: CoverCardProps) {
  const { t } = useUiTranslator();
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [backMounted, setBackMounted] = useState(false);
  const flipped = backMounted && (hovered || keyboardFocus);
  const hoverTimer = useRef<number | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  useEffect(() => clearHoverTimer, []);

  const onPointerEnter = (e: PointerEvent<HTMLButtonElement>) => {
    // touch: a tap opens the book straight away, no flip
    if (e.pointerType === 'touch') return;
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      // the back face mounts with the flip (the transition runs on the already mounted wrapper)
      setBackMounted(true);
      setHovered(true);
    }, HOVER_INTENT_MS);
  };
  const onPointerLeave = () => {
    clearHoverTimer();
    setHovered(false);
  };
  const onFocus = (e: FocusEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.matches(':focus-visible')) return;
    setBackMounted(true);
    setKeyboardFocus(true);
  };

  return (
    <div role="listitem" className="relative flex min-w-0 flex-col" data-cover-id={book.id}>
      <div className="relative [perspective:1400px]">
        <div
          className="relative aspect-[2/3] transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] [transform-style:preserve-3d]"
          style={{ transform: flipped ? 'rotateY(180deg)' : undefined }}
        >
          <div className={cn('absolute inset-0 [backface-visibility:hidden]', active && 'ring-2 ring-accent ring-offset-2 ring-offset-bg', CARD_RADIUS)}>
            <BookCover book={book} decorative priority={priority} />
            <FrontBadges book={book} />
          </div>
          {backMounted ? <CardBack book={book} locale={locale} /> : null}
        </div>
      </div>
      <div className="mt-2.5 h-[3.25rem] min-w-0 px-0.5">
        <p className="line-clamp-2 font-display text-[0.875rem] leading-[1.2] font-semibold text-ink text-pretty">{book.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{book.author ?? t('common.book.unknownAuthor')}</p>
      </div>
      <button
        type="button"
        className={cn('absolute -inset-1 z-10 cursor-pointer rounded-lg', 'outline-offset-2')}
        aria-label={t('visual.open', { label: spineLabel(book) })}
        aria-current={active || undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={() => setKeyboardFocus(false)}
        onClick={() => onOpen(book.id)}
      />
      <SrFlags book={book} />
    </div>
  );
});

/** The front badges as text for screen readers. */
function SrFlags({ book }: { book: BookDTO }) {
  const { t, n } = useUiTranslator();
  const flags = [
    book.readingStatus !== 'unknown' ? t(READING_STATUS_META[book.readingStatus].labelKey) : null,
    book.favorite ? t('visual.badge.favorite') : null,
    book.rating ? t('visual.badge.rating', { value: n(book.rating) }) : null,
    isPendingReview(book) ? t('visual.badge.needsReview') : null,
  ].filter(Boolean);
  if (flags.length === 0) return null;
  return <span className="sr-only">{flags.join(', ')}</span>;
}

function FrontBadges({ book }: { book: BookDTO }) {
  const { t, n } = useUiTranslator();
  const pending = isPendingReview(book);
  return (
    <>
      {book.favorite || pending ? (
        <span className="pointer-events-none absolute top-1.5 right-1.5 flex flex-col items-end gap-1" aria-hidden="true">
          {book.favorite ? (
            <span
              title={t('visual.badge.favorite')}
              className="flex size-6 items-center justify-center rounded-full bg-[#7a2e3a] text-[#fbe9ec] shadow-[0_1px_3px_rgb(0_0_0/0.4)] [&_svg]:size-3.5"
            >
              <Heart className="fill-current" />
            </span>
          ) : null}
          {pending ? (
            <span
              title={t('visual.badge.needsReview')}
              className="flex h-5 items-center rounded-full bg-[#b7791f] px-1.5 text-[0.625rem] font-bold text-[#fff8ea] shadow-[0_1px_3px_rgb(0_0_0/0.4)]"
            >
              !
            </span>
          ) : null}
        </span>
      ) : null}
      {book.readingStatus !== 'unknown' || book.rating ? (
        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1" aria-hidden="true">
          {book.readingStatus !== 'unknown' ? (
            <ReadingStatusBadge status={book.readingStatus} size="sm" iconOnly className="shadow-[0_1px_3px_rgb(0_0_0/0.3)]" />
          ) : (
            <span />
          )}
          {book.rating ? (
            <span className="flex h-5 items-center gap-0.5 rounded-full bg-[rgb(20_16_12/0.78)] px-1.5 text-[0.6875rem] font-semibold text-[#f6e2a8] tabular-nums [&_svg]:size-3">
              <Star className="fill-current" />
              {n(book.rating)}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/** Library catalogue card on the back of the cover. */
function CardBack({ book, locale }: { book: BookDTO; locale: Locale }) {
  const { t } = useUiTranslator();
  const description = localizedDescription(book, locale);
  const topics = bookTopicKeys(book).slice(0, 2);
  const accent = spineColor(book);
  const meta = [
    book.firstPublishedYear !== null ? yearLabel(book.firstPublishedYear, t) : null,
    book.originalTitle && book.originalTitle.trim() !== book.title.trim() ? book.originalTitle : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute inset-0 flex flex-col overflow-hidden border border-line bg-surface text-ink [backface-visibility:hidden] [transform:rotateY(180deg)]',
        'shadow-[0_1px_1px_rgb(0_0_0/0.18),0_10px_24px_hsl(var(--shadow-color)/0.28)]',
        CARD_RADIUS,
      )}
      style={{
        backgroundImage:
          'repeating-linear-gradient(180deg, transparent 0 17px, color-mix(in oklab, var(--line), transparent 35%) 17px 18px)',
        backgroundPosition: '0 30px',
      }}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5" style={{ background: accent }} />
      <span aria-hidden="true" className="absolute inset-y-0 left-3 w-px bg-[color-mix(in_oklab,var(--burgundy),transparent_55%)]" />
      <div className="relative flex min-h-0 flex-1 flex-col gap-1 py-2.5 pr-2.5 pl-5">
        <p className="line-clamp-3 font-display text-[0.8125rem] leading-[1.18] font-semibold text-pretty">{book.title}</p>
        <p className="truncate text-[0.6875rem] font-medium text-muted">{book.author ?? t('common.book.unknownAuthor')}</p>
        {meta.length > 0 ? (
          <p className="truncate text-[0.6875rem] text-muted italic">{meta.join(' · ')}</p>
        ) : null}
        {topics.length > 0 ? (
          <p className="flex min-w-0 flex-wrap gap-1 py-0.5">
            {topics.map((key) => (
              <MiniTopicChip key={key} topic={key} locale={locale} />
            ))}
          </p>
        ) : null}
        <p
          lang={description?.lang}
          className={cn(
            'mt-0.5 min-h-0 flex-1 overflow-hidden text-[0.6875rem] leading-[1.45] text-pretty',
            description ? 'text-ink/85' : 'text-muted italic',
          )}
          style={{ WebkitMaskImage: 'linear-gradient(180deg, #000 78%, transparent)', maskImage: 'linear-gradient(180deg, #000 78%, transparent)' }}
        >
          {description ? description.text : t('visual.covers.noDescription')}
        </p>
        {description?.fallback ? (
          <p className="truncate text-[0.625rem] text-muted">{t(`visual.covers.descriptionIn.${description.lang}`)}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A static topic chip small enough for the back of a cover: the UI kit Chip's hue tint (same
 * colour formula, light and dark) at card-back scale – the kit's smallest Chip is 28 px tall.
 */
function MiniTopicChip({ topic, locale }: { topic: string; locale: Locale }) {
  const def = topicDef(topic);
  const style = def ? ({ '--chip-hue': String(def.hue) } as CSSProperties) : undefined;
  return (
    <span
      style={style}
      className={cn(
        'inline-flex h-[1.125rem] max-w-full min-w-0 items-center gap-[3px] rounded-full border px-1.5 text-[0.625rem] leading-none font-medium',
        def
          ? 'border-[hsl(var(--chip-hue)_35%_80%)] bg-[hsl(var(--chip-hue)_55%_95%)] text-[hsl(var(--chip-hue)_40%_26%)] dark:border-[hsl(var(--chip-hue)_22%_30%)] dark:bg-[hsl(var(--chip-hue)_22%_16%)] dark:text-[hsl(var(--chip-hue)_45%_84%)]'
          : 'border-line bg-surface-2 text-ink',
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-[0.6875rem]">
        {def?.icon ?? '🔖'}
      </span>
      <span className="truncate">{topicLabel(topic, locale)}</span>
    </span>
  );
}

/** Cheap stand-in while a chunk is far from the viewport. */
export function CoverGhost({ book }: { book: BookDTO }) {
  return (
    <div role="presentation" className="flex min-w-0 flex-col" aria-hidden="true">
      <div className={cn('aspect-[2/3] opacity-80', CARD_RADIUS)} style={{ backgroundColor: spineColor(book) }} />
      <div className="mt-2.5 h-[3.25rem]" />
    </div>
  );
}

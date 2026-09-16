'use client';

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import { foldForSearch, hash01, isDarkColor, readableTextColor, shadeColor, spineColor } from '@/lib/book-utils';
import { topicDef } from '@/lib/taxonomy';
import type { BookDTO } from '@/lib/types';
import { coverTitleSize, type CoverVariant } from './cover-layout';

export interface BookCoverProps {
  book: BookDTO;
  /** ignore book.coverImage and always draw the typographic cover */
  generatedOnly?: boolean;
  /** show the topic icon medallion on generated covers (default true) */
  showTopicIcon?: boolean;
  /** load the image eagerly (above the fold) */
  priority?: boolean;
  /** hide from assistive tech (the title is already next to it) */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
  /** overlays (badges, favourite heart) */
  children?: ReactNode;
}


const PAPER = '#efe5cf';
const PAPER_INK = '#2a2118';
const GOLD = '#d2aa5c';


/** Typographic cover used when there is no cover image (or it fails to load). */
function GeneratedCover({ book, showTopicIcon }: { book: BookDTO; showTopicIcon: boolean }) {
  const { t } = useUiTranslator();
  const base = spineColor(book);
  const dark = isDarkColor(base);
  const key = `${foldForSearch(book.author)}|${foldForSearch(book.title)}`;
  const r = hash01(key, 21);
  const variant: CoverVariant = r < 0.42 ? 'classic' : r < 0.74 ? 'band' : 'label';
  const topic = topicDef(book.category ?? book.topics[0]);
  const ink = readableTextColor(base);
  const titleSize = coverTitleSize(book.title, variant);
  const author = book.author?.trim() || t('common.book.unknownAuthor');

  const foilTitle = dark && variant === 'classic';
  const frameColor = dark ? GOLD : shadeColor(base, -0.45);

  const medallion =
    showTopicIcon && topic ? (
      <span
        className="flex shrink-0 items-center justify-center rounded-full leading-none"
        style={{
          width: '15cqw',
          height: '15cqw',
          fontSize: '8cqw',
          border: `1px solid ${variant === 'label' || variant === 'band' ? shadeColor(base, -0.2) : frameColor}`,
          background: variant === 'classic' ? 'rgb(255 255 255 / 0.08)' : 'rgb(255 255 255 / 0.35)',
        }}
      >
        {topic.icon}
      </span>
    ) : null;

  const title = (color: string, foil: boolean) => (
    <span
      className="block font-display font-semibold text-balance [overflow-wrap:anywhere]"
      style={{
        fontSize: `${titleSize}cqw`,
        lineHeight: 1.08,
        color: foil ? 'transparent' : color,
        backgroundImage: foil ? 'linear-gradient(180deg, #f5e2a8 0%, #d6ab56 55%, #b38535 100%)' : undefined,
        WebkitBackgroundClip: foil ? 'text' : undefined,
        backgroundClip: foil ? 'text' : undefined,
        display: '-webkit-box',
        WebkitLineClamp: 5,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        fontVariationSettings: '"opsz" 72',
      }}
    >
      {book.title}
    </span>
  );

  const authorLine = (color: string) => (
    <span
      className="block font-sans font-semibold text-balance uppercase [overflow-wrap:anywhere]"
      style={{
        fontSize: '5.2cqw',
        lineHeight: 1.25,
        letterSpacing: '0.12em',
        color,
        maxWidth: '100%',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {author}
    </span>
  );

  const rule = (color: string) => (
    <span aria-hidden="true" className="flex items-center justify-center gap-[2cqw]" style={{ color, width: '46cqw' }}>
      <span className="h-px flex-1 bg-current opacity-70" />
      <span className="block rotate-45 bg-current" style={{ width: '2.2cqw', height: '2.2cqw' }} />
      <span className="h-px flex-1 bg-current opacity-70" />
    </span>
  );

  return (
    <div className="absolute inset-0" style={{ backgroundColor: base }}>
      {/* cloth texture */}
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.04) 0 1px, transparent 1px 3px), radial-gradient(120% 80% at 70% 20%, rgb(255 255 255 / 0.1), transparent 60%)',
        }}
      />
      {variant === 'classic' ? (
        <>
          <span aria-hidden="true" className="absolute" style={{ inset: '5.5cqw', border: `1px solid ${frameColor}`, opacity: 0.85 }} />
          <span aria-hidden="true" className="absolute" style={{ inset: '7.5cqw', border: `1px solid ${frameColor}`, opacity: 0.45 }} />
          <div className="absolute flex flex-col items-center justify-between text-center" style={{ inset: '12cqw 11cqw 11cqw 13cqw' }}>
            {medallion ?? <span />}
            <div className="flex w-full flex-col items-center" style={{ gap: '4cqw' }}>
              {title(ink, foilTitle)}
              {rule(dark ? GOLD : shadeColor(base, -0.4))}
            </div>
            {authorLine(dark ? '#ead9b0' : ink)}
          </div>
        </>
      ) : null}
      {variant === 'band' ? (
        <>
          <div className="absolute inset-x-0 bottom-0" style={{ height: '40%', background: PAPER }}>
            <span aria-hidden="true" className="absolute inset-x-0 top-0" style={{ height: '1.6cqw', background: GOLD }} />
            <span aria-hidden="true" className="absolute inset-x-0" style={{ top: '2.8cqw', height: '0.6cqw', background: shadeColor(base, -0.1) }} />
            <div className="absolute flex flex-col items-center justify-center text-center" style={{ inset: '6cqw 9cqw 6cqw 11cqw', gap: '3cqw' }}>
              {medallion}
              {authorLine(PAPER_INK)}
            </div>
          </div>
          <div className="absolute flex flex-col items-center justify-center text-center" style={{ top: '9cqw', bottom: '42%', left: '11cqw', right: '9cqw' }}>
            {title(ink, false)}
          </div>
        </>
      ) : null}
      {variant === 'label' ? (
        <>
          <span aria-hidden="true" className="absolute" style={{ inset: '5.5cqw', border: `1px solid ${frameColor}`, opacity: 0.6 }} />
          <div
            className="absolute flex flex-col items-center justify-center text-center"
            style={{
              top: '22%',
              left: '15cqw',
              right: '12cqw',
              minHeight: '40%',
              padding: '6cqw 5cqw',
              gap: '3.5cqw',
              background: `linear-gradient(180deg, ${PAPER}, #e8dcc2)`,
              boxShadow: `0 0 0 1px ${shadeColor(PAPER, -0.3)}, 0 0 0 3px ${PAPER}, 0 0 0 4px ${shadeColor(base, -0.3)}, 0 2px 6px rgb(0 0 0 / 0.25)`,
            }}
          >
            {title(PAPER_INK, false)}
            {rule(shadeColor(base, -0.1))}
            {authorLine('#5a4a3a')}
          </div>
          {medallion ? (
            <div className="absolute inset-x-0 flex justify-center" style={{ bottom: '9cqw' }}>
              {medallion}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * 2:3 book cover. Shows book.coverImage (with a graceful fallback on error) or a generated
 * typographic cover coloured from spineColor(book). Scales with its width (container units).
 */
export function BookCover({
  book,
  generatedOnly = false,
  showTopicIcon = true,
  priority = false,
  decorative = false,
  className,
  style,
  children,
}: BookCoverProps) {
  const { t } = useUiTranslator();
  const src = generatedOnly ? null : book.coverImage;
  const [status, setStatus] = useState<{ src: string | null; state: 'loading' | 'loaded' | 'failed' }>({
    src: null,
    state: 'loading',
  });
  const state = status.src === src ? status.state : 'loading';
  const showImage = Boolean(src) && state !== 'failed';

  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !src) return;
      // cached images can finish before hydration attaches onLoad
      if (img.complete) setStatus({ src, state: img.naturalWidth > 0 ? 'loaded' : 'failed' });
    },
    [src],
  );

  const name = t('common.aria.cover', { title: book.author ? `${book.title} – ${book.author}` : book.title });

  return (
    <div
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'exl-cover relative aspect-[2/3] w-full overflow-hidden rounded-[2px_5px_5px_2px] bg-surface-2',
        'shadow-[0_1px_1px_rgb(0_0_0/0.18),0_6px_16px_hsl(var(--shadow-color)/0.22)]',
        className,
      )}
      style={{ containerType: 'inline-size', ...style }}
    >
      {state !== 'loaded' || !showImage ? <GeneratedCover book={book} showTopicIcon={showTopicIcon} /> : null}
      {showImage && src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          ref={imgRef}
          src={src}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) =>
            setStatus({ src, state: e.currentTarget.naturalWidth > 1 ? 'loaded' : 'failed' })
          }
          onError={() => setStatus({ src, state: 'failed' })}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: state === 'loaded' ? 1 : 0 }}
        />
      ) : null}
      {/* hinge + gloss */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgb(0 0 0 / 0.28) 0%, rgb(255 255 255 / 0.14) 2.6%, rgb(0 0 0 / 0.12) 5%, transparent 9%), linear-gradient(115deg, rgb(255 255 255 / 0.1) 0%, transparent 40%)',
        }}
      />
      {children}
    </div>
  );
}

'use client';

import { motion } from 'motion/react';
import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { cn } from '@/components/ui/cn';
import { authorFamilyName, mixColors, shadeColor } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { useShelfContext } from './shelf-context';
import { spineAppearance, spineBox, spineTextLayout, type SpineAppearance, type SpineSize } from './spine-layout';

export interface BookSpineProps {
  book: BookDTO;
  /** xs (mini, no text) · sm · md (shelf default) · lg. Defaults to the surrounding Shelf's size or md. */
  size?: SpineSize;
  /** use the real spine photo (book.spineImage) as the face when present */
  photo?: boolean;
  /** focusable button with hover/focus lift (automatic when onClick is given) */
  interactive?: boolean;
  /** drawn out of the shelf (e.g. the book open in the drawer) */
  pulled?: boolean;
  onClick?: (book: BookDTO, event: SyntheticEvent) => void;
  /** hide from assistive tech (mini spines next to text that already names the book) */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
  /** extra content layered on top (badges, selection tick) */
  children?: ReactNode;
}

const FOIL_GRADIENT = 'linear-gradient(90deg, #a47a2c 0%, #f3dc9b 38%, #d0a54f 55%, #f6e2a8 72%, #a47a2c 100%)';

/** "Author – Title" (or just the title) – the accessible name of a spine. */
export function spineLabel(book: Pick<BookDTO, 'author' | 'title'>): string {
  return book.author?.trim() ? `${book.author.trim()} – ${book.title}` : book.title;
}

function Bands({ a, height, width }: { a: SpineAppearance; height: number; width: number }) {
  const line = Math.max(1, Math.round(height / 140));
  const gap = Math.max(1.5, height / 90);
  const at = (pct: number) => Math.round(height * pct);
  const color = a.ornament;
  if (a.variant === 'cloth') {
    const top = 0.055 + a.seed * 0.03;
    return (
      <>
        {[top, 0.94 - a.seed * 0.03].map((p, i) => (
          <span
            key={i}
            className="absolute inset-x-0"
            style={{
              top: at(p) - gap,
              height: line * 2 + gap,
              borderTop: `${line}px solid ${color}`,
              borderBottom: `${line}px solid ${color}`,
              opacity: a.dark ? 0.9 : 0.55,
            }}
          />
        ))}
      </>
    );
  }
  if (a.variant === 'leather') {
    // raised bands (hubs) with gold rules
    const hubs = height > 150 ? [0.1, 0.3, 0.7, 0.9] : [0.12, 0.88];
    return (
      <>
        {hubs.map((p, i) => (
          <span
            key={i}
            className="absolute inset-x-0"
            style={{
              top: at(p) - Math.max(2, height / 70),
              height: Math.max(4, height / 35),
              background: `linear-gradient(180deg, ${shadeColor(a.base, -0.35)} 0%, ${shadeColor(a.base, 0.22)} 45%, ${shadeColor(a.base, -0.25)} 100%)`,
              boxShadow: `0 -${line}px 0 ${color}, 0 ${line}px 0 ${color}`,
            }}
          />
        ))}
      </>
    );
  }
  if (a.variant === 'label') {
    const inset = Math.max(2, Math.round(width * 0.13));
    return (
      <>
        <span
          className="absolute"
          style={{
            left: inset,
            right: inset,
            top: at(0.2),
            bottom: at(0.2),
            background: `linear-gradient(90deg, ${shadeColor(a.labelColor, -0.08)}, ${a.labelColor} 35%, ${shadeColor(a.labelColor, -0.05)})`,
            boxShadow: `inset 0 0 0 ${line}px ${shadeColor(a.labelColor, -0.28)}, 0 0 0 ${Math.max(1, line)}px ${mixColors(a.base, '#000000', 0.25)}`,
            borderRadius: 1,
          }}
        />
        <span
          className="absolute inset-x-0"
          style={{ top: at(0.07), height: Math.max(3, height / 45), background: a.ornament, opacity: a.dark ? 0.75 : 0.35 }}
        />
      </>
    );
  }
  // paperback: publisher mark at the tail
  const mark = Math.max(5, Math.round(width * 0.34));
  return (
    <span
      className="absolute left-1/2 -translate-x-1/2 rounded-full"
      style={{
        bottom: at(0.035),
        width: mark,
        height: mark,
        border: `${Math.max(1, line)}px solid ${a.dark ? 'rgb(255 250 235 / 0.55)' : 'rgb(30 25 20 / 0.45)'}`,
        background: a.seed > 0.5 ? (a.dark ? 'rgb(255 250 235 / 0.18)' : 'rgb(30 25 20 / 0.1)') : 'transparent',
      }}
    />
  );
}

/**
 * A book spine that looks like a real cloth / paper / leather binding: colour from spineColor(book),
 * cylindrical shading, head & tail bands, foil-stamped title on dark spines, text reading
 * bottom-to-top, deterministic height/thickness. `photo` uses the cropped spine photo.
 */
export function BookSpine({
  book,
  size: sizeProp,
  photo: photoProp,
  interactive: interactiveProp,
  pulled = false,
  onClick,
  decorative = false,
  className,
  style,
  children,
}: BookSpineProps) {
  const shelf = useShelfContext();
  const size = sizeProp ?? shelf?.size ?? 'md';
  const wantPhoto = photoProp ?? shelf?.photo ?? false;
  const photoSrc = wantPhoto ? book.spineImage : null;
  const [photo, setPhoto] = useState<{ src: string | null; state: 'loading' | 'loaded' | 'failed' }>({
    src: null,
    state: 'loading',
  });
  const photoState = photoSrc && photo.src === photoSrc ? photo.state : 'loading';
  const usePhoto = Boolean(photoSrc) && photoState !== 'failed';
  // the drawn spine stays visible until the photo has really loaded (no broken-image icon, no flash)
  const photoShown = usePhoto && photoState === 'loaded';
  const photoRef = useCallback(
    (img: HTMLImageElement | null) => {
      // cached images (or errors) can complete before hydration attaches onLoad / onError
      if (img && photoSrc && img.complete) setPhoto({ src: photoSrc, state: img.naturalWidth > 0 ? 'loaded' : 'failed' });
    },
    [photoSrc],
  );
  const interactive = interactiveProp ?? Boolean(onClick);

  const { width, height } = spineBox(book, size);
  const a = spineAppearance(book);
  const layout = spineTextLayout({
    width,
    height,
    title: book.title,
    author: book.author,
    authorShort: authorFamilyName(book),
    size,
    variant: a.variant,
  });
  const label = spineLabel(book);

  const onLabel = a.variant === 'label';
  const textColor = onLabel ? '#2a2118' : a.ink;
  const foil = a.foil && !onLabel;
  const radius = size === 'xs' ? '1.5px 1.5px 1px 1px' : '3px 3px 2px 2px';

  const textStyle = (fontSize: number, isTitle: boolean): CSSProperties => ({
    fontSize,
    lineHeight: 1.05,
    color: foil ? 'transparent' : textColor,
    backgroundImage: foil ? FOIL_GRADIENT : undefined,
    WebkitBackgroundClip: foil ? 'text' : undefined,
    backgroundClip: foil ? 'text' : undefined,
    textShadow: foil ? undefined : a.dark && !onLabel ? '0 1px 0 rgb(0 0 0 / 0.35)' : '0 1px 0 rgb(255 255 255 / 0.18)',
    opacity: isTitle ? 1 : foil ? 0.95 : 0.82,
  });

  const photoImg =
    usePhoto && photoSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={photoSrc}
        src={photoSrc}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        ref={photoRef}
        onLoad={(e) => setPhoto({ src: photoSrc, state: e.currentTarget.naturalWidth > 0 ? 'loaded' : 'failed' })}
        onError={() => setPhoto({ src: photoSrc, state: 'failed' })}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: photoShown ? 1 : 0 }}
      />
    ) : null;

  const face = photoShown ? null : (
    <>
      {/* cloth weave / paper grain */}
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            a.variant === 'paperback'
              ? 'linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent 30%, rgb(0 0 0 / 0.05))'
              : 'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.045) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 3px)',
        }}
      />
      {size !== 'xs' || a.variant !== 'paperback' ? <Bands a={a} height={height} width={width} /> : null}
      {layout.mode !== 'none' ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 flex items-center justify-center overflow-hidden"
          style={{ top: layout.head, bottom: layout.tail }}
        >
          <span
            className="flex max-h-full items-center"
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              flexDirection: layout.mode === 'double' || layout.mode === 'title2' ? 'column' : 'row',
              gap:
                layout.mode === 'double'
                  ? Math.max(1, width * 0.04)
                  : layout.mode === 'title2'
                    ? Math.max(0.5, layout.titleSize * 0.06)
                    : layout.titleSize * 0.9,
              height: '100%',
              justifyContent: 'center',
            }}
          >
            {layout.mode === 'single' && layout.authorText ? (
              <span
                className="block min-h-0 overflow-hidden font-sans font-semibold text-ellipsis whitespace-nowrap uppercase"
                // the author gives way first: the title never shrinks for it
                style={{ ...textStyle(layout.authorSize, false), letterSpacing: '0.07em', flex: '0 1 auto' }}
              >
                {layout.authorText}
              </span>
            ) : null}
            {layout.mode === 'title2' ? (
              layout.titleLines.map((line, i) => (
                <span
                  key={i}
                  className="block min-h-0 overflow-hidden text-center font-display font-semibold text-ellipsis whitespace-nowrap"
                  style={{ ...textStyle(layout.titleSize, true), flex: '0 1 auto', maxHeight: '100%', fontVariationSettings: '"opsz" 24' }}
                >
                  {line}
                </span>
              ))
            ) : (
              <span
                className="block min-h-0 overflow-hidden text-center font-display font-semibold text-ellipsis whitespace-nowrap"
                style={{
                  ...textStyle(layout.titleSize, true),
                  flex: layout.mode === 'single' ? '0 0 auto' : '0 1 auto',
                  maxHeight: '100%',
                  fontVariationSettings: '"opsz" 24',
                }}
              >
                {book.title}
              </span>
            )}
            {layout.mode === 'double' && layout.authorText ? (
              <span
                className="block min-h-0 overflow-hidden text-center font-sans font-semibold text-ellipsis whitespace-nowrap uppercase"
                style={{ ...textStyle(layout.authorSize, false), letterSpacing: '0.07em', flex: '0 1 auto', maxHeight: '100%' }}
              >
                {layout.authorText}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
    </>
  );

  const rootStyle: CSSProperties = {
    width,
    height,
    borderRadius: radius,
    backgroundColor: a.base,
    ...style,
  };

  const content = (
    <>
      {face}
      {photoImg}
      {/* rounded-spine shading + worn edges (over text so it looks printed on the curve) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          backgroundImage: `linear-gradient(90deg, rgb(0 0 0 / ${photoShown ? 0.28 : 0.38}) 0%, rgb(0 0 0 / 0.1) 9%, rgb(255 255 255 / ${photoShown ? 0.12 : 0.2}) 27%, rgb(255 255 255 / 0.04) 44%, rgb(0 0 0 / 0.04) 66%, rgb(0 0 0 / ${photoShown ? 0.25 : 0.34}) 100%)`,
          boxShadow: `inset 0 ${size === 'xs' ? 1 : 2}px 0 rgb(0 0 0 / 0.22), inset 0 -${size === 'xs' ? 1 : 2}px 0 rgb(0 0 0 / 0.28), inset 1px 0 0 rgb(255 255 255 / 0.12), inset -1px 0 0 rgb(0 0 0 / 0.2)`,
        }}
      />
      {children}
    </>
  );

  const baseClass = cn(
    'exl-spine relative shrink-0 overflow-hidden select-none',
    'shadow-[1px_0_1px_rgb(0_0_0/0.35),2px_1px_5px_rgb(0_0_0/0.22)]',
    interactive &&
      'cursor-pointer outline-offset-3 transition-shadow duration-200 hover:z-10 focus-visible:z-10 hover:shadow-[2px_0_2px_rgb(0_0_0/0.35),6px_10px_18px_rgb(0_0_0/0.35)] focus-visible:shadow-[2px_0_2px_rgb(0_0_0/0.35),6px_10px_18px_rgb(0_0_0/0.35)]',
    pulled && 'z-10 shadow-[2px_0_2px_rgb(0_0_0/0.35),8px_16px_24px_rgb(0_0_0/0.4)]',
    className,
  );

  if (!interactive) {
    if (pulled) {
      return (
        <motion.div
          className={baseClass}
          style={{ transformOrigin: '50% 100%', ...rootStyle }}
          initial={false}
          animate={{ y: -Math.max(8, Math.round(height * 0.1)), scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          role={decorative ? undefined : 'img'}
          aria-label={decorative ? undefined : label}
          aria-hidden={decorative || undefined}
          data-book-id={book.id}
        >
          {content}
        </motion.div>
      );
    }
    return (
      <div
        className={baseClass}
        style={rootStyle}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        data-book-id={book.id}
      >
        {content}
      </div>
    );
  }

  const lift = Math.max(4, Math.round(height * 0.055));
  const pull = Math.max(8, Math.round(height * 0.1));

  const activate = (e: SyntheticEvent) => onClick?.(book, e);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-pulled={pulled || undefined}
      data-book-id={book.id}
      className={baseClass}
      style={{ transformOrigin: '50% 100%', ...rootStyle }}
      initial={false}
      // lifted and drawn slightly towards the viewer (scale from the bottom edge)
      animate={pulled ? { y: -pull, scale: 1.05 } : { y: 0, scale: 1 }}
      whileHover={pulled ? { y: -pull, scale: 1.05 } : { y: -lift, scale: 1.025 }}
      whileFocus={pulled ? { y: -pull, scale: 1.05 } : { y: -lift, scale: 1.025 }}
      whileTap={{ scale: pulled ? 1.03 : 1.005 }}
      transition={{ type: 'spring', stiffness: 460, damping: 26, mass: 0.7 }}
      onClick={(e: MouseEvent<HTMLDivElement>) => activate(e)}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(e);
        }
      }}
    >
      {content}
    </motion.div>
  );
}

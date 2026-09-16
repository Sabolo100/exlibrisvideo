'use client';

/**
 * Visual evidence of a recognised book: the cropped spine photo (also as a readable, rotated strip)
 * and the best video frame with the spine's bounding box highlighted, all zoomable in a lightbox.
 * Used by the drawer and review mode.
 */
import { ImageOff, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Button, Dialog, IconButton, Skeleton, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { BBox, BookDTO, FrameDTO } from '@/lib/types';
import { bboxToPercentRect, defaultSpineTurn, findEvidenceFrame, isUprightCrop, type SpineTurn } from './book-form-utils';
import { useCollectionFrames } from './frames-store';

type PercentRect = NonNullable<ReturnType<typeof bboxToPercentRect>>;

/* ------------------------------------------------------------------ */
/* Lightbox                                                            */
/* ------------------------------------------------------------------ */

export interface ImageLightboxProps {
  open: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  title: ReactNode;
  /** highlighted region in percent of the image */
  highlight?: PercentRect | null;
}

const ZOOM = 2.5;

/** Full-size image in a dialog; click (or the zoom button) toggles a 2.5× zoom centred on the click point. */
export function ImageLightbox({ open, onClose, src, alt, title, highlight }: ImageLightboxProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState<{ width: number; focusX: number; focusY: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setZoom(null);
    setFailed(false);
  }

  const toggleZoom = useCallback(
    (clientX?: number, clientY?: number) => {
      const img = imgRef.current;
      if (!img) return;
      if (zoom) {
        setZoom(null);
        return;
      }
      const rect = img.getBoundingClientRect();
      const fx = clientX === undefined ? 0.5 : (clientX - rect.left) / Math.max(1, rect.width);
      const fy = clientY === undefined ? 0.5 : (clientY - rect.top) / Math.max(1, rect.height);
      setZoom({ width: rect.width * ZOOM, focusX: Math.min(1, Math.max(0, fx)), focusY: Math.min(1, Math.max(0, fy)) });
    },
    [zoom],
  );

  // keep the clicked point in the middle of the viewport after zooming in
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const img = imgRef.current;
    if (!box || !img || !zoom) return;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    box.scrollLeft = zoom.focusX * w - box.clientWidth / 2;
    box.scrollTop = zoom.focusY * h - box.clientHeight / 2;
  }, [zoom]);

  const close = () => {
    setZoom(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      size="xl"
      bodyClassName="px-3 pb-3 sm:px-4"
      footer={
        <>
          <p className="mr-auto hidden text-xs text-muted sm:block">{t('book.lightbox.hint')}</p>
          <Button
            size="sm"
            leftIcon={zoom ? <ZoomOut /> : <ZoomIn />}
            onClick={() => toggleZoom()}
            disabled={failed}
          >
            {zoom ? t('book.lightbox.zoomOut') : t('book.lightbox.zoomIn')}
          </Button>
        </>
      }
    >
      <div
        ref={scrollRef}
        className={cn(
          'relative flex max-h-[min(72dvh,56rem)] min-h-40 overflow-auto overscroll-contain rounded-lg bg-[#15110c]',
          zoom ? 'items-start justify-start' : 'items-center justify-center',
        )}
      >
        {failed ? (
          <div className="flex w-full flex-col items-center justify-center gap-2 py-16 text-sm text-[#d8ccb8]">
            <ImageOff className="size-6" aria-hidden="true" />
            {t('book.evidence.frameError')}
          </div>
        ) : (
          <div className={cn('relative shrink-0 leading-[0]', zoom ? 'm-0' : 'm-auto')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={src}
              alt={alt}
              draggable={false}
              onError={() => setFailed(true)}
              onClick={(e: MouseEvent<HTMLImageElement>) => toggleZoom(e.clientX, e.clientY)}
              className={cn('block select-none', zoom ? 'max-w-none cursor-zoom-out' : 'max-h-[min(72dvh,56rem)] max-w-full cursor-zoom-in')}
              style={zoom ? { width: zoom.width, height: 'auto' } : undefined}
            />
            {highlight ? <HighlightBox rect={highlight} strong /> : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Highlight                                                           */
/* ------------------------------------------------------------------ */

function HighlightBox({ rect, strong = false }: { rect: PercentRect; strong?: boolean }) {
  const style: CSSProperties = {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
    outline: '2px solid #e3b964',
    // dims everything outside the box (the parent clips the huge spread)
    boxShadow: `0 0 0 9999px rgb(10 8 5 / ${strong ? 0.5 : 0.42}), 0 0 0 1px rgb(255 245 220 / 0.55), 0 0 14px 2px rgb(220 176 104 / 0.55)`,
  };
  return <span aria-hidden="true" className="pointer-events-none absolute rounded-[3px]" style={style} />;
}

/* ------------------------------------------------------------------ */
/* Readable spine strip (rotated crop)                                 */
/* ------------------------------------------------------------------ */

interface RotatedImage {
  status: 'loading' | 'ready' | 'error';
  /** data URL of the rotated bitmap, or the original src when no rotation is needed */
  url: string | null;
  /** the crop shows a standing book (rotation applies) */
  upright: boolean;
}

const ROTATION_CACHE_LIMIT = 60;
const rotationCache = new Map<string, Promise<{ url: string; upright: boolean }>>();

function rotateImage(src: string, turn: SpineTurn): Promise<{ url: string; upright: boolean }> {
  const key = `${turn}|${src}`;
  const cached = rotationCache.get(key);
  if (cached) return cached;
  const job = new Promise<{ url: string; upright: boolean }>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!isUprightCrop(w, h) || turn === 0) {
        resolve({ url: src, upright: isUprightCrop(w, h) });
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = h;
        canvas.height = w;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        if (turn === 90) {
          ctx.translate(h, 0);
          ctx.rotate(Math.PI / 2);
        } else {
          ctx.translate(0, w);
          ctx.rotate(-Math.PI / 2);
        }
        ctx.drawImage(img, 0, 0);
        resolve({ url: canvas.toDataURL('image/jpeg', 0.92), upright: true });
      } catch {
        // no canvas (or a tainted one): show the photo as it is rather than nothing
        resolve({ url: src, upright: false });
      }
    };
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
  job.catch(() => rotationCache.delete(key));
  rotationCache.set(key, job);
  // keep the cache small: drop the oldest entries (data URLs are garbage-collected once unused)
  while (rotationCache.size > ROTATION_CACHE_LIMIT) rotationCache.delete(rotationCache.keys().next().value as string);
  return job;
}

function useRotatedImage(src: string | null, turn: SpineTurn): RotatedImage {
  const [state, setState] = useState<{ key: string; image: RotatedImage }>({ key: '', image: { status: 'loading', url: null, upright: false } });
  const key = src ? `${turn}|${src}` : '';
  useEffect(() => {
    if (!src) return;
    let alive = true;
    rotateImage(src, turn).then(
      (r) => alive && setState({ key, image: { status: 'ready', url: r.url, upright: r.upright } }),
      () => alive && setState({ key, image: { status: 'error', url: null, upright: false } }),
    );
    return () => {
      alive = false;
    };
  }, [src, turn, key]);
  if (!src) return { status: 'error', url: null, upright: false };
  return state.key === key ? state.image : { status: 'loading', url: null, upright: false };
}

export interface SpineStripProps {
  /** a book, or anything with a spine photo (e.g. an unread spine: `title` is then only the alt text) */
  book: Pick<BookDTO, 'id' | 'title' | 'spineImage' | 'language'>;
  /** max rendered height of the strip (CSS length) */
  maxHeight?: string;
  className?: string;
  /** shown when the book has no spine photo (or it fails to load) */
  fallback?: ReactNode;
  /** alt text of the photo (default: "spine of <title>") */
  alt?: string;
}

/**
 * The spine photo turned on its side so the lettering reads left to right (direction guessed from the
 * book's language, flippable), full width, zoomable. Non-upright crops are shown as they are.
 */
export function SpineStrip({ book, maxHeight = '6rem', className, fallback = null, alt: altText }: SpineStripProps) {
  const { t } = useI18n();
  const [turnState, setTurnState] = useState<{ bookId: string; turn: SpineTurn }>(() => ({ bookId: book.id, turn: defaultSpineTurn(book) }));
  const turn = turnState.bookId === book.id ? turnState.turn : defaultSpineTurn(book);
  const image = useRotatedImage(book.spineImage, turn);
  const [open, setOpen] = useState(false);
  const alt = altText ?? t('book.evidence.spineAlt', { title: book.title });

  if (!book.spineImage || image.status === 'error') return <>{fallback}</>;

  return (
    <div className={cn('group/strip relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={image.status !== 'ready'}
        aria-label={t('book.evidence.zoomSpine')}
        title={t('book.review.zoomHint')}
        className="flex w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-[#15110c] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-shadow hover:shadow-lift disabled:cursor-default"
        style={{ minHeight: '3.5rem' }}
      >
        {image.status === 'ready' && image.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt={alt} draggable={false} className="block h-auto max-w-full object-contain" style={{ maxHeight }} />
        ) : (
          <Skeleton className="w-full rounded" height="2.5rem" />
        )}
      </button>
      {image.status === 'ready' && image.upright ? (
        // wrapper positions it: IconButton's own `relative` would win over an `absolute` class
        <span className="absolute top-1.5 right-1.5 opacity-85 transition-opacity group-hover/strip:opacity-100 has-[:focus-visible]:opacity-100">
          <IconButton
            aria-label={t('book.evidence.rotate')}
            tooltip
            size="xs"
            round
            variant="secondary"
            icon={<RotateCw />}
            onClick={() => setTurnState({ bookId: book.id, turn: turn === 270 ? 90 : 270 })}
          />
        </span>
      ) : null}
      {image.url ? (
        <ImageLightbox open={open} onClose={() => setOpen(false)} src={image.url} alt={alt} title={t('book.evidence.spinePhoto')} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Frame with bbox                                                     */
/* ------------------------------------------------------------------ */

export interface FrameWithBoxProps {
  frame: FrameDTO;
  bbox: BBox | null;
  title: string;
  /** max rendered height (CSS length); width follows the frame's aspect ratio */
  maxHeight?: string;
  /** use the full-size image instead of the 480 px thumbnail */
  fullSize?: boolean;
  className?: string;
}

/** A frame image with the book's box highlighted; click opens the zoomable lightbox. */
export function FrameWithBox({ frame, bbox, title, maxHeight = '18rem', fullSize = false, className }: FrameWithBoxProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ratio = frame.width > 0 && frame.height > 0 ? frame.width / frame.height : 16 / 9;
  const rect = bboxToPercentRect(bbox, frame.width, frame.height);
  const src = fullSize ? frame.image : (frame.thumb ?? frame.image);
  const alt = t('book.evidence.frameAlt', { title });

  if (failed === src) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-sm text-muted', className)}>
        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
        {t('book.evidence.frameError')}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('book.evidence.zoomFrame')}
        title={t('book.review.zoomHint')}
        className={cn(
          'group relative mx-auto block cursor-zoom-in overflow-hidden rounded-lg bg-[#15110c] shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-shadow hover:shadow-lift',
          className,
        )}
        style={{ aspectRatio: String(ratio), width: `min(100%, calc(${maxHeight} * ${ratio.toFixed(4)}))` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          className="absolute inset-0 block h-full w-full object-cover"
        />
        {rect ? <HighlightBox rect={rect} /> : null}
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [&_svg]:size-4">
          <ZoomIn aria-hidden="true" />
        </span>
      </button>
      <ImageLightbox
        open={open}
        onClose={() => setOpen(false)}
        src={frame.image}
        alt={alt}
        title={t('book.evidence.frame')}
        highlight={rect}
      />
    </>
  );
}

export interface BookFrameEvidenceProps {
  collectionId: string;
  framesVersion: string;
  book: BookDTO;
  maxHeight?: string;
  fullSize?: boolean;
  /** load lazily only when true (e.g. drawer open) */
  enabled?: boolean;
  className?: string;
  /** rendered when the book has no frame at all */
  empty?: ReactNode;
}

/** This book's best frame (+ box) from the cached frames of the collection; `landscape` for layout decisions. */
export function useEvidenceFrame(collectionId: string, framesVersion: string, book: BookDTO | null, enabled = true) {
  const frames = useCollectionFrames(collectionId, framesVersion, enabled && book !== null);
  const evidence = book && frames.data ? findEvidenceFrame(book, frames.data, frames.data.byId) : null;
  return {
    status: frames.status,
    retry: frames.retry,
    evidence,
    landscape: Boolean(evidence && evidence.frame.width > evidence.frame.height),
  };
}

/** Loads the collection's frames (cached) and shows this book's best frame with its box. */
export function BookFrameEvidence({
  collectionId,
  framesVersion,
  book,
  maxHeight = '18rem',
  fullSize = false,
  enabled = true,
  className,
  empty,
}: BookFrameEvidenceProps) {
  const { t } = useI18n();
  const { evidence, status, retry } = useEvidenceFrame(collectionId, framesVersion, book, enabled);
  const frames = { status, retry };

  if (evidence) {
    return <FrameWithBox frame={evidence.frame} bbox={evidence.bbox} title={book.title} maxHeight={maxHeight} fullSize={fullSize} className={className} />;
  }
  if (frames.status === 'loading' || frames.status === 'idle') {
    return (
      <div className={cn('relative', className)} role="status" aria-live="polite">
        <Skeleton className="w-full rounded-lg" height={`min(${maxHeight}, 12rem)`} />
        <span className="sr-only">{t('book.evidence.frameLoading')}</span>
      </div>
    );
  }
  if (frames.status === 'error') {
    return (
      <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted', className)}>
        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{t('book.evidence.frameError')}</span>
        <IconButton aria-label={t('common.action.retry')} tooltip icon={<RotateCcw />} size="sm" onClick={frames.retry} />
      </div>
    );
  }
  return <>{empty ?? <p className={cn('text-sm text-muted', className)}>{t('book.evidence.noFrame')}</p>}</>;
}

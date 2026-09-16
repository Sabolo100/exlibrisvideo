'use client';

/**
 * The selected key frame, large, with the detected spines as boxes. Boxes are scaled from the
 * frame's pixel space (frame.width × frame.height) to the rendered size, which follows the
 * container width (ResizeObserver) and the viewport height. Matched boxes open their book;
 * detections whose book is gone are drawn greyed out.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { spineLabel } from '@/components/books';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import type { BookDTO, FrameDTO } from '@/lib/types';
import { fitFrame, labelOrientation, scaleBBox, type FrameDetection, type ScaledBox } from './frames-layout';
import { useElementWidth, useViewportHeight } from './hooks';

export interface FrameStageProps {
  frame: FrameDTO;
  detections: readonly FrameDetection[];
  booksById: ReadonlyMap<string, BookDTO>;
  /** accessible name of the image */
  imageLabel: string;
  showAll: boolean;
  /** book highlighted from outside (open in the drawer / hovered in the list) */
  highlightBookId: string | null;
  onOpen: (bookId: string) => void;
  onHoverBook?: (bookId: string | null) => void;
}

interface PlacedBox {
  key: string;
  box: ScaledBox;
  book: BookDTO | null;
}

export const FrameStage = memo(function FrameStage({
  frame,
  detections,
  booksById,
  imageLabel,
  showAll,
  highlightBookId,
  onOpen,
  onHoverBook,
}: FrameStageProps) {
  const { t } = useUiTranslator();
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>();
  const viewportHeight = useViewportHeight();
  const maxHeight = Math.max(240, Math.min(viewportHeight * 0.72, 900));
  const size = useMemo(() => fitFrame(frame.width, frame.height, wrapWidth ?? 0, maxHeight), [frame.width, frame.height, wrapWidth, maxHeight]);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const loaded = loadedSrc === frame.image;
  const failed = failedSrc === frame.image;

  useEffect(() => setHovered(null), [frame.id]);

  const boxes: PlacedBox[] = useMemo(() => {
    if (!(size.width > 0)) return [];
    const out: PlacedBox[] = [];
    detections.forEach((d, i) => {
      const box = scaleBBox(d.bbox, frame, size);
      if (!box) return;
      out.push({ key: `${i}:${d.bookId ?? 'x'}`, box, book: d.bookId ? (booksById.get(d.bookId) ?? null) : null });
    });
    return out;
  }, [detections, frame, size, booksById]);

  const hoveredBox = boxes.find((b) => b.key === hovered) ?? null;

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-[#0f0c09] shadow-lift"
        style={{
          width: size.width || '100%',
          height: size.height || undefined,
          aspectRatio: size.width ? undefined : `${frame.width} / ${frame.height}`,
          maxHeight,
        }}
      >
        {frame.thumb && !loaded ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame.thumb} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-105 object-fill blur-md" />
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={frame.image}
          src={frame.image}
          alt={imageLabel}
          decoding="async"
          draggable={false}
          ref={(img) => {
            if (img?.complete && img.naturalWidth > 0) setLoadedSrc(frame.image);
          }}
          onLoad={() => setLoadedSrc(frame.image)}
          onError={() => setFailedSrc(frame.image)}
          className="absolute inset-0 h-full w-full object-fill transition-opacity duration-300 select-none"
          style={{ opacity: loaded ? 1 : 0 }}
        />
        {!loaded && !failed ? <div aria-hidden="true" className="absolute inset-0 animate-pulse bg-white/5" /> : null}
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
            {t('visual.frames.error.title')}
          </div>
        ) : null}

        <div className="absolute inset-0">
          {boxes.map(({ key, box, book }) => {
            const style = { left: box.left, top: box.top, width: box.width, height: box.height };
            if (!book) {
              return (
                <span
                  key={key}
                  title={t('visual.frames.unmatched')}
                  className={cn(
                    'absolute rounded-[3px] border border-dashed transition-opacity duration-150',
                    'border-white/55 bg-[rgb(20_16_12/0.35)] [box-shadow:0_0_0_1px_rgb(0_0_0/0.35)]',
                    showAll ? 'opacity-100' : 'opacity-0 hover:opacity-100',
                  )}
                  style={style}
                />
              );
            }
            const highlighted = highlightBookId === book.id || hovered === key;
            const orientation = labelOrientation(box);
            return (
              <button
                key={key}
                type="button"
                aria-label={t('visual.open', { label: spineLabel(book) })}
                onClick={() => onOpen(book.id)}
                onPointerEnter={() => {
                  setHovered(key);
                  onHoverBook?.(book.id);
                }}
                onPointerLeave={() => {
                  setHovered((h) => (h === key ? null : h));
                  onHoverBook?.(null);
                }}
                onFocus={() => {
                  setHovered(key);
                  onHoverBook?.(book.id);
                }}
                onBlur={() => {
                  setHovered((h) => (h === key ? null : h));
                  onHoverBook?.(null);
                }}
                className={cn(
                  'group absolute cursor-pointer rounded-[3px] border-2 transition-[background-color,border-color,opacity,box-shadow] duration-150 outline-none',
                  'focus-visible:border-[#f6e2a8] focus-visible:[box-shadow:0_0_0_2px_rgb(0_0_0/0.6),0_0_0_4px_#dcb068]',
                  highlighted
                    ? 'border-[#86e0ad] bg-[rgb(134_224_173/0.2)] opacity-100 [box-shadow:0_0_0_1px_rgb(0_0_0/0.55),0_0_18px_rgb(134_224_173/0.45)]'
                    : showAll
                      ? 'border-[#e7b35c] bg-transparent opacity-100 [box-shadow:0_0_0_1px_rgb(0_0_0/0.45)] hover:bg-[rgb(231_179_92/0.18)]'
                      : 'border-[#e7b35c] opacity-0 hover:opacity-100 focus-visible:opacity-100',
                )}
                style={style}
              >
                {orientation !== 'none' && (showAll || highlighted) ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute overflow-hidden rounded-[2px] bg-[rgb(15_12_9/0.78)] px-[3px] py-[2px] font-sans text-[10px] leading-[1.15] font-semibold text-ellipsis whitespace-nowrap text-[#f6e9cf]',
                      orientation === 'vertical' ? 'bottom-[3px] left-1/2 max-h-[calc(100%-6px)]' : 'top-[3px] left-[3px] max-w-[calc(100%-6px)]',
                    )}
                    style={orientation === 'vertical' ? { writingMode: 'vertical-rl', transform: 'translateX(-50%) rotate(180deg)' } : undefined}
                  >
                    {book.title}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {hoveredBox?.book ? <BoxCaption box={hoveredBox.box} book={hoveredBox.book} stageWidth={size.width} /> : null}
      </div>
    </div>
  );
});

/** Title + author floating above (or below) the hovered box, kept inside the stage. */
function BoxCaption({ box, book, stageWidth }: { box: ScaledBox; book: BookDTO; stageWidth: number }) {
  const above = box.top > 64;
  const centre = box.left + box.width / 2;
  const half = Math.min(110, stageWidth / 2);
  const left = Math.min(Math.max(centre, half), stageWidth - half);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 w-max max-w-[min(14rem,calc(100%-12px))] rounded-md bg-ink px-2.5 py-1.5 text-bg shadow-lift"
      style={{
        left,
        top: above ? box.top - 8 : box.top + box.height + 8,
        translate: above ? '-50% -100%' : '-50% 0',
      }}
    >
      <span className="block font-display text-sm leading-snug font-semibold">{book.title}</span>
      {book.author ? <span className="block text-xs opacity-80">{book.author}</span> : null}
    </div>
  );
}

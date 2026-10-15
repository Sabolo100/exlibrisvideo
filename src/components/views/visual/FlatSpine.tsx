'use client';

/**
 * A book lying on its side, its spine facing out: a full-size (md) spine turned 90° clockwise – so the title
 * reads left to right – and scaled to the room it has, wrapped in a box of the turned size. Used by the lying
 * bookcase, the topic shelf and the timeline piles.
 */
import { memo, type CSSProperties } from 'react';
import { BookSpine } from '@/components/books';
import { spineColor } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { cn } from '@/components/ui/cn';
import { cachedSpineBox } from './shelf-layout';
import { FLAT_SPINE_SIZE } from './stack-layout';

export interface FlatSpineProps {
  book: BookDTO;
  scale: number;
  pulled?: boolean;
  onOpen?: (book: BookDTO) => void;
  /** sideways offset (px) */
  shift?: number;
  /** a cheap coloured block of the same size (far from the viewport) */
  placeholder?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const FlatSpine = memo(function FlatSpine({ book, scale, pulled = false, onOpen, shift = 0, placeholder = false, className, style }: FlatSpineProps) {
  const { width, height } = cachedSpineBox(book, FLAT_SPINE_SIZE);
  const length = Math.round(height * scale);
  const thickness = Math.max(4, Math.round(width * scale));
  if (placeholder) {
    return (
      <span
        aria-hidden="true"
        className={cn('block shrink-0 rounded-[2px]', className)}
        style={{
          width: length,
          height: thickness,
          translate: shift ? `${shift}px 0` : undefined,
          backgroundColor: spineColor(book),
          boxShadow: 'inset 0 3px 3px rgb(0 0 0 / 0.22), inset 0 -3px 3px rgb(0 0 0 / 0.28)',
          ...style,
        }}
      />
    );
  }
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: length, height: thickness, translate: shift ? `${shift}px 0` : undefined, ...style }}>
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transformOrigin: '0 0', transform: `translateX(${length}px) rotate(90deg) scale(${scale})` }}
      >
        <BookSpine book={book} size={FLAT_SPINE_SIZE} pulled={pulled} onClick={onOpen} />
      </div>
    </div>
  );
});

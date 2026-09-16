import type { ComponentPropsWithRef, CSSProperties } from 'react';
import { cn } from './cn';

export type SkeletonProps = ComponentPropsWithRef<'div'> & {
  /** "rect" (default), "text" line, "circle", or "spine" (a book-spine placeholder) */
  shape?: 'rect' | 'text' | 'circle' | 'spine';
  width?: number | string;
  height?: number | string;
};

/** Pulsing placeholder while content loads. Decorative (aria-hidden). */
export function Skeleton({ shape = 'rect', width, height, className, style, ...rest }: SkeletonProps) {
  const s: CSSProperties = { ...style };
  if (width !== undefined) s.width = width;
  if (height !== undefined) s.height = height;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-[color-mix(in_oklab,var(--surface-2),var(--ink)_7%)]',
        shape === 'rect' && 'rounded-lg',
        shape === 'text' && 'h-[0.8em] rounded',
        shape === 'circle' && 'aspect-square rounded-full',
        shape === 'spine' && 'rounded-t-[3px] rounded-b-[2px]',
        className,
      )}
      style={s}
      {...rest}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** Several text lines, the last one shorter. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="text" className="h-3" width={i === lines - 1 && lines > 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}

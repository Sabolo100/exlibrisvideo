'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';
import { barPath } from './chart-geometry';
import { EASE_OUT } from './ChartKit';
import { useElementSize, usePrefersReducedMotion } from './hooks';

export interface BarListItem {
  key: string;
  /** visible label (text, flag + name …) */
  label: ReactNode;
  value: number;
  /** formatted value shown in the value column */
  valueLabel: string;
  /** accessible name of a clickable row (label, value and the action); static rows read their text */
  ariaLabel?: string;
  /** native tooltip (e.g. the full name when the label truncates) */
  title?: string;
  /** makes the row a button */
  onSelect?: () => void;
}

export interface BarListProps {
  items: readonly BarListItem[];
  /** value of a full-length bar (defaults to the largest item) */
  max?: number;
  /** CSS grid width of the label column */
  labelColumn?: string;
  className?: string;
  /** accessible name of the list */
  'aria-label'?: string;
  /** stagger offset of the grow animation (s) */
  delay?: number;
}

const BAR_THICKNESS = 12;

/**
 * Horizontal bars as a list: label · bar · value. Rows share one grid (subgrid), so every bar
 * starts at the same baseline and full length means the same value. Bars are thin SVG marks with a
 * rounded data end; the whole row is the hit target when it is clickable.
 */
export function BarList({ items, max, labelColumn = 'minmax(0,40%)', className, delay = 0, ...rest }: BarListProps) {
  const reduced = usePrefersReducedMotion();
  const [trackRef, trackSize] = useElementSize<HTMLSpanElement>();
  const trackWidth = trackSize?.width ?? 0;
  const top = max ?? Math.max(0, ...items.map((i) => i.value));

  return (
    <ol
      aria-label={rest['aria-label']}
      className={cn('grid gap-x-3', className)}
      style={{ gridTemplateColumns: `${labelColumn} minmax(0,1fr) auto` }}
    >
      {items.map((item, i) => {
        const length = top > 0 && trackWidth > 0 ? Math.max(item.value > 0 ? 3 : 0, (item.value / top) * trackWidth) : 0;
        const path = barPath({ x: 0, y: 0, width: length, height: BAR_THICKNESS }, 4, 'right');
        const content = (
          <>
            <span className="min-w-0 truncate text-sm text-ink">{item.label}</span>
            <span ref={i === 0 ? trackRef : undefined} className="relative block h-3 min-w-0" aria-hidden="true">
              {path ? (
                <svg width={trackWidth} height={BAR_THICKNESS} className="absolute inset-y-0 left-0 block overflow-visible">
                  <motion.path
                    d={path}
                    className={cn(
                      'fill-[var(--viz-bar)] transition-[fill] duration-150',
                      item.onSelect && 'group-hover:fill-[var(--viz-bar-hover)] group-focus-visible:fill-[var(--viz-bar-hover)]',
                    )}
                    // motion computes the SVG transform-origin from originX/originY (on the fill box)
                    style={{ originX: 0, originY: 0.5 }}
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: reduced ? 0 : 0.7, delay: reduced ? 0 : delay + i * 0.045, ease: EASE_OUT }}
                  />
                </svg>
              ) : null}
            </span>
            <span className="text-right text-sm text-ink tabular-nums">{item.valueLabel}</span>
          </>
        );
        return (
          <li key={item.key} className="col-span-full grid grid-cols-subgrid">
            {item.onSelect ? (
              <button
                type="button"
                onClick={item.onSelect}
                aria-label={item.ariaLabel}
                title={item.title}
                className="group col-span-full -mx-2 grid grid-cols-subgrid items-center rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                {content}
              </button>
            ) : (
              <div className="col-span-full grid grid-cols-subgrid items-center py-1.5" title={item.title}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

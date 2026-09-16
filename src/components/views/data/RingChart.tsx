'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';
import { circumference, ringSegments } from './chart-geometry';
import { EASE_OUT, useChartId } from './ChartKit';
import { usePrefersReducedMotion } from './hooks';

export interface RingDatum {
  key: string;
  value: number;
  /** CSS colour of the segment */
  color: string;
}

export interface RingChartProps {
  data: readonly RingDatum[];
  /** outer diameter in px */
  size: number;
  /** ring thickness in px */
  thickness: number;
  /** surface gap between neighbouring segments (px along the ring) */
  gap?: number;
  /** highlighted segment; the others are dimmed */
  activeKey?: string | null;
  onActiveChange?: (key: string | null) => void;
  /** accessible name and description of the graphic */
  title: string;
  desc: string;
  /** centre content (HTML) */
  children?: ReactNode;
  className?: string;
}

/**
 * Multi-segment ring (donut) drawn with stroke dashes, starting at 12 o'clock, clockwise.
 * Sweeps in once on mount; hovering a segment reports it through `onActiveChange` (keyboard users
 * reach the same data through the legend next to the ring).
 */
export function RingChart({
  data,
  size,
  thickness,
  gap = 2,
  activeKey = null,
  onActiveChange,
  title,
  desc,
  children,
  className,
}: RingChartProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useChartId('ring');
  const c = size / 2;
  const r = (size - thickness) / 2;
  const len = circumference(r);
  const segments = ringSegments(
    data.map((d) => d.value),
    len,
    gap,
  );
  const rotate = `rotate(-90 ${c} ${c})`;

  return (
    <div
      // the drawn size can be overridden from CSS (e.g. a container query) through --ring-size; the
      // geometry is defined in a `size` px viewBox and scales with it
      className={cn('relative shrink-0', className)}
      style={{ width: `var(--ring-size, ${size}px)`, height: `var(--ring-size, ${size}px)` }}
    >
      <svg
        role="img"
        aria-labelledby={`${uid}-t ${uid}-d`}
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        className="block"
      >
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <defs>
          <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width={size} height={size}>
            <motion.circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={thickness + 2}
              transform={rotate}
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduced ? 0 : 1, ease: EASE_OUT, delay: reduced ? 0 : 0.1 }}
            />
          </mask>
        </defs>
        {/* track: visible where there is no data yet and behind the sweep */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--viz-grid)" strokeWidth={thickness} />
        <g mask={`url(#${uid}-m)`}>
          {segments.map((s) => {
            const d = data[s.index];
            const dimmed = activeKey !== null && activeKey !== d.key;
            return (
              <circle
                key={d.key}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${s.length} ${Math.max(0, len - s.length)}`}
                strokeDashoffset={-s.offset}
                transform={rotate}
                className="transition-opacity duration-200"
                style={{ opacity: dimmed ? 0.25 : 1 }}
                onPointerEnter={onActiveChange ? () => onActiveChange(d.key) : undefined}
                onPointerLeave={onActiveChange ? () => onActiveChange(null) : undefined}
              />
            );
          })}
        </g>
      </svg>
      {children ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[18%] text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

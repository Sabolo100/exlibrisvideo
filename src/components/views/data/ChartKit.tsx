'use client';

/**
 * Small building blocks of the stats dashboard (owner: views-data): the card shell, the hover
 * tooltip, the visually hidden data table every chart ships with, and the count-up number.
 */
import { animate, motion } from 'motion/react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';
import { clampTooltipX } from './chart-geometry';
import { useIsoLayoutEffect, usePrefersReducedMotion } from './hooks';

/** Ease-out used by every mount animation of the dashboard. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** useId() made safe for SVG `url(#…)` references and `aria-labelledby` lists. */
export function useChartId(prefix = 'chart'): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export interface DashboardCardProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** stagger of the mount animation (s) */
  delay?: number;
  children: ReactNode;
}

/** A dashboard panel: <section> named by its heading, icon medallion, optional actions. */
export function DashboardCard({ title, description, icon, actions, className, bodyClassName, delay = 0, children }: DashboardCardProps) {
  const reduced = usePrefersReducedMotion();
  const headingId = useChartId('card');
  return (
    <motion.section
      aria-labelledby={headingId}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : delay, ease: EASE_OUT }}
      className={cn('flex min-w-0 flex-col rounded-card border border-line bg-surface text-ink shadow-soft', className)}
    >
      <header className="flex items-start gap-3 px-5 pt-5 sm:px-6">
        {icon ? (
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-[1.125rem]"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-display text-lg leading-tight font-semibold text-ink">
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {/* the body is a size container: panels lay out by their own width, not the viewport's */}
      <div className={cn('@container flex min-w-0 flex-1 flex-col px-5 pt-4 pb-5 sm:px-6', bodyClassName)}>{children}</div>
    </motion.section>
  );
}

/** Muted one-line message inside a card (empty data, pending classification). */
export function CardNote({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-sm text-muted', className)}>
      {icon ? (
        <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export interface ChartTooltipProps {
  /** anchor point in px relative to the positioned chart container (tooltip sits above it) */
  x: number;
  y: number;
  containerWidth: number;
  /** the value leads … */
  value: ReactNode;
  /** … the label follows */
  label?: ReactNode;
}

/**
 * Hover / focus readout. Decorative duplicate of data that is also in the legend, the labels or
 * the hidden table, so it is hidden from assistive technology.
 */
export function ChartTooltip({ x, y, containerWidth, value, label }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(96);
  useIsoLayoutEffect(() => {
    const w = ref.current?.offsetWidth;
    if (w && Math.abs(w - width) > 0.5) setWidth(w);
  });
  const left = clampTooltipX(x, width, containerWidth);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lift"
      style={{ left, top: Math.max(0, y - 8) }}
    >
      <div className="text-sm font-semibold text-ink tabular-nums">{value}</div>
      {label ? <div className="text-muted">{label}</div> : null}
    </div>
  );
}

export interface SrTableProps {
  caption: string;
  columns: readonly string[];
  /** first cell of each row is the row header */
  rows: readonly (readonly ReactNode[])[];
}

/** The table-view twin of a chart, for screen readers. */
export function SrTable({ caption, columns, rows }: SrTableProps) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface CountUpProps {
  value: number;
  format: (value: number) => string;
  /** seconds */
  duration?: number;
  delay?: number;
}

/**
 * A number that counts up from zero when it first appears and glides to new values afterwards.
 * The final value is rendered on the server and for reduced motion; the reset to zero happens in a
 * layout effect, so there is no visible flash.
 */
export function CountUp({ value, format, duration = 0.9, delay = 0 }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  /** the number currently on screen (null before the first layout effect) */
  const current = useRef<number | null>(null);

  useIsoLayoutEffect(() => {
    const from = current.current ?? 0;
    if (reduced || !Number.isFinite(value) || from === value) {
      current.current = value;
      setShown(value);
      return;
    }
    setShown(from);
    const controls = animate(from, value, {
      duration,
      delay,
      ease: EASE_OUT,
      onUpdate: (v) => {
        current.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [value, reduced, duration, delay]);

  return <>{format(shown)}</>;
}

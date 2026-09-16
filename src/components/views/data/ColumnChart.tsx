'use client';

import { motion } from 'motion/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui';
import { barPath, countAxis, labelStride, showsLabel } from './chart-geometry';
import { ChartTooltip, EASE_OUT, useChartId } from './ChartKit';
import { useElementSize, usePrefersReducedMotion } from './hooks';
import { BAR_COLOR, BAR_HOVER_COLOR } from './palette';

export interface ColumnDatum {
  key: string;
  value: number;
  /** full label: tooltip and accessible name */
  label: string;
  /** x-axis label */
  shortLabel: string;
  /** CSS colour; defaults to the single-series bar colour */
  color?: string;
  /** clicking the column (only offered when value > 0) */
  onSelect?: () => void;
}

export interface ColumnChartProps {
  data: readonly ColumnDatum[];
  /** accessible name and description of the graphic */
  title: string;
  desc: string;
  /** accessible name of the column buttons group */
  groupLabel: string;
  /** "12 books" – tooltip value and accessible names */
  formatValue: (value: number) => string;
  /** "12" – axis ticks and cap labels */
  formatNumber: (value: number) => string;
  /** accessible name of a clickable column, e.g. "1960s: 12 books – show on the shelf" */
  actionLabel?: (datum: ColumnDatum) => string;
  plotHeight?: number;
  /** horizontal gridlines with y tick labels */
  axis?: boolean;
  /** value labels on column caps */
  capLabels?: 'max' | 'all' | 'none';
  /** hairline before these column indices (e.g. where century bins give way to decades) */
  separators?: readonly number[];
  /**
   * How the hovered / focused column responds: `accent` recolours it (single-series charts),
   * `dim` fades the others (columns whose colour carries meaning).
   */
  highlight?: 'accent' | 'dim';
  className?: string;
  delay?: number;
}

const TOP = 22;
const AXIS_BAND = 24;
const FONT_CHAR_PX = 6.4;
const MAX_BAR = 24;

/**
 * Vertical columns from one baseline, thin (≤ 24 px) with rounded caps. Hover or keyboard focus
 * shows the value; columns form one tab stop (arrow keys move between them).
 */
export function ColumnChart({
  data,
  title,
  desc,
  groupLabel,
  formatValue,
  formatNumber,
  actionLabel,
  plotHeight = 160,
  axis = true,
  capLabels = 'max',
  separators = [],
  highlight = 'accent',
  className,
  delay = 0,
}: ColumnChartProps) {
  const reduced = usePrefersReducedMotion();
  const uid = useChartId('columns');
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const width = size?.width ?? 0;
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonsRef = useRef<(HTMLElement | null)[]>([]);

  const count = data.length;
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const scale = countAxis(maxValue, 4);
  const tickWidth = axis ? Math.max(...scale.ticks.map((v) => formatNumber(v).length)) * FONT_CHAR_PX + 10 : 0;
  const left = axis ? tickWidth : 0;
  const plotWidth = Math.max(0, width - left);
  const slot = count > 0 ? plotWidth / count : 0;
  const barWidth = Math.max(3, Math.min(MAX_BAR, slot * 0.62));
  const yOf = (v: number) => TOP + plotHeight - (scale.top > 0 ? (v / scale.top) * plotHeight : 0);
  const longestLabel = Math.max(0, ...data.map((d) => d.shortLabel.length));
  const stride = labelStride(longestLabel * FONT_CHAR_PX, slot);
  const maxIndex = data.findIndex((d) => d.value === maxValue && maxValue > 0);
  const interactive = data.some((d) => d.onSelect);
  const tabIndexAt = Math.min(Math.max(0, focusIndex), Math.max(0, count - 1));
  const height = TOP + plotHeight + AXIS_BAND;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(count - 1, tabIndexAt + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, tabIndexAt - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div ref={measureRef} className={cn('relative w-full', className)} style={{ height }}>
      {width > 0 && count > 0 ? (
        <>
          <svg role="img" aria-labelledby={`${uid}-t ${uid}-d`} width={width} height={height} className="block overflow-visible">
            <title id={`${uid}-t`}>{title}</title>
            <desc id={`${uid}-d`}>{desc}</desc>
            {axis
              ? scale.ticks.map((v) => (
                  <g key={v}>
                    <line
                      x1={left}
                      x2={width}
                      y1={yOf(v)}
                      y2={yOf(v)}
                      stroke={v === 0 ? 'var(--line)' : 'var(--viz-grid)'}
                      strokeWidth={1}
                      shapeRendering="crispEdges"
                    />
                    <text x={left - 8} y={yOf(v)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                      {formatNumber(v)}
                    </text>
                  </g>
                ))
              : (
                  <line x1={0} x2={width} y1={yOf(0)} y2={yOf(0)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
                )}
            {separators
              .filter((i) => i > 0 && i < count)
              .map((i) => (
                <line
                  key={`sep-${i}`}
                  x1={left + slot * i}
                  x2={left + slot * i}
                  y1={TOP - 6}
                  y2={TOP + plotHeight + 6}
                  stroke="var(--line)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              ))}
            {data.map((d, i) => {
              const cx = left + slot * i + slot / 2;
              const h = TOP + plotHeight - yOf(d.value);
              const path = barPath({ x: cx - barWidth / 2, y: yOf(d.value), width: barWidth, height: h }, 4, 'up');
              if (!path) return null;
              const lifted = active === i;
              return (
                // the group carries the grow animation (motion snapshots style values of its own element),
                // the plain path keeps its colour reactive to hover / focus
                <motion.g
                  key={d.key}
                  style={{ originX: 0.5, originY: 1 }}
                  initial={reduced ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: reduced ? 0 : 0.65, delay: reduced ? 0 : delay + Math.min(0.45, i * 0.03), ease: EASE_OUT }}
                >
                  <path
                    d={path}
                    style={{
                      fill: lifted && highlight === 'accent' ? BAR_HOVER_COLOR : (d.color ?? BAR_COLOR),
                      opacity: highlight === 'dim' && active !== null && !lifted ? 0.4 : 1,
                    }}
                    className="transition-[fill,opacity] duration-150"
                  />
                </motion.g>
              );
            })}
            {data.map((d, i) => {
              const cap = capLabels === 'all' ? d.value > 0 : capLabels === 'max' ? i === maxIndex : false;
              if (!cap) return null;
              return (
                <text
                  key={`cap-${d.key}`}
                  x={left + slot * i + slot / 2}
                  y={yOf(d.value) - 6}
                  textAnchor="middle"
                  className="fill-ink text-[11px] font-semibold tabular-nums"
                >
                  {formatNumber(d.value)}
                </text>
              );
            })}
            {data.map((d, i) => {
              if (!showsLabel(i, count, stride)) return null;
              const cx = left + slot * i + slot / 2;
              const estimate = d.shortLabel.length * FONT_CHAR_PX;
              const anchor = cx + estimate / 2 > width ? 'end' : cx - estimate / 2 < 0 ? 'start' : 'middle';
              const x = anchor === 'end' ? width : anchor === 'start' ? 0 : cx;
              return (
                <text
                  key={`x-${d.key}`}
                  x={x}
                  y={TOP + plotHeight + 16}
                  textAnchor={anchor}
                  className="fill-muted text-[11px] tabular-nums"
                >
                  {d.shortLabel}
                </text>
              );
            })}
          </svg>

          {interactive ? (
            <div
              role="group"
              aria-label={groupLabel}
              className="absolute"
              style={{ left, top: 0, width: plotWidth, height: TOP + plotHeight + AXIS_BAND }}
              onKeyDown={onKeyDown}
            >
              {data.map((d, i) => {
                const enabled = Boolean(d.onSelect) && d.value > 0;
                return (
                  <button
                    key={d.key}
                    ref={(el) => {
                      buttonsRef.current[i] = el;
                    }}
                    type="button"
                    tabIndex={i === tabIndexAt ? 0 : -1}
                    aria-disabled={enabled ? undefined : true}
                    aria-label={enabled && actionLabel ? actionLabel(d) : `${d.label}: ${formatValue(d.value)}`}
                    className={cn('absolute top-0 h-full rounded-md outline-offset-[-2px]', enabled ? 'cursor-pointer' : 'cursor-default')}
                    style={{ left: slot * i, width: slot }}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive((cur) => (cur === i ? null : cur))}
                    onFocus={() => {
                      setActive(i);
                      setFocusIndex(i);
                    }}
                    onBlur={() => setActive((cur) => (cur === i ? null : cur))}
                    onClick={() => {
                      if (enabled) d.onSelect?.();
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div aria-hidden="true" className="absolute" style={{ left, top: 0, width: plotWidth, height: TOP + plotHeight }}>
              {data.map((d, i) => (
                <div
                  key={d.key}
                  className="absolute top-0 h-full"
                  style={{ left: slot * i, width: slot }}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((cur) => (cur === i ? null : cur))}
                />
              ))}
            </div>
          )}

          {active !== null && data[active] ? (
            <ChartTooltip
              x={left + slot * active + slot / 2}
              y={yOf(data[active].value)}
              containerWidth={width}
              value={formatValue(data[active].value)}
              label={data[active].label}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

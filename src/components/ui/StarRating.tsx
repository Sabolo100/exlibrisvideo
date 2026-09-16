'use client';

import { Star } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';

export interface StarRatingProps {
  /** 0–5 (fractions allowed in read-only mode); null = not rated */
  value: number | null;
  /** makes it interactive */
  onChange?: (value: number | null) => void;
  /** clicking the current value (or pressing 0 / Delete) clears the rating (default true) */
  allowClear?: boolean;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  /** accessible name of the group (default "Értékelés") */
  label?: string;
  /** show "4 / 5" text next to the stars in read-only mode */
  showValue?: boolean;
  disabled?: boolean;
  className?: string;
}

const PX = { sm: 14, md: 20, lg: 28 } as const;

function StarGlyph({ fill, px }: { fill: number; px: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: px, height: px }} aria-hidden="true">
      <Star
        width={px}
        height={px}
        strokeWidth={1.6}
        className="absolute inset-0 text-[color-mix(in_oklab,var(--line),var(--ink)_25%)]"
      />
      {/* Always rendered (width 0 when empty): removing this node between mousedown and mouseup
          swallowed the click in Chromium. */}
      <span
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
      >
        <Star
          width={px}
          height={px}
          strokeWidth={1.6}
          className="fill-accent text-accent drop-shadow-[0_1px_0_rgb(120_80_20/0.25)]"
        />
      </span>
    </span>
  );
}

/**
 * Five-star rating. Read-only by default; with `onChange` it becomes a radio group
 * (arrow keys, Home/End, 0 or Delete clears, hover preview).
 */
export function StarRating({
  value,
  onChange,
  allowClear = true,
  max = 5,
  size = 'md',
  label,
  showValue = false,
  disabled = false,
  className,
}: StarRatingProps) {
  const { t, tp, n } = useUiTranslator();
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const px = PX[size];
  const current = value ?? 0;
  const name = label ?? t('common.rating.label');

  if (!onChange) {
    const text = value ? t('common.rating.value', { value: n(Math.round(value * 10) / 10) }) : t('common.rating.none');
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)}>
        <span role="img" aria-label={`${name}: ${text}`} className="inline-flex items-center gap-0.5">
          {Array.from({ length: max }, (_, i) => (
            <StarGlyph key={i} px={px} fill={current - i} />
          ))}
        </span>
        {showValue && value ? <span className="text-[0.8125rem] text-muted tabular-nums">{n(value)} / {max}</span> : null}
      </span>
    );
  }

  const set = (next: number | null, focus = false) => {
    if (disabled) return;
    onChange(next);
    if (focus && next) refs.current[next - 1]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let next: number | null | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(max, current + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current <= 1 ? (allowClear ? null : 1) : current - 1;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = max;
    else if (allowClear && (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace')) next = null;
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= max) next = Number(e.key);
    if (next === undefined) return;
    e.preventDefault();
    set(next, true);
    if (next === null) refs.current[0]?.focus();
  };

  const shown = hover ?? current;

  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-disabled={disabled || undefined}
      className={cn('inline-flex items-center', disabled && 'opacity-50', className)}
      onPointerLeave={() => setHover(null)}
    >
      {Array.from({ length: max }, (_, i) => {
        const starValue = i + 1;
        const checked = Math.round(current) === starValue;
        const focusable = checked || (current === 0 && i === 0);
        return (
          <button
            key={starValue}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={tp('common.rating.star', starValue)}
            tabIndex={focusable ? 0 : -1}
            disabled={disabled}
            onPointerEnter={() => setHover(starValue)}
            onFocus={(e) => {
              // A mousedown focuses the star too; clearing the preview there used to drop the click.
              if (e.currentTarget.matches(':focus-visible')) setHover(null);
            }}
            onClick={() => set(allowClear && checked ? null : starValue)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center rounded-md p-0.5 transition-transform duration-150',
              'hover:scale-110 active:scale-95 disabled:cursor-not-allowed',
            )}
          >
            <StarGlyph px={px} fill={shown >= starValue ? 1 : 0} />
          </button>
        );
      })}
    </div>
  );
}

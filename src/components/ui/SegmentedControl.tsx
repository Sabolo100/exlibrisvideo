'use client';

import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** tooltip-ish title; also the accessible name when `iconOnly` */
  title?: string;
  /** explicit accessible name (e.g. "Magyar" for a visible "HU") */
  ariaLabel?: string;
  /** lang attribute of the label (language switches) */
  lang?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** accessible name of the group */
  'aria-label': string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** hide labels visually (they stay as aria-labels; pass `title` or a string label) */
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * One-of-many switch with a sliding thumb (role="radiogroup", arrow keys move and select).
 * e.g. reading status, view density, theme.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  size = 'md',
  fullWidth = false,
  iconOnly = false,
  className,
  disabled = false,
}: SegmentedControlProps<T>) {
  const layoutId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    const enabled = options.map((o, i) => (!o.disabled && !disabled ? i : -1)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    let next: number;
    if (dir === 'first') next = enabled[0];
    else if (dir === 'last') next = enabled[enabled.length - 1];
    else {
      const pos = enabled.indexOf(from);
      next = pos < 0 ? enabled[0] : enabled[(pos + dir + enabled.length) % enabled.length];
    }
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = e.key;
    if (key === 'ArrowRight' || key === 'ArrowDown') move(index, 1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp') move(index, -1);
    else if (key === 'Home') move(index, 'first');
    else if (key === 'End') move(index, 'last');
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn(
        'relative inline-flex items-stretch gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5',
        // full width: never let long labels widen the parent (grid/flex blow-out on phones) – they truncate
        fullWidth && 'flex w-full [contain:inline-size]',
        className,
      )}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        const focusable = selected || (selectedIndex < 0 && i === 0);
        const accessibleName = iconOnly ? (o.title ?? (typeof o.label === 'string' ? o.label : undefined)) : undefined;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel ?? accessibleName}
            lang={o.lang}
            title={o.title ?? (fullWidth && typeof o.label === 'string' ? o.label : undefined)}
            tabIndex={focusable ? 0 : -1}
            disabled={o.disabled || disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[0.625rem] font-medium whitespace-nowrap',
              'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-xs [&_svg]:size-3.5' : 'h-9 px-3.5 text-sm [&_svg]:size-4',
              iconOnly && (size === 'sm' ? 'w-7 px-0' : 'w-9 px-0'),
              fullWidth && 'flex-1 basis-0',
              selected ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`seg-${layoutId}`}
                aria-hidden="true"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                className="absolute inset-0 rounded-[0.625rem] border border-line bg-surface shadow-[0_1px_2px_hsl(var(--shadow-color)/0.14)]"
              />
            ) : null}
            {o.icon ? <span className="relative inline-flex">{o.icon}</span> : null}
            {!iconOnly ? <span className="relative truncate">{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

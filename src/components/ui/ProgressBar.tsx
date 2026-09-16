'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { useMounted, useUiTranslator } from './hooks';

export type ProgressTone = 'primary' | 'gold' | 'success' | 'danger';

const FILL: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  gold: 'bg-[linear-gradient(90deg,#c99a45,#e6c47e,#c99a45)]',
  success: 'bg-success',
  danger: 'bg-danger',
};

export interface ProgressBarProps {
  /** 0–100; omit (or set `indeterminate`) for an unknown amount */
  value?: number | null;
  indeterminate?: boolean;
  tone?: ProgressTone;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** accessible name (defaults to "Folyamat") */
  label?: string;
  /** visible label row above the bar */
  showLabel?: boolean;
  /** show "42%" at the right of the label row */
  showValue?: boolean;
  /** extra text in the label row (e.g. "12 / 48 képkocka") */
  detail?: ReactNode;
  className?: string;
}

const HEIGHT = { xs: 'h-1', sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' } as const;

/** Linear progress – determinate (animated width) or indeterminate (sliding shimmer). */
export function ProgressBar({
  value,
  indeterminate,
  tone = 'primary',
  size = 'md',
  label,
  showLabel = false,
  showValue = false,
  detail,
  className,
}: ProgressBarProps) {
  const { t, n } = useUiTranslator();
  const prefersReduced = useReducedMotion();
  // hydration-safe: the server never knows the preference
  const reduced = useMounted() && Boolean(prefersReduced);
  const isIndeterminate = indeterminate || value === undefined || value === null || Number.isNaN(value);
  const pct = isIndeterminate ? 0 : Math.min(100, Math.max(0, value as number));
  const name = label ?? t('common.aria.progress');

  return (
    <div className={cn('w-full', className)}>
      {showLabel || showValue || detail ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem]">
          <span className={cn('min-w-0 truncate text-ink', !showLabel && 'sr-only')}>{name}</span>
          <span className="flex shrink-0 items-baseline gap-2 text-muted tabular-nums">
            {detail}
            {showValue && !isIndeterminate ? <span className="font-medium text-ink">{n(Math.round(pct))}%</span> : null}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={isIndeterminate ? undefined : 0}
        aria-valuemax={isIndeterminate ? undefined : 100}
        aria-valuenow={isIndeterminate ? undefined : Math.round(pct)}
        aria-busy={isIndeterminate || undefined}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--line),var(--surface-2)_40%)] shadow-[inset_0_1px_1px_hsl(var(--shadow-color)/0.12)]',
          HEIGHT[size],
        )}
      >
        {isIndeterminate ? (
          reduced ? (
            <div
              className={cn('absolute inset-0 rounded-full opacity-45', FILL[tone])}
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.35) 0 6px, transparent 6px 12px)',
              }}
            />
          ) : (
            <motion.div
              className={cn('absolute inset-y-0 left-0 w-2/5 rounded-full', FILL[tone])}
              initial={{ x: '-100%' }}
              animate={{ x: '250%' }}
              transition={{ duration: 1.4, ease: [0.45, 0, 0.55, 1], repeat: Infinity }}
            />
          )
        ) : (
          <motion.div
            className={cn('h-full rounded-full', FILL[tone])}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        )}
      </div>
    </div>
  );
}

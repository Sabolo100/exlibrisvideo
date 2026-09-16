'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';
import type { ProgressTone } from './ProgressBar';

const STROKE: Record<ProgressTone, string> = {
  primary: 'var(--primary)',
  gold: 'var(--accent)',
  success: 'var(--success)',
  danger: 'var(--danger)',
};

export interface ProgressRingProps {
  /** 0–100; null/undefined → indeterminate spinning arc */
  value?: number | null;
  /** diameter in px */
  size?: number;
  /** stroke width in px (default size / 10) */
  thickness?: number;
  tone?: ProgressTone;
  label?: string;
  /** centre content; defaults to "42%" when `showValue` */
  children?: ReactNode;
  showValue?: boolean;
  className?: string;
}

/** Circular progress, e.g. the reading-status ring on the stats view. */
export function ProgressRing({
  value,
  size = 64,
  thickness,
  tone = 'primary',
  label,
  children,
  showValue = false,
  className,
}: ProgressRingProps) {
  const { t, n } = useUiTranslator();
  const stroke = thickness ?? Math.max(3, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const indeterminate = value === undefined || value === null || Number.isNaN(value);
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, value));
  const name = label ?? t('common.aria.progress');

  return (
    <div
      role="progressbar"
      aria-label={name}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('-rotate-90', indeterminate && 'animate-spin')} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: indeterminate ? circumference * 0.72 : circumference * (1 - pct / 100) }}
          transition={{ type: 'spring', stiffness: 90, damping: 22 }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-center">
        {children ??
          (showValue && !indeterminate ? (
            <span className="font-display font-semibold text-ink tabular-nums" style={{ fontSize: Math.max(11, size * 0.24) }}>
              {n(Math.round(pct))}%
            </span>
          ) : null)}
      </span>
    </div>
  );
}

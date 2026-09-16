'use client';

import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** ≥ 0.8 high, ≥ 0.6 medium (the pipeline's needs-review threshold), otherwise low. */
export function confidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.8) return 'high';
  if (value >= 0.6) return 'medium';
  return 'low';
}

export interface ConfidenceMeterProps {
  /** 0..1 */
  value: number;
  /** show "Magas (92%)" next to the bars */
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const COLOR: Record<ConfidenceLevel, string> = {
  high: 'bg-success',
  medium: 'bg-warning',
  low: 'bg-danger',
};

/** Five ascending bars (like a signal meter) for recognition confidence. */
export function ConfidenceMeter({ value, showLabel = false, size = 'md', className }: ConfidenceMeterProps) {
  const { t, n } = useUiTranslator();
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const level = confidenceLevel(v);
  const filled = Math.max(1, Math.round(v * 5));
  const percent = Math.round(v * 100);
  const text = t('common.confidence.value', { level: t(`common.confidence.${level}`), percent: n(percent) });
  const barW = size === 'sm' ? 'w-[3px]' : 'w-1';
  const maxH = size === 'sm' ? 12 : 16;

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        role="meter"
        aria-label={t('common.confidence.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        className="inline-flex items-end gap-[2px]"
        style={{ height: maxH }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn('rounded-[1px]', barW, i < filled ? COLOR[level] : 'bg-[color-mix(in_oklab,var(--line),var(--ink)_12%)]')}
            style={{ height: Math.round(maxH * (0.36 + i * 0.16)) }}
          />
        ))}
      </span>
      {showLabel ? <span className={cn('text-muted tabular-nums', size === 'sm' ? 'text-xs' : 'text-[0.8125rem]')}>{text}</span> : null}
    </span>
  );
}

import type { ReactNode } from 'react';
import { cn } from './cn';

export interface StatProps {
  label: ReactNode;
  /** already formatted value (use n() from useI18n) */
  value: ReactNode;
  /** small line under the value */
  hint?: ReactNode;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** accent colour for the icon medallion */
  tone?: 'neutral' | 'green' | 'gold';
  /** framed card look */
  framed?: boolean;
  className?: string;
}

const VALUE_SIZE = { sm: 'text-xl', md: 'text-3xl', lg: 'text-5xl' } as const;

/** Big number with a label – counts in headers and the stats dashboard. */
export function Stat({ label, value, hint, icon, size = 'md', tone = 'gold', framed = false, className }: StatProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-3',
        framed && 'rounded-card border border-line bg-surface p-4 shadow-soft',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5',
            tone === 'gold' && 'bg-accent-soft text-accent',
            tone === 'green' && 'bg-[color-mix(in_oklab,var(--primary)_12%,var(--surface))] text-primary',
            tone === 'neutral' && 'bg-surface-2 text-muted',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="text-xs font-medium tracking-[0.06em] text-muted uppercase">{label}</div>
        <div className={cn('mt-0.5 font-display leading-none font-semibold text-ink tabular-nums', VALUE_SIZE[size])}>{value}</div>
        {hint ? <div className="mt-1.5 text-[0.8125rem] text-muted">{hint}</div> : null}
      </div>
    </div>
  );
}

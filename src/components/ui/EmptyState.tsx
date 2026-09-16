import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** lucide icon element; defaults to a small empty-shelf illustration */
  icon?: ReactNode;
  /** primary / secondary actions */
  action?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/** Empty shelf with a single leaning book – the default EmptyState illustration. */
export function EmptyShelfIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 72" className={className} aria-hidden="true" fill="none">
      <rect x="6" y="58" width="108" height="7" rx="1.5" fill="var(--wood)" />
      <rect x="6" y="58" width="108" height="2" rx="1" fill="var(--wood-light)" />
      <rect x="6" y="65" width="108" height="3" rx="1" fill="var(--wood-dark)" opacity="0.6" />
      <g transform="rotate(-14 70 58)">
        <rect x="62" y="16" width="13" height="42" rx="1.5" fill="var(--primary)" />
        <rect x="62" y="22" width="13" height="1.6" fill="var(--accent)" />
        <rect x="62" y="50" width="13" height="1.6" fill="var(--accent)" />
        <rect x="66.5" y="28" width="4" height="17" rx="1" fill="var(--primary-ink)" opacity="0.55" />
      </g>
      <rect x="44" y="30" width="11" height="28" rx="1.5" fill="var(--burgundy)" opacity="0.9" />
      <rect x="44" y="35" width="11" height="1.4" fill="var(--accent)" opacity="0.9" />
      <path d="M92 20c3-4 8-4 10 0M96 12c2-3 5-3 7 0" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** Friendly placeholder for empty lists, no search results, missing data. */
export function EmptyState({ title, description, icon, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-accent-soft text-accent',
            size === 'sm' ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-7',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : (
        <EmptyShelfIllustration className={size === 'sm' ? 'h-12 w-auto' : 'h-20 w-auto'} />
      )}
      <div className="max-w-md">
        <h3 className={cn('font-display font-semibold text-ink text-balance', size === 'sm' ? 'text-base' : 'text-xl')}>
          {title}
        </h3>
        {description ? (
          <p className={cn('mt-1.5 text-muted text-pretty', size === 'sm' ? 'text-[0.8125rem]' : 'text-sm')}>{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

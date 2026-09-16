'use client';

import { cn } from './cn';
import { useUiTranslator } from './hooks';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const PX: Record<SpinnerSize, number> = { xs: 12, sm: 16, md: 20, lg: 32, xl: 48 };

export interface SpinnerProps {
  size?: SpinnerSize;
  /** screen-reader text; defaults to "Betöltés…" / "Loading…" */
  label?: string;
  /** purely visual (inside a busy button etc.) – no role/status text */
  decorative?: boolean;
  className?: string;
}

/** Circular loading indicator in the current text colour. */
export function Spinner({ size = 'md', label, decorative = false, className }: SpinnerProps) {
  const { t } = useUiTranslator();
  const px = PX[size];
  const svg = (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 animate-spin', decorative && className)}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
  if (decorative) return svg;
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      {svg}
      <span className="sr-only">{label ?? t('common.state.loading')}</span>
    </span>
  );
}

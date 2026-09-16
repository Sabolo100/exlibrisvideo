import Link from 'next/link';
import { cn } from '@/components/ui/cn';

/** The bookplate mark: an ex libris label with three spines on a gilt shelf; the middle spine carries a play mark. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 36"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* plate with notched corners */}
      <path
        d="M6.5 1.5h19a5 5 0 0 0 5 5v23a5 5 0 0 0-5 5h-19a5 5 0 0 0-5-5v-23a5 5 0 0 0 5-5Z"
        fill="var(--primary)"
      />
      <path
        d="M8 4h16a4.5 4.5 0 0 0 4 4v20a4.5 4.5 0 0 0-4 4H8a4.5 4.5 0 0 0-4-4V8a4.5 4.5 0 0 0 4-4Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="0.9"
        opacity="0.9"
      />
      {/* spines */}
      <rect x="8.6" y="12.2" width="4" height="14.8" rx="0.6" fill="var(--primary-ink)" opacity="0.92" />
      <rect x="8.6" y="14" width="4" height="0.8" fill="var(--primary)" opacity="0.55" />
      <rect x="13.6" y="9" width="5.6" height="18" rx="0.7" fill="var(--primary-ink)" />
      <rect x="13.6" y="10.8" width="5.6" height="1" fill="var(--accent)" />
      <rect x="13.6" y="24.2" width="5.6" height="1" fill="var(--accent)" />
      <path d="M15.3 15.4v5.2l4-2.6Z" transform="translate(-0.4 0)" fill="var(--primary)" />
      <rect x="21.2" y="13.2" width="3.6" height="14.4" rx="0.6" fill="var(--primary-ink)" opacity="0.8" transform="rotate(9 23 27.4)" />
      {/* gilt shelf */}
      <rect x="6.8" y="27.2" width="18.4" height="1.5" rx="0.5" fill="var(--accent)" />
    </svg>
  );
}

export interface LogoProps {
  /** hide the wordmark (mark only) */
  markOnly?: boolean;
  size?: 'sm' | 'md';
  href?: string;
  /** accessible name of the link */
  label?: string;
  className?: string;
}

/** Bookplate mark + "Ex Libris Video" wordmark, linking home. */
export function Logo({ markOnly = false, size = 'md', href = '/', label = 'Ex Libris Video', className }: LogoProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn('group inline-flex items-center gap-2.5 rounded-md text-ink', className)}
    >
      <LogoMark className={cn('transition-transform duration-300 group-hover:-rotate-3', size === 'sm' ? 'h-7 w-auto' : 'h-9 w-auto')} />
      {!markOnly ? (
        <span className={cn('font-display leading-none tracking-[-0.01em] whitespace-nowrap', size === 'sm' ? 'text-base' : 'text-[1.3125rem]')}>
          <span className="font-semibold">Ex Libris</span>{' '}
          <span className="font-normal text-accent italic">Video</span>
        </span>
      ) : null}
    </Link>
  );
}

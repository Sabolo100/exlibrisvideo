'use client';

/** Translucent top app bar (status-bar safe area, 56 px row): leading control, title, trailing actions. */
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';

export interface AppTopBarProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  /** row under the bar (search field, segmented control …) */
  below?: ReactNode;
  className?: string;
}

export function AppTopBar({ title, subtitle, leading, actions, below, className }: AppTopBarProps) {
  return (
    <header className={cn('app-chrome app-glass relative z-30 shrink-0 border-b border-line/70 pt-safe', className)}>
      <div className="flex h-14 items-center gap-1 pr-safe pl-safe">
        <div className="flex min-w-11 shrink-0 items-center justify-start pl-1">{leading}</div>
        <div className="min-w-0 flex-1 px-1 text-center">
          {title ? <h1 className="truncate font-display text-[1.0625rem] leading-tight font-semibold text-ink">{title}</h1> : null}
          {subtitle ? <p className="truncate text-[0.75rem] leading-tight text-muted">{subtitle}</p> : null}
        </div>
        <div className="flex min-w-11 shrink-0 items-center justify-end gap-0.5 pr-1">{actions}</div>
      </div>
      {below}
    </header>
  );
}

/** 44 × 44 touch target for top bar icons. */
export function AppBarButton({
  label,
  icon,
  onClick,
  href,
  active,
  className,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  className?: string;
}) {
  const classes = cn(
    'relative inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors active:bg-surface-2 [&_svg]:size-[22px]',
    active && 'bg-surface-2 text-primary',
    className,
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} className={classes}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={classes}>
      {icon}
    </button>
  );
}

/** Back chevron: history back when there is history inside the app, otherwise `fallbackHref`. */
export function AppBackButton({ fallbackHref = '/' }: { fallbackHref?: string }) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <AppBarButton
      label={t('app.back')}
      icon={<ChevronLeft className="-ml-0.5 !size-7" strokeWidth={2.2} />}
      onClick={() => {
        const internal = document.referrer.startsWith(window.location.origin) && window.history.length > 1;
        if (internal) router.back();
        else router.push(fallbackHref);
      }}
    />
  );
}

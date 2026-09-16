'use client';

/**
 * Bottom tab bar (home-indicator safe area). Items are links or buttons; an optional raised centre
 * action (the record button) sits between them like a native FAB tab.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';

export interface AppTab {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  /** small count bubble */
  badge?: number;
}

export interface AppTabBarProps {
  tabs: readonly AppTab[];
  /** raised centre action, inserted in the middle of the tabs */
  center?: ReactNode;
  className?: string;
  label: string;
}

function TabInner({ tab }: { tab: AppTab }) {
  return (
    <>
      <span
        className={cn(
          'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 [&_svg]:size-[22px]',
          tab.active ? 'bg-accent-soft text-primary' : 'text-muted',
        )}
      >
        {tab.icon}
        {tab.badge ? (
          <span className="absolute -top-1 right-1.5 min-w-[18px] rounded-full bg-burgundy px-1 text-center text-[0.625rem] leading-[18px] font-semibold text-white tabular-nums">
            {tab.badge > 99 ? '99+' : tab.badge}
          </span>
        ) : null}
      </span>
      <span className={cn('mt-0.5 max-w-full truncate text-[0.6875rem] leading-tight', tab.active ? 'font-semibold text-ink' : 'text-muted')}>
        {tab.label}
      </span>
    </>
  );
}

export function AppTabBar({ tabs, center, className, label }: AppTabBarProps) {
  const half = Math.ceil(tabs.length / 2);
  const renderTab = (tab: AppTab) => {
    const classes = 'flex min-w-0 flex-1 flex-col items-center justify-center pt-1.5 pb-1 active:opacity-70';
    const common = { 'aria-current': tab.active ? ('page' as const) : undefined };
    return tab.href ? (
      <Link key={tab.key} href={tab.href} className={classes} {...common}>
        <TabInner tab={tab} />
      </Link>
    ) : (
      <button key={tab.key} type="button" onClick={tab.onClick} className={classes} {...common}>
        <TabInner tab={tab} />
      </button>
    );
  };
  return (
    <nav aria-label={label} className={cn('app-chrome app-glass relative z-30 shrink-0 border-t border-line/70 pb-safe', className)}>
      <div className="flex h-16 items-stretch pr-safe pl-safe">
        {center ? (
          <>
            {tabs.slice(0, half).map(renderTab)}
            <div className="flex w-20 shrink-0 items-start justify-center">{center}</div>
            {tabs.slice(half).map(renderTab)}
          </>
        ) : (
          tabs.map(renderTab)
        )}
      </div>
    </nav>
  );
}

/** Raised circular centre action (record). */
export function AppFab({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="-mt-5 flex size-[60px] items-center justify-center rounded-full bg-primary text-primary-ink shadow-[0_8px_24px_-6px_hsl(var(--shadow-color)/0.55)] ring-4 ring-bg transition-transform duration-150 active:scale-95 [&_svg]:size-7"
    >
      {icon}
    </button>
  );
}

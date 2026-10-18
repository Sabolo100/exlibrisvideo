'use client';

/**
 * Bottom tab bar (home-indicator safe area). Items are links or buttons; an optional raised centre
 * action (the record button) sits between them like a native FAB tab.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';
import { AppSubmenuSlot, useAppSubmenuActive } from './AppSubmenu';

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
            <div className={cn('flex shrink-0 items-start justify-center', tabs.length ? 'w-20' : 'flex-1')}>{center}</div>
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

/**
 * The catalogue's bottom menu: every view in one strip the thumb can swipe sideways, sliding behind the fixed
 * + button in the middle (owners); the active view's submenu (<AppSubmenu>) sits glued on top of it.
 * At rest two tabs stand on each side of the + button (the strip starts with a gap exactly under it);
 * the active tab is scrolled out from under the button when it changes. Small chevrons at the edges tell
 * that more tabs wait on that side. `submenuTrailing` is pinned to the right end of the submenu strip
 * (the scan picker) and keeps the strip visible in views without options of their own.
 */
export function AppViewBar({
  tabs,
  fab,
  label,
  submenuLabel,
  submenuTrailing,
}: {
  tabs: readonly AppTab[];
  /** the + button (fixed in the middle; the strip passes behind it) */
  fab?: ReactNode;
  label: string;
  submenuLabel: string;
  /** pinned to the right end of the submenu strip */
  submenuTrailing?: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeKey = tabs.find((tab) => tab.active)?.key ?? null;
  const submenu = useAppSubmenuActive() || Boolean(submenuTrailing);
  const [edges, setEdges] = useState({ left: false, right: false });

  // which ends of the strip still hide tabs
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const left = el.scrollLeft > 4;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tabs.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const el = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!scroller || !el) return;
    const box = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const half = fab ? FAB_ZONE / 2 : 0;
    let delta = 0;
    if (r.left < box.left) delta = r.left - box.left - 8;
    else if (r.right > box.right) delta = r.right - box.right + 8;
    else if (fab && r.right > mid - half && r.left < mid + half) delta = (r.left + r.right) / 2 < mid ? r.right - (mid - half) : r.left - (mid + half);
    if (delta !== 0) scroller.scrollBy({ left: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [activeKey, fab]);

  // two tabs on each side of the + button at rest; without it five tabs share the width
  const itemStyle = fab ? { flex: `0 0 calc((50% - ${FAB_ZONE / 2}px) / 2)` } : { flex: `0 0 ${tabs.length <= 5 ? 100 / Math.max(1, tabs.length) : 20}%` };
  const renderTab = (tab: AppTab) => (
    <button
      key={tab.key}
      type="button"
      onClick={tab.onClick}
      aria-current={tab.active ? 'page' : undefined}
      className="flex min-w-0 flex-col items-center justify-center pt-1.5 pb-1 active:opacity-70"
      style={itemStyle}
    >
      <TabInner tab={tab} />
    </button>
  );

  return (
    <nav aria-label={label} className="app-chrome app-glass relative z-30 shrink-0 border-t border-line/70 pb-safe">
      <AppSubmenuSlot label={submenuLabel} className="border-b border-black/10" trailing={submenuTrailing} />
      <div className="relative h-16 pr-safe pl-safe">
        {tabs.length > 0 ? (
          <div ref={scrollerRef} className={cn('app-scroll flex h-full overflow-x-auto overscroll-x-contain', fab && 'app-view-strip')}>
            {fab ? (
              <>
                {tabs.slice(0, 2).map(renderTab)}
                <span aria-hidden="true" className="shrink-0" style={{ flex: `0 0 ${FAB_ZONE}px` }} />
                {tabs.slice(2).map(renderTab)}
              </>
            ) : (
              tabs.map(renderTab)
            )}
          </div>
        ) : null}
        {tabs.length > 0 ? (
          <>
            <EdgeHint side="left" shown={edges.left} />
            <EdgeHint side="right" shown={edges.right} />
          </>
        ) : null}
        {fab ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center transition-transform duration-200',
              !submenu && tabs.length > 0 && '-translate-y-3.5',
            )}
          >
            <div className="pointer-events-auto">{fab}</div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/** A small chevron at an end of the strip: more tabs are waiting on that side. */
function EdgeHint({ side, shown }: { side: 'left' | 'right'; shown: boolean }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-0 flex h-10 w-5 items-center text-muted transition-opacity duration-200 [&_svg]:size-4',
        side === 'left' ? 'left-0 justify-start pl-0.5' : 'right-0 justify-end pr-0.5',
        shown ? 'opacity-80' : 'opacity-0',
      )}
    >
      <Icon strokeWidth={2.5} />
    </span>
  );
}

/** width kept free for the + button in the middle of the strip (px) */
const FAB_ZONE = 76;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The + button of the catalogue's bottom menu (sits inside the bar; raised a little when no submenu is shown). */
export function AppViewFab({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-[58px] items-center justify-center rounded-full bg-primary text-primary-ink shadow-[0_8px_24px_-6px_hsl(var(--shadow-color)/0.55)] ring-4 ring-bg transition-transform duration-150 active:scale-95 [&_svg]:size-7"
    >
      {icon}
    </button>
  );
}

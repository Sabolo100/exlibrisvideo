'use client';

/**
 * Tab list of the catalogue views: icon + label, horizontally scrollable on phones,
 * arrow keys / Home / End move and activate (automatic activation), the review tab carries the
 * pending-review count.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ViewKey } from '@/lib/types';
import { useCollection } from './context';
import { VIEW_PANEL_ID, useCollectionShell } from './shell-context';
import { VIEW_META } from './view-meta';

export interface ViewSwitcherProps {
  views: ViewKey[];
  className?: string;
}

export function viewTabId(view: ViewKey): string {
  return `collection-view-tab-${view}`;
}

export function ViewSwitcher({ views, className }: ViewSwitcherProps) {
  const { t, tp, n } = useI18n();
  const { view, setView } = useCollection();
  const { pendingReview } = useCollectionShell();
  const listRef = useRef<HTMLDivElement>(null);
  const active = views.includes(view) ? view : views[0];

  // keep the active tab visible inside the scroller (deep links, keyboard)
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>(`[data-view="${active}"]`);
    if (!list || !tab) return;
    const left = tab.offsetLeft - list.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft + 8 || right > list.scrollLeft + list.clientWidth - 8) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      list.scrollTo({ left: Math.max(0, left - list.clientWidth / 2 + tab.offsetWidth / 2), behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [active]);

  const select = (next: ViewKey, focus: boolean) => {
    setView(next);
    if (focus) {
      requestAnimationFrame(() => document.getElementById(viewTabId(next))?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const idx = views.indexOf(active);
    let next = -1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % views.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + views.length) % views.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = views.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(views[next], true);
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={t('collection.view.label')}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className={cn(
          'flex min-w-0 snap-x items-center gap-1 overflow-x-auto overscroll-x-contain scroll-smooth',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // fade the scroll edges on small screens
          '[mask-image:linear-gradient(90deg,transparent,#000_12px,#000_calc(100%-24px),transparent)] md:[mask-image:none]',
          'px-1 py-1',
        )}
      >
        {views.map((key) => {
          const meta = VIEW_META[key];
          const Icon = meta.icon;
          const selected = key === active;
          const badge = key === 'review' && pendingReview > 0 ? pendingReview : null;
          return (
            <button
              key={key}
              id={viewTabId(key)}
              type="button"
              role="tab"
              data-view={key}
              aria-selected={selected}
              aria-controls={VIEW_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(key, false)}
              className={cn(
                'relative inline-flex h-9 shrink-0 snap-start items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap',
                'transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-4 [&_svg]:shrink-0',
                selected
                  ? 'bg-surface text-ink shadow-[0_1px_2px_hsl(var(--shadow-color)/0.12),inset_0_0_0_1px_var(--line)]'
                  : 'text-muted hover:bg-surface-2/80 hover:text-ink',
              )}
            >
              <Icon aria-hidden="true" className={selected ? 'text-accent' : undefined} />
              <span>{t(meta.labelKey)}</span>
              {badge !== null ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-burgundy px-1.5 text-[0.6875rem] leading-none font-semibold text-surface tabular-nums"
                  >
                    {n(badge)}
                  </span>
                  <span className="sr-only">({tp('collection.view.reviewBadge', badge)})</span>
                </>
              ) : null}
              {selected ? (
                <span aria-hidden="true" className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-accent" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

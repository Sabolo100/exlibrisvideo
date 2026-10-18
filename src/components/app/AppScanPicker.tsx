'use client';

/**
 * Recording picker pinned to the right end of the view submenu (phone app): a drop-up list – "All books" by default,
 * then every recording newest first with the number of books it brought into the catalogue. Picking one filters
 * every view to those books (`filters.videos`, `?scan=`); a book found again in a later recording stays with the
 * one it first came in with.
 */
import { Check, ChevronUp, Film, Library } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCollection } from '@/components/collection/context';
import { cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { useBackDismiss } from '@/lib/client/back-stack';
import type { VideoDTO } from '@/lib/types';

/** The recordings worth offering: uploaded ones, newest first, with the books each brought in. */
export function scanOptions(videos: readonly VideoDTO[], firstVideoIds: readonly (string | null)[]): { video: VideoDTO; books: number }[] {
  const counts = new Map<string, number>();
  for (const id of firstVideoIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return videos
    .filter((v) => v.uploadStatus === 'uploaded')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.sortOrder - a.sortOrder)
    .map((video) => ({ video, books: counts.get(video.id) ?? 0 }));
}

export function AppScanPicker() {
  const { collection, books, filters, setFilters } = useCollection();
  const { t, tp, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useBackDismiss(open, () => setOpen(false));

  const options = useMemo(() => scanOptions(collection.videos, books.map((b) => b.firstVideoId)), [collection.videos, books]);
  const selected = filters.videos.length === 1 ? (options.find((o) => o.video.id === filters.videos[0]) ?? null) : null;
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  // a tap anywhere else closes the list
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (videoId: string | null) => {
    setFilters({ videos: videoId ? [videoId] : [] });
    setOpen(false);
  };

  const active = filters.videos.length > 0;
  const buttonLabel = selected ? when.format(new Date(selected.video.createdAt)) : active ? t('app.scan.some') : t('app.scan.all');

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('app.scan.label')}: ${buttonLabel}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-8 max-w-[9.5rem] items-center gap-1 rounded-full pr-2 pl-2.5 text-[0.8125rem] font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          active
            ? 'bg-[var(--submenu-active)] text-[var(--submenu-active-ink)] shadow-[0_1px_2px_rgb(0_0_0/0.18)]'
            : 'text-[var(--submenu-ink)] active:bg-[var(--submenu-press)]',
        )}
      >
        <Film aria-hidden="true" />
        <span className="truncate">{buttonLabel}</span>
        <ChevronUp aria-hidden="true" className={cn('transition-transform duration-200', open ? 'rotate-0' : 'rotate-180')} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t('app.scan.title')}
          className="absolute right-0 bottom-full z-40 mb-2 w-[min(19rem,calc(100vw-1.5rem))] origin-bottom-right overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[0_18px_40px_-12px_hsl(var(--shadow-color)/0.55)]"
        >
          <p className="px-3.5 pt-3 pb-1.5 text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{t('app.scan.title')}</p>
          <div className="app-scroll max-h-[min(22rem,55dvh)] overflow-y-auto pb-1.5">
            <ScanRow
              icon={<Library />}
              title={t('app.scan.all')}
              hint={tp('common.unit.book', books.length)}
              checked={!active}
              onClick={() => pick(null)}
            />
            {options.map(({ video, books: count }, i) => (
              <ScanRow
                key={video.id}
                icon={<Film />}
                title={when.format(new Date(video.createdAt))}
                badge={i === 0 ? t('app.scan.latest') : undefined}
                hint={`${tp('app.scan.books', count)} · ${video.originalFilename}`}
                checked={selected?.video.id === video.id}
                disabled={count === 0}
                onClick={() => pick(video.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScanRow({
  icon,
  title,
  hint,
  badge,
  checked,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  badge?: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'app-chrome flex w-full items-center gap-3 px-3.5 py-2 text-left active:bg-surface-2 disabled:opacity-45',
        checked && 'bg-accent-soft/60',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.9375rem] font-medium">
          <span className="truncate">{title}</span>
          {badge ? <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[0.625rem] font-semibold text-primary-ink uppercase">{badge}</span> : null}
        </span>
        <span className="block truncate text-[0.75rem] text-muted">{hint}</span>
      </span>
      {checked ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

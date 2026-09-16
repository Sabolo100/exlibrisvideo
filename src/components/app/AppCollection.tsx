'use client';

/**
 * A catalogue as a phone app screen (inside <CollectionProvider>): top bar with back, title, search and
 * share; the active view in the scrollable content; a bottom tab bar with the four main views and
 * "More" (other views, sort, filters, export, e-mail, add book / shelf, settings). While the catalogue
 * is being processed the live processing panel fills the screen.
 */
import {
  ArrowDownUp,
  Camera,
  ChevronRight,
  Download,
  Ellipsis,
  Mail,
  Plus,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AddBookDialog } from '@/components/book/AddBookDialog';
import { BookDrawer } from '@/components/book/BookDrawer';
import { CameraRecorder } from '@/components/camera/CameraRecorder';
import { ActiveFilters } from '@/components/collection/ActiveFilters';
import { CatalogueEmpty } from '@/components/collection/CatalogueEmpty';
import { useCollectionPageLifecycle } from '@/components/collection/CollectionPage';
import { useCollection } from '@/components/collection/context';
import { EmailExportDialog } from '@/components/collection/EmailExportDialog';
import { FiltersPanel } from '@/components/collection/FiltersPanel';
import { collectionTitle } from '@/components/collection/labels';
import { SettingsDialog } from '@/components/collection/SettingsDialog';
import { ShareDialog } from '@/components/collection/ShareDialog';
import { useCollectionShell } from '@/components/collection/shell-context';
import { EXPORT_META, EXPORT_ORDER, SORT_LABELS, VIEW_META, availableViews } from '@/components/collection/view-meta';
import { ViewPanel } from '@/components/collection/ViewPanel';
import '@/components/collection/collection.css';
import { ProcessingPanel } from '@/components/processing/ProcessingPanel';
import { Drawer, Spinner, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import { uploadStore } from '@/lib/client/upload-store';
import type { ViewKey } from '@/lib/types';
import { AppScreen } from './AppScreen';
import { AppTabBar, type AppTab } from './AppTabBar';
import { AppBackButton, AppBarButton, AppTopBar } from './AppTopBar';

/** The views with their own tab; the rest live under "More". */
const PRIMARY_VIEWS: readonly ViewKey[] = ['shelf', 'covers', 'authors', 'stats'];

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-2">
      <h3 className="px-1 pb-1 text-[0.75rem] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
    </section>
  );
}

function SheetRow({
  icon,
  label,
  hint,
  onClick,
  href,
  active,
  badge,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  badge?: number;
}) {
  const inner = (
    <>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px] ${active ? 'bg-primary text-primary-ink' : 'bg-accent-soft text-accent'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium text-ink">{label}</span>
        {hint ? <span className="block truncate text-[0.8125rem] text-muted">{hint}</span> : null}
      </span>
      {badge ? (
        <span className="rounded-full bg-burgundy px-2 py-0.5 text-[0.75rem] font-semibold text-white tabular-nums">{badge}</span>
      ) : null}
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
    </>
  );
  const classes = 'app-chrome flex w-full items-center gap-3 border-t border-line/70 px-3 py-2.5 text-left first:border-t-0 active:bg-surface-2';
  return href ? (
    <a href={href} className={classes}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={classes} aria-current={active ? 'page' : undefined}>
      {inner}
    </button>
  );
}

export function AppCollection() {
  const { t, tp, locale } = useI18n();
  const { toast } = useToast();
  const { collection, books, view, setView, filters, setFilters, activeFilterCount, sort, setSort, isOwner, refresh, visibleBooks } =
    useCollection();
  const { counts, pendingReview, unreadSpineCount } = useCollectionShell();
  const reviewBadge = pendingReview + unreadSpineCount;
  const onlyUnreadSpines = books.length === 0 && isOwner && unreadSpineCount > 0;
  const { claiming, processing } = useCollectionPageLifecycle();
  const mainRef = useRef<HTMLElement>(null);

  const [searchOpen, setSearchOpen] = useState(filters.q.length > 0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addBookOpen, setAddBookOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const views = useMemo(() => availableViews({ isOwner: collection.isOwner, videos: collection.videos }), [collection.isOwner, collection.videos]);
  const activeView: ViewKey = views.includes(view) ? view : 'shelf';
  const title = collectionTitle(collection, t);

  // a new view starts at its top
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeView]);

  // new shelves recorded from here: refresh once their upload finished (the catalogue turns "processing")
  useEffect(
    () =>
      uploadStore.onUploaded((item) => {
        if (item.collectionId === collection.id) void refresh();
      }),
    [collection.id, refresh],
  );

  const pickView = useCallback(
    (next: ViewKey) => {
      setMoreOpen(false);
      setView(next);
    },
    [setView],
  );

  const share = async () => {
    const url = collection.publicUrl;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: t('app.collection.shareText'), url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    setShareOpen(true);
  };

  const tabs: AppTab[] = [
    ...PRIMARY_VIEWS.filter((v) => views.includes(v)).map((v) => {
      const Icon = VIEW_META[v].icon;
      return { key: v, label: t(VIEW_META[v].labelKey), icon: <Icon />, active: activeView === v, onClick: () => pickView(v) };
    }),
    {
      key: 'more',
      label: t('app.collection.more'),
      icon: <Ellipsis />,
      active: !PRIMARY_VIEWS.includes(activeView) || moreOpen,
      badge: isOwner && reviewBadge > 0 ? reviewBadge : undefined,
      onClick: () => setMoreOpen(true),
    },
  ];

  const secondaryViews = views.filter((v) => !PRIMARY_VIEWS.includes(v));
  const subtitle = processing ? t('app.collection.processing') : `${tp('collection.header.books', counts.books)} · ${tp('collection.header.authors', counts.authors)}`;

  return (
    <AppScreen
      mainRef={mainRef}
      top={
        <AppTopBar
          leading={<AppBackButton fallbackHref="/my" />}
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {!processing && books.length > 0 ? (
                <AppBarButton
                  label={searchOpen ? t('app.collection.searchClose') : t('app.collection.search')}
                  icon={searchOpen ? <X /> : <Search />}
                  active={searchOpen}
                  onClick={() => {
                    if (searchOpen) setFilters({ q: '' });
                    setSearchOpen((o) => !o);
                  }}
                />
              ) : null}
              <AppBarButton label={t('app.collection.share')} icon={<Share2 />} onClick={() => void share()} />
            </>
          }
          below={
            searchOpen && !processing ? (
              <div className="flex items-center gap-2 px-3 pb-2.5">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3">
                  <Search aria-hidden="true" className="size-[18px] shrink-0 text-muted" />
                  <input
                    autoFocus
                    type="search"
                    enterKeyHint="search"
                    value={filters.q}
                    onChange={(e) => setFilters({ q: e.target.value })}
                    placeholder={t('collection.search.placeholder')}
                    aria-label={t('app.collection.search')}
                    className="min-w-0 flex-1 bg-transparent text-[1rem] text-ink outline-none placeholder:text-muted"
                  />
                  {filters.q ? <span className="shrink-0 text-[0.8125rem] text-muted tabular-nums">{visibleBooks.length}</span> : null}
                </label>
                <AppBarButton
                  label={t('app.collection.filters')}
                  icon={<SlidersHorizontal />}
                  active={activeFilterCount > 0}
                  onClick={() => setFiltersOpen(true)}
                />
              </div>
            ) : null
          }
        />
      }
      bottom={processing || books.length === 0 ? undefined : <AppTabBar label={t('app.collection.views.label')} tabs={tabs} />}
      mainClassName={processing ? 'px-3 pt-3 pb-6' : 'pb-6'}
    >
      {claiming ? (
        <p role="status" className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
          <Spinner size="xs" decorative className="text-accent" />
          {t('collection.claim.working')}
        </p>
      ) : null}

      {processing ? (
        <ProcessingPanel initial={collection} isOwner={isOwner} onReady={() => void refresh()} />
      ) : onlyUnreadSpines ? (
        // nothing could be read yet, but the owner can still name the spines
        <div className="app-screen-in">
          <ViewPanel view="review" className="px-3 pt-3" />
        </div>
      ) : books.length === 0 ? (
        <div className="px-3 pt-3">
          <CatalogueEmpty />
        </div>
      ) : (
        <div className="app-screen-in" key={activeView}>
          {activeFilterCount > 0 ? <ActiveFilters className="px-3 pt-3" /> : null}
          <ViewPanel view={activeView} className="px-3 pt-3" />
        </div>
      )}

      <BookDrawer />

      <Drawer open={moreOpen} onClose={() => setMoreOpen(false)} title={t('app.collection.moreTitle')} size="md">
        {secondaryViews.length > 0 ? (
          <SheetSection title={t('app.collection.views')}>
            {secondaryViews.map((v) => {
              const Icon = VIEW_META[v].icon;
              return (
                <SheetRow
                  key={v}
                  icon={<Icon />}
                  label={t(VIEW_META[v].labelKey)}
                  active={activeView === v}
                  badge={v === 'review' && reviewBadge > 0 ? reviewBadge : undefined}
                  onClick={() => pickView(v)}
                />
              );
            })}
          </SheetSection>
        ) : null}

        <SheetSection title={t('collection.sort.label')}>
          <div className="flex flex-wrap gap-2 p-3">
            {(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
                className={`app-chrome inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.875rem] font-medium ${
                  sort === key ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-bg text-ink active:bg-surface-2'
                }`}
              >
                {sort === key ? <ArrowDownUp aria-hidden="true" className="size-4" /> : null}
                {t(SORT_LABELS[key])}
              </button>
            ))}
          </div>
        </SheetSection>

        <SheetSection title={t('app.collection.actions')}>
          <SheetRow
            icon={<SlidersHorizontal />}
            label={t('app.collection.filters')}
            badge={activeFilterCount > 0 ? activeFilterCount : undefined}
            onClick={() => {
              setMoreOpen(false);
              setFiltersOpen(true);
            }}
          />
          {isOwner ? (
            <>
              <SheetRow
                icon={<Camera />}
                label={t('app.collection.addVideo')}
                onClick={() => {
                  setMoreOpen(false);
                  setCameraOpen(true);
                }}
              />
              <SheetRow
                icon={<Plus />}
                label={t('app.collection.addBook')}
                onClick={() => {
                  setMoreOpen(false);
                  setAddBookOpen(true);
                }}
              />
              <SheetRow
                icon={<Mail />}
                label={t('app.collection.email')}
                onClick={() => {
                  setMoreOpen(false);
                  setEmailOpen(true);
                }}
              />
              <SheetRow
                icon={<Settings2 />}
                label={t('app.collection.settings')}
                onClick={() => {
                  setMoreOpen(false);
                  setSettingsOpen(true);
                }}
              />
            </>
          ) : null}
        </SheetSection>

        <SheetSection title={t('app.collection.export')}>
          {EXPORT_ORDER.map((format) => (
            <SheetRow
              key={format}
              icon={<Download />}
              label={t(EXPORT_META[format].labelKey)}
              hint={t(EXPORT_META[format].hintKey)}
              href={api.exportUrl(collection.id, format, locale)}
            />
          ))}
        </SheetSection>
      </Drawer>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('app.collection.filters')} size="md">
        <FiltersPanel onDone={() => setFiltersOpen(false)} />
      </Drawer>
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      {isOwner ? (
        <>
          <EmailExportDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <AddBookDialog open={addBookOpen} onOpenChange={setAddBookOpen} />
          <CameraRecorder
            open={cameraOpen}
            onClose={() => setCameraOpen(false)}
            onDone={(files: File[]) => {
              setCameraOpen(false);
              if (files.length === 0) return;
              uploadStore.enqueue(collection.id, files);
              toast({ title: t('app.collection.uploadStarted'), tone: 'info' });
            }}
          />
        </>
      ) : null}
    </AppScreen>
  );
}

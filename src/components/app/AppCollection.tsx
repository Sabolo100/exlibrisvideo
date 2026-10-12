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
  Images,
  Plus,
  ScanBarcode,
  Search,
  Settings2,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AddBookDialog } from '@/components/book/AddBookDialog';
import { AddBookPhotoDialog } from '@/components/book/AddBookPhotoDialog';
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
import { AppFab, AppTabBar, type AppTab } from './AppTabBar';
import { AppBackButton, AppBarButton, AppTopBar } from './AppTopBar';
import { UserAvatar } from '@/components/site/AccountMenu';
import { useSession } from '@/components/site/SessionProvider';
import { useSignInNudge } from '@/components/site/SignInNudge';
import { GuestAccountCard } from '@/components/collection/GuestAccountCard';
import { copyPickedFiles } from '@/lib/client/stable-files';
import { AppInstallButton } from './AppInstallButton';
import { AppSettingsSheet } from './AppSettingsSheet';

/** The views with their own tab; the rest live under "More". */
const GALLERY_ACCEPT = 'video/*,image/jpeg,image/png,image/webp,.mp4,.m4v,.mov,.webm,.mkv,.3gp,.jpg,.jpeg,.png,.webp';

const PRIMARY_VIEWS: readonly ViewKey[] = ['shelf', 'covers', 'authors', 'stats'];
/** owners: the add button takes the middle of the tab bar, statistics moves into "More" */
const OWNER_PRIMARY_VIEWS: readonly ViewKey[] = ['shelf', 'covers', 'authors'];

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
  const { counts, pendingReview, duplicateCount, unreadSpineCount } = useCollectionShell();
  const reviewBadge = pendingReview + duplicateCount + unreadSpineCount;
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
  const [photoBookOpen, setPhotoBookOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sessionUser = useSession().user;
  const { guard, nudge } = useSignInNudge(collection.id);
  const accountLibrary = !!sessionUser && sessionUser.libraryId === collection.id;

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

  const primaryViews = isOwner ? OWNER_PRIMARY_VIEWS : PRIMARY_VIEWS;
  const tabs: AppTab[] = [
    ...primaryViews.filter((v) => views.includes(v)).map((v) => {
      const Icon = VIEW_META[v].icon;
      return { key: v, label: t(VIEW_META[v].labelKey), icon: <Icon />, active: activeView === v, onClick: () => pickView(v) };
    }),
    {
      key: 'more',
      label: t('app.collection.more'),
      icon: <Ellipsis />,
      active: !primaryViews.includes(activeView) || moreOpen,
      badge: isOwner && reviewBadge > 0 ? reviewBadge : undefined,
      onClick: () => setMoreOpen(true),
    },
  ];

  const secondaryViews = views.filter((v) => !primaryViews.includes(v));
  const emptyDraft = collection.status === 'draft' && books.length === 0 && collection.videos.length === 0;
  const subtitle = emptyDraft ? t('app.collection.empty') : processing ? t('app.collection.processing') : `${tp('collection.header.books', counts.books)} · ${tp('collection.header.authors', counts.authors)}`;

  return (
    <AppScreen
      mainRef={mainRef}
      top={
        <AppTopBar
          leading={
            accountLibrary ? (
              // the signed-in user's home: no "back" – the avatar opens the settings (account, sign-out)
              <button
                type="button"
                aria-label={t('app.settings.title')}
                onClick={() => setAppSettingsOpen(true)}
                className="ml-1 inline-flex rounded-full p-1 active:scale-95"
              >
                {sessionUser ? <UserAvatar user={sessionUser} /> : null}
              </button>
            ) : (
              <AppBackButton fallbackHref="/my" />
            )
          }
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {accountLibrary ? <AppInstallButton onNeedHelp={() => setAppSettingsOpen(true)} /> : null}
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
      bottom={
        isOwner ? (
          <AppTabBar
            label={t('app.collection.views.label')}
            tabs={processing || books.length === 0 ? [] : tabs}
            center={<AppFab label={t('app.collection.add')} icon={<Plus />} onClick={() => setAddOpen(true)} />}
          />
        ) : processing || books.length === 0 ? undefined : (
          <AppTabBar label={t('app.collection.views.label')} tabs={tabs} />
        )
      }
      mainClassName={processing ? 'px-3 pt-3 pb-6' : 'pb-6'}
    >
      {claiming ? (
        <p role="status" className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
          <Spinner size="xs" decorative className="text-accent" />
          {t('collection.claim.working')}
        </p>
      ) : null}

      {processing ? (
        <>
          <GuestAccountCard className="mx-3 mb-3" />
          <ProcessingPanel initial={collection} isOwner={isOwner} onReady={() => void refresh()} />
        </>
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
          <GuestAccountCard className="mx-3 mt-3" />
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
                  guard(() => setCameraOpen(true));
                }}
              />
              <SheetRow
                icon={<ScanBarcode />}
                label={t('book.photo.menu')}
                onClick={() => {
                  setMoreOpen(false);
                  guard(() => setPhotoBookOpen(true));
                }}
              />
              <SheetRow
                icon={<Plus />}
                label={t('app.collection.addBook')}
                onClick={() => {
                  setMoreOpen(false);
                  guard(() => setAddBookOpen(true));
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
          {isOwner ? (
            <SheetRow
              icon={<Mail />}
              label={t('app.collection.email')}
              onClick={() => {
                setMoreOpen(false);
                setEmailOpen(true);
              }}
            />
          ) : null}
        </SheetSection>
      </Drawer>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('app.collection.filters')} size="md">
        <FiltersPanel onDone={() => setFiltersOpen(false)} />
      </Drawer>
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      {accountLibrary ? <AppSettingsSheet open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} /> : null}
      {isOwner ? (
        <>
          <EmailExportDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <AddBookDialog open={addBookOpen} onOpenChange={setAddBookOpen} />
          <AddBookPhotoDialog open={photoBookOpen} onOpenChange={setPhotoBookOpen} />
          {nudge}
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
          <input
            ref={galleryRef}
            type="file"
            multiple
            accept={GALLERY_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const input = e.currentTarget;
              const picked = Array.from(input.files ?? []);
              if (picked.length === 0) return;
              // open the files right now: Chrome on Android drops access to picked files after a moment
              void copyPickedFiles(picked).then((ready) => {
                input.value = '';
                if (ready.length === 0) return;
                uploadStore.enqueue(collection.id, ready);
                toast({ title: t('app.collection.uploadStarted'), tone: 'info' });
              });
            }}
          />
          <Drawer open={addOpen} onClose={() => setAddOpen(false)} title={t('app.collection.add')} size="sm">
            <div className="flex flex-col gap-2 pb-2">
              {[
                { key: 'record', icon: <Camera />, label: t('app.collection.addVideo'), hint: t('app.add.recordHint'), run: () => guard(() => setCameraOpen(true)) },
                { key: 'gallery', icon: <Images />, label: t('app.add.gallery'), hint: t('app.add.galleryHint'), run: () => guard(() => galleryRef.current?.click()) },
                { key: 'photo', icon: <ScanBarcode />, label: t('book.photo.menu'), hint: t('book.photo.menuHint'), run: () => guard(() => setPhotoBookOpen(true)) },
                { key: 'manual', icon: <Plus />, label: t('app.collection.addBook'), hint: t('app.add.manualHint'), run: () => guard(() => setAddBookOpen(true)) },
              ].map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    a.run();
                  }}
                  className="app-chrome flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left active:bg-surface-2"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-[22px]">{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-semibold text-ink">{a.label}</span>
                    <span className="block text-[0.8125rem] leading-snug text-muted">{a.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Drawer>
        </>
      ) : null}
    </AppScreen>
  );
}

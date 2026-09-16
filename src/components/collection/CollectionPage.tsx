'use client';

/**
 * Client shell of `/<id>` (inside <CollectionProvider>):
 * - owner links (?k= / ?r=) are claimed and stripped, visited collections are remembered on this device;
 * - draft / processing → the live ProcessingPanel; ready / error → the catalogue: header, owner banner,
 *   sticky toolbar, the active view, book drawer, bulk action bar, print catalogue.
 */
import { useEffect, useMemo, useRef } from 'react';
import { BookDrawer } from '@/components/book/BookDrawer';
import { ProcessingPanel } from '@/components/processing/ProcessingPanel';
import { Spinner } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { rememberCollection } from '@/lib/client/my-collections';
import type { ViewKey } from '@/lib/types';
import { BulkActionBar } from './BulkActionBar';
import { CatalogueEmpty } from './CatalogueEmpty';
import { CollectionHeader } from './CollectionHeader';
import { useCollection } from './context';
import { OwnerBanner } from './OwnerBanner';
import { PrintCatalogue } from './PrintCatalogue';
import { TOOLBAR_ID, Toolbar } from './Toolbar';
import { useCollectionShell, VIEW_PANEL_ID } from './shell-context';
import { useClaimFromUrl } from './useClaim';
import { availableViews } from './view-meta';
import { ViewPanel } from './ViewPanel';
import './collection.css';

/** Delay of the one background refresh after the first paint (fresh data + view counting via the API). */
const MOUNT_REFRESH_DELAY_MS = 1200;

/** Brings the top of the view panel under the sticky toolbar when the reader had scrolled past it. */
function scrollPanelIntoView() {
  const panel = document.getElementById(VIEW_PANEL_ID);
  if (!panel) return;
  const toolbar = document.getElementById(TOOLBAR_ID);
  const offset = (toolbar?.getBoundingClientRect().bottom ?? 0) + 12;
  const top = panel.getBoundingClientRect().top;
  if (top >= offset) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, window.scrollY + top - offset), behavior: reduce ? 'auto' : 'smooth' });
}

function Catalogue() {
  const { collection, books, view } = useCollection();
  const views = useMemo(
    () => availableViews({ isOwner: collection.isOwner, videos: collection.videos }),
    [collection.isOwner, collection.videos],
  );
  const activeView: ViewKey = views.includes(view) ? view : 'shelf';

  // switching views from far down the page starts the new view at its top
  const previousView = useRef(activeView);
  useEffect(() => {
    if (previousView.current === activeView) return;
    previousView.current = activeView;
    requestAnimationFrame(scrollPanelIntoView);
  }, [activeView]);

  return (
    <>
      <CollectionHeader />
      <OwnerBanner onReview={() => requestAnimationFrame(scrollPanelIntoView)} />

      {books.length === 0 ? (
        <CatalogueEmpty />
      ) : (
        <>
          <Toolbar views={views} className="mt-6" />
          <ViewPanel view={activeView} className="mt-5 min-h-[40vh] print:hidden" />
        </>
      )}

      <PrintCatalogue />
      <BookDrawer />
      <BulkActionBar />
    </>
  );
}

export function CollectionPage() {
  const { t } = useI18n();
  const { collection, isOwner, refresh } = useCollection();
  const { refreshSilently } = useCollectionShell();
  const { id, title, bookCount, createdAt, status } = collection;
  const processing = status === 'draft' || status === 'processing';

  const { claiming } = useClaimFromUrl(id, { title, bookCount, createdAt, isOwner });

  // "Kollekcióim": remember every collection opened in this browser (a known owner token is kept)
  useEffect(() => {
    rememberCollection({ id, token: null, title, bookCount, createdAt });
  }, [id, title, bookCount, createdAt]);

  // One quiet refresh after load: counts the view through the API (Server Components cannot set the
  // "seen" cookie) and picks up changes made since the server render. The processing panel polls itself.
  const processingRef = useRef(processing);
  processingRef.current = processing;
  const refreshRef = useRef(refreshSilently);
  refreshRef.current = refreshSilently;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!processingRef.current) void refreshRef.current();
    }, MOUNT_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div className="exl-catalogue mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8">
      {claiming ? (
        <p
          role="status"
          className="fixed top-[4.5rem] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-ink shadow-lift sm:top-20 print:hidden"
        >
          <Spinner size="xs" decorative className="text-accent" />
          {t('collection.claim.working')}
        </p>
      ) : null}
      {processing ? (
        <ProcessingPanel initial={collection} isOwner={isOwner} onReady={() => void refresh()} />
      ) : (
        <Catalogue />
      )}
    </div>
  );
}

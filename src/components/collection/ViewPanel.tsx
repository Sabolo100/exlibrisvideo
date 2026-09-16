'use client';

/**
 * The tab panel that renders the active catalogue view. Light, frequently used views are bundled
 * with the page; the heavy ones (statistics, timeline, frames, review) are code-split. Each view runs
 * inside an error boundary so one broken view never takes the whole catalogue down, and filtered
 * views get a shared "no results" state.
 */
import { AlertTriangle, RotateCcw, SearchX } from 'lucide-react';
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { AuthorsView } from '@/components/views/AuthorsView';
import { CoversView } from '@/components/views/CoversView';
import { ShelfView } from '@/components/views/ShelfView';
import { TableView } from '@/components/views/TableView';
import { TopicsView } from '@/components/views/TopicsView';
import { Button, EmptyState, Skeleton, Spinner } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ViewKey } from '@/lib/types';
import { useCollection } from './context';
import { isChunkLoadError } from './errors';
import { VIEW_PANEL_ID } from './shell-context';
import { FILTERED_VIEWS } from './view-meta';
import { viewTabId } from './ViewSwitcher';

/** Placeholder while a code-split view downloads. */
export function ViewLoading() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4 py-2">
      <span className="sr-only">{t('collection.view.loading')}</span>
      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <Spinner size="sm" decorative className="text-accent" />
        {t('collection.view.loading')}
      </div>
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
        <Skeleton height={112} />
        <Skeleton height={112} />
        <Skeleton height={112} />
      </div>
      <Skeleton height={260} aria-hidden="true" />
    </div>
  );
}

/**
 * React.lazy (not next/dynamic): next/dynamic renders the component inline during SSR but wraps it in
 * an extra lazy + Suspense layer on the client, which shifts the useId tree context and produced
 * hydration mismatches in every code-split view (aria-labelledby / id pairs). With lazy + an explicit
 * Suspense boundary the server and client trees are identical.
 */
const StatsView = lazy(() => import('@/components/views/StatsView').then((m) => ({ default: m.StatsView })));
const TimelineView = lazy(() => import('@/components/views/TimelineView').then((m) => ({ default: m.TimelineView })));
const FramesView = lazy(() => import('@/components/views/FramesView').then((m) => ({ default: m.FramesView })));
const ReviewView = lazy(() => import('@/components/views/ReviewView').then((m) => ({ default: m.ReviewView })));

function renderView(view: ViewKey): ReactNode {
  switch (view) {
    case 'covers':
      return <CoversView />;
    case 'table':
      return <TableView />;
    case 'authors':
      return <AuthorsView />;
    case 'topics':
      return <TopicsView />;
    case 'timeline':
      return <TimelineView />;
    case 'stats':
      return <StatsView />;
    case 'frames':
      return <FramesView />;
    case 'review':
      return <ReviewView />;
    case 'shelf':
    default:
      return <ShelfView />;
  }
}

interface BoundaryProps {
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

class ViewErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[collection] view crashed', { message: error.message, component: info.componentStack?.trim().split('\n')[0] });
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

function ViewError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-card border border-line bg-surface">
      <EmptyState
        icon={<AlertTriangle />}
        title={t('collection.view.error')}
        description={t('collection.view.errorHint')}
        action={
          <Button leftIcon={<RotateCcw className="size-4" />} onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}>
            {t('collection.view.retry')}
          </Button>
        }
      />
    </div>
  );
}

function NoResults() {
  const { t } = useI18n();
  const { resetFilters } = useCollection();
  return (
    <div className="rounded-card border border-dashed border-line bg-surface/60">
      <EmptyState
        icon={<SearchX />}
        title={t('collection.results.none')}
        description={t('collection.results.noneHint')}
        action={<Button onClick={resetFilters}>{t('collection.filter.clearAll')}</Button>}
      />
    </div>
  );
}

export function ViewPanel({ view, className }: { view: ViewKey; className?: string }) {
  const { visibleBooks, activeFilterCount } = useCollection();
  const noResults = visibleBooks.length === 0 && activeFilterCount > 0 && FILTERED_VIEWS.has(view);

  return (
    <div id={VIEW_PANEL_ID} role="tabpanel" aria-labelledby={viewTabId(view)} tabIndex={-1} className={className}>
      {noResults ? (
        <NoResults />
      ) : (
        <ViewErrorBoundary key={view} fallback={(error, reset) => <ViewError error={error} reset={reset} />}>
          <Suspense fallback={<ViewLoading />}>{renderView(view)}</Suspense>
        </ViewErrorBoundary>
      )}
    </div>
  );
}

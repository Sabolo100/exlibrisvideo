'use client';

/**
 * View 8 – "how we saw your shelf": the key frames the recognition ran on, grouped by source video,
 * with the detected spines drawn as boxes over the selected frame. Boxes open their book; boxes
 * whose book was deleted or merged away are greyed out. ← / → step through the frames.
 */
import { ChevronLeft, ChevronRight, CircleAlert, Film, Info, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookSpine } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { Button, EmptyState, IconButton, Kbd, Skeleton, Switch } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { hasOpenLayers, useUiTranslator } from '@/components/ui/hooks';
import { api } from '@/lib/client/api';
import type { BookDTO, FrameDTO } from '@/lib/types';
import { formatTimestamp, groupFramesByVideo, indexDetections, stepFrame, type FrameDetection } from './visual/frames-layout';
import { FrameStage } from './visual/FrameStage';
import { FrameStrip } from './visual/FrameStrip';
import { ReanalyzeButton } from './visual/ReanalyzeButton';
import { isBoolean, isEditableOrWidgetTarget, scrollBehavior, useLatest, useStoredState } from './visual/hooks';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; frames: FrameDTO[]; detections: FrameDetection[] };

export function FramesView() {
  const { collection, books, openBook, openBookId } = useCollection();
  const { t, tp, n, locale } = useUiTranslator();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useStoredState<boolean>('exl.visual.frames.showAll', true, isBoolean);
  const [hoverBookId, setHoverBookId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // refetch when sources gain frames (processing still running) or are removed
  const sourcesSignature = collection.videos.map((v) => `${v.id}:${v.framesTotal}:${v.status}`).join('|');

  useEffect(() => {
    let cancelled = false;
    // keep showing the previous frames while refreshing in the background
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    api
      .getFrames(collection.id)
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', frames: res.frames, detections: res.detections });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.info('[frames] could not load frames', { collectionId: collection.id, error: err instanceof Error ? err.message : String(err) });
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      });
    return () => {
      cancelled = true;
    };
  }, [collection.id, sourcesSignature, attempt]);

  const frames = state.status === 'ready' ? state.frames : null;
  const groups = useMemo(() => (frames ? groupFramesByVideo(frames, collection.videos) : []), [frames, collection.videos]);
  const order = useMemo(() => groups.flatMap((g) => g.frames.map((f) => f.id)), [groups]);
  const framesById = useMemo(() => new Map(groups.flatMap((g) => g.frames.map((f) => [f.id, f] as const))), [groups]);
  const groupOfFrame = useMemo(() => {
    const m = new Map<string, number>();
    groups.forEach((g, i) => g.frames.forEach((f) => m.set(f.id, i)));
    return m;
  }, [groups]);
  const detectionsByFrame = useMemo(
    () => indexDetections(state.status === 'ready' ? state.detections : []),
    [state],
  );
  const detectionCounts = useMemo(() => {
    const m = new Map<string, number>();
    detectionsByFrame.forEach((list, id) => m.set(id, list.length));
    return m;
  }, [detectionsByFrame]);
  const booksById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  // initial / fallback selection: the open book's best frame, else the first frame
  const initialOpenBook = useRef(openBookId);
  useEffect(() => {
    if (order.length === 0) return;
    if (selectedId && framesById.has(selectedId)) return;
    const preferred = initialOpenBook.current ? booksById.get(initialOpenBook.current)?.bestFrameId : null;
    setSelectedId(preferred && framesById.has(preferred) ? preferred : order[0]);
  }, [order, framesById, selectedId, booksById]);

  const selected = selectedId ? (framesById.get(selectedId) ?? null) : null;
  const selectedGroup = selected ? groups[groupOfFrame.get(selected.id) ?? 0] : null;
  const position = selected ? order.indexOf(selected.id) : -1;

  const step = useCallback(
    (delta: number) => {
      setSelectedId((current) => stepFrame(order, current, delta));
    },
    [order],
  );

  // ← / → anywhere on the page while this view is shown (not inside fields, menus or overlays)
  const stepRef = useLatest(step);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (hasOpenLayers() || isEditableOrWidgetTarget(e.target)) return;
      e.preventDefault();
      stepRef.current(e.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stepRef]);

  // warm the browser cache for the neighbours → instant stepping
  useEffect(() => {
    if (position < 0) return;
    for (const id of [order[position - 1], order[position + 1]]) {
      const f = id ? framesById.get(id) : undefined;
      if (f) {
        const img = new Image();
        img.decoding = 'async';
        img.src = f.image;
      }
    }
  }, [position, order, framesById]);

  const openRef = useLatest(openBook);
  const onOpen = useCallback((bookId: string) => openRef.current(bookId), [openRef]);
  const onSelectFrame = useCallback((frame: FrameDTO) => {
    setSelectedId(frame.id);
    // on phones the stage is above the strips: bring it back into view
    const stage = stageRef.current;
    if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, []);

  const selectedDetections = selected ? (detectionsByFrame.get(selected.id) ?? []) : [];
  const booksInFrame = useMemo(() => {
    const seen = new Set<string>();
    const list: BookDTO[] = [];
    let unmatched = 0;
    for (const d of selectedDetections) {
      const book = d.bookId ? booksById.get(d.bookId) : undefined;
      if (!book) {
        unmatched += 1;
        continue;
      }
      if (!seen.has(book.id)) {
        seen.add(book.id);
        list.push(book);
      }
    }
    return { list, unmatched };
  }, [selectedDetections, booksById]);

  /* ---------------- states ---------------- */

  const intro = (
    <header className="mb-6 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-soft sm:flex-row sm:items-start sm:gap-4 sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-5" aria-hidden="true">
        <ScanSearch />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-xl font-semibold text-ink">{t('visual.frames.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted text-pretty">{t('visual.frames.intro')}</p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('visual.frames.sourceDeleted')}</span>
        </p>
      </div>
    </header>
  );

  if (state.status === 'loading') {
    return (
      <section aria-label={t('visual.frames.title')} aria-busy="true">
        {intro}
        <p className="sr-only" role="status">
          {t('visual.frames.loading')}
        </p>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="mx-auto aspect-[9/16] max-h-[60vh] w-full max-w-[22rem] rounded-xl" />
          <div className="flex flex-col gap-3">
            <Skeleton shape="text" className="h-4 w-2/3" />
            <Skeleton shape="text" className="h-3 w-1/2" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <div className="mt-8 flex gap-2 overflow-hidden">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-24 shrink-0" width={54} />
          ))}
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section aria-label={t('visual.frames.title')}>
        {intro}
        <EmptyState
          icon={<CircleAlert />}
          title={t('visual.frames.error.title')}
          description={t('visual.frames.error.description')}
          action={
            <Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
              {t('common.action.retry')}
            </Button>
          }
        />
      </section>
    );
  }

  if (order.length === 0 || !selected) {
    return (
      <section aria-label={t('visual.frames.title')}>
        {intro}
        <EmptyState icon={<Film />} title={t('visual.frames.empty.title')} description={t('visual.frames.empty.description')} />
      </section>
    );
  }

  const sourceName = selectedGroup?.video?.originalFilename ?? t('visual.frames.unknownSource');
  const time = formatTimestamp(selected.timeSec, locale === 'hu' ? ',' : '.');
  const highlight = hoverBookId ?? openBookId;

  return (
    <section aria-label={t('visual.frames.title')} className="exl-frames-view">
      {intro}

      <div ref={stageRef} className="grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <FrameStage
            frame={selected}
            detections={selectedDetections}
            booksById={booksById}
            imageLabel={t('visual.frames.image', { name: sourceName, time })}
            showAll={showAll}
            highlightBookId={highlight}
            onOpen={onOpen}
            onHoverBook={setHoverBookId}
          />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1">
              <IconButton size="sm" variant="secondary" icon={<ChevronLeft />} aria-label={t('visual.frames.prev')} tooltip disabled={position <= 0} onClick={() => step(-1)} />
              <span className="min-w-[4.5rem] text-center text-sm font-medium text-ink tabular-nums" aria-live="polite">
                {t('visual.frames.position', { index: n(position + 1), total: n(order.length) })}
              </span>
              <IconButton size="sm" variant="secondary" icon={<ChevronRight />} aria-label={t('visual.frames.next')} tooltip disabled={position >= order.length - 1} onClick={() => step(1)} />
            </div>
            <span className="max-w-full truncate text-xs text-muted">
              {sourceName} · {time}
            </span>
            <span className="hidden items-center gap-1 text-xs text-muted md:inline-flex" aria-hidden="true">
              <Kbd size="sm">←</Kbd>
              <Kbd size="sm">→</Kbd>
            </span>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Switch
            size="sm"
            checked={showAll}
            onCheckedChange={setShowAll}
            label={t('visual.frames.showBoxes')}
            description={t('visual.frames.showBoxes.hint')}
          />
          <div>
            <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink">
              <span>{t('visual.frames.inFrame')}</span>
              <span className="text-xs font-normal text-muted tabular-nums">{tp('visual.frames.detections', selectedDetections.length)}</span>
            </h3>
            {booksInFrame.list.length === 0 ? (
              <p className="text-sm text-muted">{t('visual.frames.noDetections')}</p>
            ) : (
              <ul className="flex max-h-[min(28rem,55vh)] flex-col gap-1 overflow-y-auto pr-1 max-lg:max-h-none">
                {booksInFrame.list.map((book) => (
                  <li key={book.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(book.id)}
                      onPointerEnter={() => setHoverBookId(book.id)}
                      onPointerLeave={() => setHoverBookId(null)}
                      onFocus={() => setHoverBookId(book.id)}
                      onBlur={() => setHoverBookId(null)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                        (openBookId === book.id || hoverBookId === book.id) && 'bg-surface-2',
                      )}
                    >
                      <BookSpine book={book} size="xs" decorative />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-display text-sm font-semibold text-ink">{book.title}</span>
                        {book.author ? <span className="truncate text-xs text-muted">{book.author}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {booksInFrame.unmatched > 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <span aria-hidden="true" className="inline-block size-3 rounded-[2px] border border-dashed border-muted" />
                {tp('visual.frames.unmatchedCount', booksInFrame.unmatched)}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        {groups.map((group, i) => (
          <FrameStrip
            key={group.videoId}
            group={group}
            selectedId={groupOfFrame.get(selected.id) === i ? selected.id : null}
            detectionCounts={detectionCounts}
            onSelect={onSelectFrame}
            action={
              collection.isOwner && group.video && group.frames.length > 0 && (group.video.status === 'done' || group.video.status === 'error') ? (
                <ReanalyzeButton video={group.video} />
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

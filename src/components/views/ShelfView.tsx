'use client';

/**
 * View 1 – the virtual bookcase. Visible books stand on walnut shelves (optionally grouped by
 * topic, author initial or reading status, each group its own case with a brass label plate),
 * packed plank by plank from the measured width. Real spine photos, compact / comfortable size,
 * hover pull-out, arrow-key navigation, lamp light in dark mode, bookends and a leaning last book.
 * The "lying" arrangement puts the books on their sides in piles, two per plank on a phone, with the
 * titles readable left to right. A filter, order or setting change re-shelves the books with an
 * animation (reshelve.ts). In the phone app the options live in the bottom submenu (AppSubmenu).
 */
import { RectangleHorizontal, RectangleVertical, Rows3, Rows4 } from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { AppSubmenu, SubmenuChip, SubmenuDivider, SubmenuGroup, useAppSubmenu } from '@/components/app/AppSubmenu';
import { READING_STATUS_META } from '@/components/books';
import { shelfRowHeight, type SpineSize } from '@/components/books/spine-layout';
import { useCollection } from '@/components/collection/context';
import { Select, SegmentedControl, Switch } from '@/components/ui';
import { useUiTranslator } from '@/components/ui/hooks';
import { topicDef, topicLabel } from '@/lib/taxonomy';
import type { BookDTO, ReadingStatus } from '@/lib/types';
import { KeyboardHint, ViewOptionsBar, VisualEmptyState } from './visual/common';
import {
  isBoolean,
  isOneOf,
  scrollBehavior,
  useElementWidth,
  useLatest,
  useStoredState,
  useViewportHeight,
} from './visual/hooks';
import { useReshelve } from './visual/reshelve';
import { ShelfCase, StackCase } from './visual/ShelfCase';
import {
  buildShelfLayout,
  DENSITY_SIZE,
  groupShelfBooks,
  keyToShelfMove,
  SHELF_DENSITIES,
  SHELF_GROUP_BYS,
  shelfNeighbour,
  type ShelfDensity,
  type ShelfGroupBy,
} from './visual/shelf-layout';
import { buildStackLayout } from './visual/stack-layout';
import { ShelfGhosts, type GhostRow } from './visual/ShelfGhost';
import { SHELF_DENSITY_DATASET, SHELF_DENSITY_KEY } from './visual/shelf-density';
import { SpineHoverCard } from './visual/SpineHoverCard';

/** Up to this many books every spine is interactive from the start (full a11y tree, no placeholders). */
const EAGER_LIMIT = 250;
/**
 * The skeleton shown until the width is measured (the server HTML and the moment before hydration) is
 * a ghost of the real bookcase laid out at this width – the catalogue's content column on a desktop
 * screen – so a small library is not drawn as a wall of planks that collapses once the page is alive.
 */
const SKELETON_WIDTH = 1104;
/** planks the skeleton draws at most (what is above the fold) */
const SKELETON_MAX_ROWS = 2;
/** books laid out for the skeleton: plenty for its planks, bounded for huge libraries */
const SKELETON_MAX_BOOKS = 200;
/** target of the "skip past the bookcase" link (one shelf view per page) */
const SHELF_END_ID = 'exl-shelf-end';

/** standing spines, or books lying on their sides in piles */
type ShelfArrangement = 'standing' | 'lying';
const SHELF_ARRANGEMENTS: readonly ShelfArrangement[] = ['standing', 'lying'];

const isGroupBy = isOneOf(SHELF_GROUP_BYS);
const isDensity = isOneOf(SHELF_DENSITIES);
const isArrangement = isOneOf(SHELF_ARRANGEMENTS);

export function ShelfView() {
  const { books, visibleBooks: liveBooks, locale, openBookId, openBook, filters, sort } = useCollection();
  const { t, tp } = useUiTranslator();
  const inApp = useAppSubmenu();

  const [groupBy, setGroupBy] = useStoredState<ShelfGroupBy>('exl.visual.shelf.groupBy', 'none', isGroupBy);
  const [density, setDensity] = useStoredState<ShelfDensity>(SHELF_DENSITY_KEY, 'comfortable', isDensity);
  const [photoPref, setPhoto] = useStoredState<boolean>('exl.visual.shelf.photo', false, isBoolean);
  const [arrangement, setArrangement] = useStoredState<ShelfArrangement>('exl.visual.shelf.arrangement', 'standing', isArrangement);
  const size = DENSITY_SIZE[density];
  const lying = arrangement === 'lying';

  // anything that rearranges the books takes them off the shelf and puts them back one by one
  const signature = useMemo(() => JSON.stringify([filters, sort, groupBy, density, arrangement]), [filters, sort, groupBy, density, arrangement]);
  const { shown: visibleBooks, className: reshelveClass } = useReshelve(liveBooks, signature);

  // the ghost bookcases (here, and in the loading skeleton of the next catalogue) follow the reader's density
  useEffect(() => {
    document.documentElement.dataset[SHELF_DENSITY_DATASET] = density;
  }, [density]);

  const hasSpinePhotos = useMemo(() => books.some((b) => Boolean(b.spineImage)), [books]);
  const photo = photoPref && hasSpinePhotos;

  const [widthRef, width] = useElementWidth<HTMLDivElement>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      widthRef(el);
    },
    [widthRef],
  );

  // relayouts of big collections render in the background while the window is being resized
  const layoutWidth = useDeferredValue(width);
  const groups = useMemo(() => groupShelfBooks(visibleBooks, groupBy, locale), [visibleBooks, groupBy, locale]);
  const layout = useMemo(
    () => (layoutWidth === null || lying ? null : buildShelfLayout(groups, layoutWidth, size)),
    [groups, layoutWidth, size, lying],
  );
  const stacks = useMemo(
    () => (layoutWidth === null || !lying ? null : buildStackLayout(groups, layoutWidth, size)),
    [groups, layoutWidth, size, lying],
  );
  /** place of each plank's first book in reading order (re-shelving animation) */
  const rowOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let n = 0;
    for (const row of layout?.rows ?? []) {
      offsets.set(row.key, n);
      n += row.spines.length;
    }
    return offsets;
  }, [layout]);
  const booksById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const viewportHeight = useViewportHeight();
  // planks mounted with the first paint: the visible ones plus one (the observer adds the rest)
  const initialRows = Math.ceil(viewportHeight / shelfRowHeight(size)) + 1;
  const eager = visibleBooks.length <= EAGER_LIMIT;

  // stable click handler for memoised rows
  const openBookRef = useLatest(openBook);
  const onOpen = useCallback((book: BookDTO) => openBookRef.current(book.id), [openBookRef]);

  /* ---------------- keyboard navigation ---------------- */
  const [keepMountedRow, setKeepMountedRow] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null);
  const seq = useRef(0);

  const rowKeyOf = useCallback(
    (id: string) => {
      const pos = layout?.position.get(id);
      return pos ? layout!.rows[pos[0]].key : null;
    },
    [layout],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!layout || e.altKey || e.shiftKey) return;
    const target = e.target as HTMLElement;
    const spine = target.closest<HTMLElement>('[data-book-id][role="button"]');
    if (!spine || !e.currentTarget.contains(spine)) return;
    const move = keyToShelfMove(e.key, e.ctrlKey || e.metaKey);
    if (!move) return;
    e.preventDefault();
    const next = shelfNeighbour(layout, spine.dataset.bookId ?? '', move);
    if (!next) return;
    seq.current += 1;
    setKeepMountedRow(rowKeyOf(next));
    setFocusRequest({ id: next, seq: seq.current });
  };

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const spine = (e.target as HTMLElement).closest<HTMLElement>('[data-book-id]');
    const id = spine?.dataset.bookId;
    if (!id) return;
    const key = rowKeyOf(id);
    if (key && key !== keepMountedRow) setKeepMountedRow(key);
  };

  useEffect(() => {
    if (!focusRequest) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-book-id="${cssEscape(focusRequest.id)}"][role="button"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setFocusRequest(null);
  }, [focusRequest, layout, keepMountedRow]);

  /* ---------------- labels ---------------- */
  const groupLabel = (key: string): string => {
    switch (groupBy) {
      case 'topic': {
        const def = topicDef(key);
        return def ? `${def.icon}\u2002${topicLabel(key, locale)}` : topicLabel(key, locale);
      }
      case 'author':
        return key === '#' ? t('visual.shelf.noInitial') : key;
      case 'status':
        return t((READING_STATUS_META[key as ReadingStatus] ?? READING_STATUS_META.unknown).labelKey);
      default:
        return '';
    }
  };
  const groupPlainLabel = (key: string): string =>
    groupBy === 'topic' ? topicLabel(key, locale) : groupBy === 'none' ? t('common.aria.bookshelf') : groupLabel(key);

  /* ---------------- render ---------------- */
  const options = inApp ? (
    <AppSubmenu>
      <SubmenuGroup label={t('visual.shelf.arrangement')}>
        <SubmenuChip active={!lying} onClick={() => setArrangement('standing')} icon={<RectangleVertical aria-hidden="true" />}>
          {t('visual.shelf.arrangement.standing')}
        </SubmenuChip>
        <SubmenuChip active={lying} onClick={() => setArrangement('lying')} icon={<RectangleHorizontal aria-hidden="true" />}>
          {t('visual.shelf.arrangement.lying')}
        </SubmenuChip>
      </SubmenuGroup>
      <SubmenuDivider />
      <SubmenuGroup label={t('visual.shelf.groupBy')}>
        {SHELF_GROUP_BYS.map((g) => (
          <SubmenuChip key={g} active={groupBy === g} onClick={() => setGroupBy(g)}>
            {t(`visual.shelf.groupShort.${g}`)}
          </SubmenuChip>
        ))}
      </SubmenuGroup>
      <SubmenuDivider />
      <SubmenuGroup label={t('visual.shelf.size')}>
        <SubmenuChip active={density === 'compact'} onClick={() => setDensity('compact')} icon={<Rows4 aria-hidden="true" />}>
          {t('visual.shelf.size.compact')}
        </SubmenuChip>
        <SubmenuChip active={density === 'comfortable'} onClick={() => setDensity('comfortable')} icon={<Rows3 aria-hidden="true" />}>
          {t('visual.shelf.size.comfortable')}
        </SubmenuChip>
      </SubmenuGroup>
      {hasSpinePhotos ? (
        <>
          <SubmenuDivider />
          <SubmenuChip active={photo} onClick={() => setPhoto(!photo)}>
            {t('visual.shelf.realSpines')}
          </SubmenuChip>
        </>
      ) : null}
    </AppSubmenu>
  ) : (
    <ViewOptionsBar
      aside={
        visibleBooks.length > 0 ? (
          <KeyboardHint keys={['←', '→', '↑', '↓']} action={t('visual.keys.move')} secondKeys={['Enter']} secondAction={t('visual.keys.open')} />
        ) : undefined
      }
    >
      <label className="flex items-center gap-2 text-sm text-muted">
        <span className="shrink-0">{t('visual.shelf.groupBy')}</span>
        <Select
          size="sm"
          value={groupBy}
          onChange={(e) => setGroupBy(isGroupBy(e.target.value) ? e.target.value : 'none')}
          options={SHELF_GROUP_BYS.map((g) => ({ value: g, label: t(`visual.shelf.group.${g}`) }))}
          wrapperClassName="min-w-[10.5rem]"
        />
      </label>
      <SegmentedControl<ShelfArrangement>
        aria-label={t('visual.shelf.arrangement')}
        size="sm"
        value={arrangement}
        onChange={setArrangement}
        options={[
          { value: 'standing', label: t('visual.shelf.arrangement.standing'), icon: <RectangleVertical aria-hidden="true" /> },
          { value: 'lying', label: t('visual.shelf.arrangement.lying'), icon: <RectangleHorizontal aria-hidden="true" /> },
        ]}
      />
      <SegmentedControl<ShelfDensity>
        aria-label={t('visual.shelf.size')}
        size="sm"
        value={density}
        onChange={setDensity}
        options={[
          { value: 'compact', label: t('visual.shelf.size.compact'), icon: <Rows4 aria-hidden="true" /> },
          { value: 'comfortable', label: t('visual.shelf.size.comfortable'), icon: <Rows3 aria-hidden="true" /> },
        ]}
      />
      <Switch
        size="sm"
        checked={photo}
        disabled={!hasSpinePhotos}
        onCheckedChange={setPhoto}
        label={t('visual.shelf.realSpines')}
        title={hasSpinePhotos ? t('visual.shelf.realSpines.hint') : t('visual.shelf.realSpines.unavailable')}
      />
    </ViewOptionsBar>
  );

  if (visibleBooks.length === 0) {
    return (
      <section aria-label={t('common.aria.bookshelf')}>
        {options}
        <VisualEmptyState />
      </section>
    );
  }

  return (
    <section aria-label={t('common.aria.bookshelf')} className="exl-shelf-view">
      {options}
      <p className="sr-only">{t('visual.shelf.keyboard')}</p>
      {/* every spine is a tab stop: let keyboard users jump over hundreds of them */}
      {/* same pattern as the kit's <VisuallyHidden focusable>, which only renders span props */}
      <a
        href={`#${SHELF_END_ID}`}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          const end = document.getElementById(SHELF_END_ID);
          if (!end) return;
          e.preventDefault();
          end.focus({ preventScroll: true });
          end.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
        }}
        className="sr-only focus:not-sr-only focus:mb-3 focus:inline-flex focus:rounded-lg focus:bg-surface focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-ink focus:shadow-soft"
      >
        {t('visual.shelf.skip')}
      </a>
      <div ref={setContainer} className={`relative flex flex-col gap-10 pt-2 ${reshelveClass}`} onKeyDown={onKeyDown} onFocus={onFocus}>
        {stacks !== null ? (
          stacks.groups.map((group) => (
            <StackCase
              key={`${groupBy}:${group.key}`}
              group={group}
              size={size}
              stackWidth={stacks.stackWidth}
              scale={stacks.scale}
              label={groupBy === 'none' ? undefined : groupLabel(group.key)}
              count={groupBy === 'none' ? undefined : group.books.length}
              ariaLabel={t('visual.shelf.caseLabel', {
                label: groupPlainLabel(group.key),
                books: tp('visual.books', group.books.length),
              })}
              photo={photo}
              openBookId={openBookId}
              onOpen={onOpen}
              eager={eager}
              initialStacks={initialRows * stacks.perPlank}
            />
          ))
        ) : layout === null ? (
          <ShelfSkeleton books={visibleBooks} />
        ) : (
          layout.groups.map((group) => {
            const labelText = groupBy === 'none' ? undefined : groupLabel(group.key);
            return (
              <ShelfCase
                key={`${groupBy}:${group.key}`}
                group={group}
                size={size}
                plank={layout.plank}
                gap={layout.gap}
                label={labelText}
                count={groupBy === 'none' ? undefined : group.books.length}
                ariaLabel={t('visual.shelf.caseLabel', {
                  label: groupPlainLabel(group.key),
                  books: tp('visual.books', group.books.length),
                })}
                photo={photo}
                openBookId={openBookId}
                onOpen={onOpen}
                eager={eager}
                keepMountedRow={keepMountedRow}
                initialRows={initialRows}
                rowOffsets={rowOffsets}
              />
            );
          })
        )}
        <SpineHoverCard containerRef={containerRef} booksById={booksById} />
      </div>
      <div id={SHELF_END_ID} tabIndex={-1} className="h-px outline-none" />
    </section>
  );
}

/** The planks of the ghost bookcase at one size: the real books laid out at the desktop content width. */
function ghostRows(books: readonly BookDTO[], size: SpineSize): GhostRow[] {
  return buildShelfLayout([{ key: 'all', books: books.slice(0, SKELETON_MAX_BOOKS) }], SKELETON_WIDTH, size)
    .rows.slice(0, SKELETON_MAX_ROWS)
    .map((r) => ({
      key: r.key,
      startBookend: r.startBookend,
      spines: r.spines.map((spine) => ({ key: spine.book.id, width: spine.width, height: spine.height })),
    }));
}

/** Until the width is measured: a ghost bookcase in each density, CSS shows the one the reader chose. */
function ShelfSkeleton({ books }: { books: readonly BookDTO[] }) {
  const bySize = useMemo(() => new Map(SHELF_DENSITIES.map((d) => [DENSITY_SIZE[d], ghostRows(books, DENSITY_SIZE[d])] as const)), [books]);
  return <ShelfGhosts rowsFor={(size) => bySize.get(size) ?? []} />;
}

/** CSS.escape with a fallback for environments without it (ids are UUIDs, but stay safe). */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Heart, Palette, RotateCcw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { useCollection } from '@/components/collection/context';
import { TOOLBAR_ID } from '@/components/collection/Toolbar';
import {
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  EmptyState,
  SegmentedControl,
  useMediaQuery,
  type DropdownMenuItem,
} from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';
import { sortBooks } from '@/lib/book-utils';
import type { BookDTO, ReadingStatus } from '@/lib/types';
import { oneOf, useElementSize, useIsoLayoutEffect, useLatest, usePersistentState, useStickyChromeOffset } from './data/hooks';
import type { EditFinish } from './data/InlineTextEditor';
import {
  applyLocalSort,
  applyRangeSelection,
  COLUMN_WIDTHS,
  DEFAULT_HIDDEN_COLUMNS,
  DENSITIES,
  headerCheckState,
  headerSortState,
  HIDEABLE_COLUMNS,
  isHiddenColumnList,
  navigationTarget,
  nextSortState,
  rangeIds,
  ROW_HEIGHT,
  scrollTopToReveal,
  stickyTitleOffset,
  tableMinWidth,
  titleFirst,
  toggleAllSelection,
  visibleColumns,
  WINDOWING_THRESHOLD,
  windowRange,
  type ColumnKey,
  type Density,
  type LocalSort,
} from './data/table';
import { TableRow, type EditableField, type RowHandlers } from './data/TableRow';

const HIDDEN_COLUMNS_KEY = 'exl.data.table.hiddenColumns';
const DENSITY_KEY = 'exl.data.table.density';
const DOUBLE_CLICK_DELAY = 260;
/** clicks on these never open the drawer */
const INTERACTIVE = 'a,button,input,select,textarea,label,[role="radiogroup"],[role="radio"],[data-row-ignore]';

const COLUMN_LABEL: Record<ColumnKey, MessageKey> = {
  select: 'data.table.col.select',
  shelf: 'data.table.col.shelf',
  color: 'data.table.col.color',
  author: 'data.table.col.author',
  title: 'data.table.col.title',
  year: 'data.table.col.year',
  topics: 'data.table.col.topics',
  language: 'data.table.col.language',
  status: 'data.table.col.status',
  rating: 'data.table.col.rating',
  favorite: 'data.table.col.favorite',
  confidence: 'data.table.col.confidence',
  added: 'data.table.col.added',
};

const RIGHT_ALIGNED: ReadonlySet<ColumnKey> = new Set(['shelf', 'year']);

/** Dense, sortable, keyboard-navigable table of the (filtered) books with owner inline editing. */
export function TableView() {
  const {
    books,
    visibleBooks,
    isOwner,
    locale,
    sort,
    setSort,
    openBook,
    openBookId,
    selection,
    toggleSelect,
    setSelection,
    clearSelection,
    updateBook,
    activeFilterCount,
    resetFilters,
  } = useCollection();
  const { t, tp } = useI18n();

  const [hidden, setHidden] = usePersistentState<ColumnKey[]>(HIDDEN_COLUMNS_KEY, [...DEFAULT_HIDDEN_COLUMNS], isHiddenColumnList);
  const [density, setDensity] = usePersistentState<Density>(DENSITY_KEY, 'comfortable', oneOf(DENSITIES));
  const narrow = useMediaQuery('(max-width: 639px)');
  // the scroll box fits the viewport below the sticky header + collection toolbar, so its own sticky
  // header row is never hidden behind them
  const chromeTop = useStickyChromeOffset(TOOLBAR_ID);
  const columns = useMemo(() => {
    const cols = visibleColumns(hidden, isOwner);
    return narrow ? titleFirst(cols) : cols;
  }, [hidden, isOwner, narrow]);
  const [localSort, setLocalSort] = useState<LocalSort | null>(null);
  const rows = useMemo(() => applyLocalSort(visibleBooks, localSort, sort, locale), [visibleBooks, localSort, sort, locale]);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);
  const shelfRank = useMemo(() => {
    const m = new Map<string, number>();
    sortBooks(books, 'shelf', locale).forEach((b, i) => m.set(b.id, i + 1));
    return m;
  }, [books, locale]);

  /* ---------------- scrolling & windowing ---------------- */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [measureRef, size] = useElementSize<HTMLDivElement>();
  const setScrollNode = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      measureRef(el);
    },
    [measureRef],
  );
  const headRef = useRef<HTMLTableSectionElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(42);
  useIsoLayoutEffect(() => {
    const h = headRef.current?.offsetHeight;
    if (h && h !== headerHeight) setHeaderHeight(h);
  });
  const rowHeight = ROW_HEIGHT[density];
  const windowed = rows.length > WINDOWING_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRaf = useRef(0);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const scrolledX = el.scrollLeft > 1 ? 'true' : 'false';
    if (el.dataset.scrolledX !== scrolledX) el.dataset.scrolledX = scrolledX;
    if (!windowed) return;
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => setScrollTop(el.scrollTop));
  };
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), []);

  const range = windowed
    ? windowRange({ scrollTop, viewportHeight: size?.height ?? 720, headerHeight, rowHeight, count: rows.length, overscan: 10 })
    : { start: 0, end: rows.length };

  /* ---------------- active row (roving tabindex) ---------------- */
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? (indexOf.get(activeId) ?? -1) : -1;
  const tabIndexRow = activeIndex >= range.start && activeIndex < range.end ? activeIndex : range.start;
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (openBookId && indexOf.has(openBookId)) setActiveId(openBookId);
  }, [openBookId, indexOf]);

  const focusRow = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const target = scrollTopToReveal(index, {
        scrollTop: el.scrollTop,
        viewportHeight: el.clientHeight,
        headerHeight: headRef.current?.offsetHeight ?? headerHeight,
        rowHeight,
      });
      if (target !== null) {
        el.scrollTop = target;
        if (windowed) setScrollTop(el.scrollTop);
      }
      let tries = 0;
      const attempt = () => {
        const row = el.querySelector<HTMLTableRowElement>(`tr[data-row-index="${index}"]`);
        if (row) {
          row.focus({ preventScroll: true });
          const r = row.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) row.scrollIntoView({ block: 'nearest' });
        } else if (tries++ < 8) {
          requestAnimationFrame(attempt);
        }
      };
      attempt();
    },
    [headerHeight, rowHeight, windowed],
  );

  const focusBook = useCallback(
    (id: string) => {
      const i = indexOf.get(id);
      if (i !== undefined) focusRow(i);
    },
    [indexOf, focusRow],
  );

  /* ---------------- editing ---------------- */
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [],
  );
  const cancelPendingOpen = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  };

  /* ---------------- handlers (stable for memoised rows) ---------------- */
  const latest = useLatest({
    rows,
    ids,
    selection,
    isOwner,
    toggleSelect,
    setSelection,
    openBook,
    updateBook,
    focusBook,
  });

  const handlers = useMemo<RowHandlers>(() => {
    const L = () => latest.current;
    return {
      rowMouseDown: (e) => {
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE)) return;
        // no text selection on shift-click (range) or double-click (edit)
        if ((L().isOwner && e.shiftKey) || e.detail > 1) e.preventDefault();
      },
      rowClick: (e, book) => {
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE)) return;
        const s = L();
        setActiveId(book.id);
        if (s.isOwner && e.shiftKey) {
          s.setSelection(applyRangeSelection(s.selection, s.ids, anchorRef.current, book.id));
          if (!anchorRef.current) anchorRef.current = book.id;
          return;
        }
        if (s.isOwner && (e.metaKey || e.ctrlKey)) {
          s.toggleSelect(book.id);
          anchorRef.current = book.id;
          return;
        }
        if (s.isOwner && target.closest('[data-editable]')) {
          // wait for a possible double-click (inline edit) before opening the drawer
          if (e.detail > 1) return;
          cancelPendingOpen();
          clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            L().openBook(book.id);
          }, DOUBLE_CLICK_DELAY);
          return;
        }
        s.openBook(book.id);
      },
      rowDoubleClick: (e, book) => {
        const s = L();
        if (!s.isOwner) return;
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE)) return;
        const cell = target.closest<HTMLElement>('[data-editable]');
        if (!cell) return;
        cancelPendingOpen();
        window.getSelection()?.removeAllRanges();
        setEditing({ id: book.id, field: cell.dataset.editable === 'author' ? 'author' : 'title' });
      },
      rowFocus: (book) => setActiveId(book.id),
      checkboxClick: (e, book) => {
        e.stopPropagation();
        const s = L();
        setActiveId(book.id);
        if (e.shiftKey && anchorRef.current && anchorRef.current !== book.id) {
          s.setSelection(applyRangeSelection(s.selection, s.ids, anchorRef.current, book.id));
        } else {
          s.toggleSelect(book.id);
          anchorRef.current = book.id;
        }
      },
      startEdit: (book, field) => {
        cancelPendingOpen();
        setActiveId(book.id);
        setEditing({ id: book.id, field });
      },
      submitEdit: (book, field, value, via: EditFinish) => {
        setEditing(null);
        const s = L();
        const clean = value.replace(/\s+/g, ' ').trim();
        if (field === 'title') {
          if (clean && clean !== book.title) void s.updateBook(book.id, { title: clean });
        } else {
          const next = clean || null;
          if (next !== (book.author?.trim() || null)) void s.updateBook(book.id, { author: next });
        }
        if (via === 'keyboard') requestAnimationFrame(() => L().focusBook(book.id));
      },
      cancelEdit: (book, via: EditFinish) => {
        setEditing(null);
        if (via === 'keyboard') requestAnimationFrame(() => L().focusBook(book.id));
      },
      setStatus: (book, status: ReadingStatus) => {
        if (status !== book.readingStatus) void L().updateBook(book.id, { readingStatus: status });
      },
      setRating: (book, rating) => {
        if (rating !== book.rating) void L().updateBook(book.id, { rating });
      },
      toggleFavorite: (book) => {
        void L().updateBook(book.id, { favorite: !book.favorite });
      },
    };
  }, [latest]);

  /* ---------------- keyboard ---------------- */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLTableRowElement>('tr[data-row-index]');
    if (!row) return;
    const index = Number(row.dataset.rowIndex);
    const book = rows[index];
    if (!book) return;

    if (target !== row) {
      // inside a cell control: Esc brings the focus back to the row (inputs handle their own Esc)
      if (e.key === 'Escape' && !target.closest('input,textarea,select')) {
        e.preventDefault();
        row.focus({ preventScroll: true });
      }
      return;
    }

    const el = scrollRef.current;
    const pageSize = Math.max(1, Math.floor(((el?.clientHeight ?? 480) - headerHeight) / rowHeight) - 1);
    const next = navigationTarget(e.key, index, rows.length, pageSize);
    if (next !== null) {
      e.preventDefault();
      const nextId = rows[next].id;
      if (isOwner && e.shiftKey) {
        const anchor = anchorRef.current ?? book.id;
        anchorRef.current = anchor;
        setSelection([...new Set([...selection, ...rangeIds(ids, anchor, nextId)])]);
      }
      setActiveId(nextId);
      focusRow(next);
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        cancelPendingOpen();
        openBook(book.id);
        break;
      case ' ':
        if (isOwner) {
          e.preventDefault();
          toggleSelect(book.id);
          anchorRef.current = book.id;
        }
        break;
      case 'Escape':
        if (isOwner && selection.size > 0) {
          e.preventDefault();
          clearSelection();
        }
        break;
      case 'F2':
        if (isOwner) {
          e.preventDefault();
          setEditing({ id: book.id, field: 'title' });
        }
        break;
      case 'a':
      case 'A':
        if (isOwner && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setSelection([...new Set([...selection, ...ids])]);
        }
        break;
      default:
        break;
    }
  };

  /* ---------------- header ---------------- */
  const onSortClick = (column: ColumnKey) => {
    const next = nextSortState(column, sort, localSort);
    if (next.setSort) setSort(next.setSort);
    setLocalSort(next.local);
  };

  const checkState = headerCheckState(selection, ids);
  const stickyLeft = stickyTitleOffset(columns);
  const minWidth = tableMinWidth(columns);

  const columnItems: DropdownMenuItem[] = [
    { type: 'label', label: t('data.table.columns.menu') },
    ...HIDEABLE_COLUMNS.map<DropdownMenuItem>((key) => ({
      type: 'checkbox',
      key,
      label: t(key === 'shelf' ? 'data.table.col.shelfLong' : COLUMN_LABEL[key]),
      checked: !hidden.includes(key),
      onCheckedChange: (on: boolean) => setHidden(on ? hidden.filter((k) => k !== key) : [...hidden, key]),
    })),
    { type: 'separator' },
    {
      key: 'reset',
      label: t('data.table.columns.reset'),
      icon: <RotateCcw aria-hidden="true" />,
      onSelect: () => setHidden([...DEFAULT_HIDDEN_COLUMNS]),
    },
  ];

  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm text-muted" aria-live="polite">
        <span className="font-medium text-ink tabular-nums">{tp('common.unit.book', rows.length)}</span>
        {isOwner && selection.size > 0 ? (
          <span className="tabular-nums"> · {tp('data.table.selected', selection.size)}</span>
        ) : null}
      </p>
      <p id="data-table-hint" className="hidden text-xs text-muted lg:block">
        {t(isOwner ? 'data.table.hint.owner' : 'data.table.hint.viewer')}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <SegmentedControl<Density>
          size="sm"
          aria-label={t('data.table.density.label')}
          value={density}
          onChange={setDensity}
          options={DENSITIES.map((v) => ({ value: v, label: t(`data.table.density.${v}`) }))}
        />
        <DropdownMenu
          aria-label={t('data.table.columns.menu')}
          trigger={
            <Button size="sm" leftIcon={<Columns3 aria-hidden="true" />}>
              <span className="max-sm:sr-only">{t('data.table.columns')}</span>
            </Button>
          }
          items={columnItems}
          minWidth={220}
        />
      </div>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div>
        {toolbar}
        <div className="rounded-card border border-line bg-surface shadow-soft">
          {books.length === 0 ? (
            <EmptyState title={t('data.empty.noBooks.title')} description={t('data.empty.noBooks.description')} />
          ) : (
            <EmptyState
              title={t('data.empty.noResults.title')}
              description={t('data.empty.noResults.description')}
              action={activeFilterCount > 0 ? <Button onClick={resetFilters}>{t('data.filters.reset')}</Button> : undefined}
            />
          )}
        </div>
      </div>
    );
  }

  const rendered = rows.slice(range.start, range.end);

  return (
    <div>
      {toolbar}
      <div
        ref={setScrollNode}
        onScroll={onScroll}
        data-scrolled-x="false"
        style={{ '--chrome-top': `${chromeTop}px` } as CSSProperties}
        className="relative max-h-[max(24rem,calc(100dvh-var(--chrome-top)-1.5rem))] overflow-auto overscroll-x-contain rounded-card border border-line bg-surface shadow-soft"
      >
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-left"
          style={{ minWidth }}
          aria-label={t('data.table.label')}
          aria-describedby="data-table-hint"
          aria-rowcount={windowed ? rows.length + 1 : undefined}
          aria-multiselectable={isOwner || undefined}
        >
          <colgroup>
            {columns.map((key) => (
              <col key={key} style={key === 'title' ? undefined : { width: COLUMN_WIDTHS[key] }} />
            ))}
          </colgroup>
          <thead ref={headRef}>
            <tr aria-rowindex={windowed ? 1 : undefined}>
              {columns.map((key) => {
                const sticky = key === 'select' || key === 'title';
                const base = cn(
                  'sticky top-0 border-b border-line bg-surface-2 px-3 py-2.5 text-xs font-semibold tracking-[0.04em] whitespace-nowrap text-muted uppercase',
                  sticky ? 'z-[3]' : 'z-[2]',
                  key === 'title' &&
                    "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-3 after:translate-x-full after:bg-[linear-gradient(90deg,hsl(var(--shadow-color)/0.12),transparent)] after:opacity-0 after:transition-opacity after:content-[''] [[data-scrolled-x=true]_&]:after:opacity-100",
                );
                const style = key === 'select' ? { left: 0 } : key === 'title' ? { left: stickyLeft } : undefined;
                if (key === 'select') {
                  return (
                    <th key={key} scope="col" className={base} style={style}>
                      <span className="flex items-center justify-center">
                        <Checkbox
                          size="sm"
                          checked={checkState === 'all'}
                          indeterminate={checkState === 'some'}
                          onCheckedChange={() => setSelection(toggleAllSelection(selection, ids))}
                          aria-label={t('data.table.selectAll')}
                          className="[&>span]:mt-0"
                        />
                      </span>
                    </th>
                  );
                }
                const state = headerSortState(key, sort, localSort);
                const label = t(COLUMN_LABEL[key]);
                const Icon = state === 'ascending' ? ArrowUp : state === 'descending' ? ArrowDown : ArrowUpDown;
                return (
                  <th key={key} scope="col" aria-sort={state} className={base} style={style}>
                    <button
                      type="button"
                      onClick={() => onSortClick(key)}
                      title={t('data.table.sortBy', { column: key === 'shelf' ? t('data.table.col.shelfLong') : label })}
                      className={cn(
                        'group/sort -mx-1.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 uppercase transition-colors hover:bg-surface hover:text-ink',
                        RIGHT_ALIGNED.has(key) && 'flex-row-reverse',
                        state !== 'none' && 'text-ink',
                      )}
                    >
                      {key === 'color' ? (
                        <>
                          <Palette aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="sr-only">{label}</span>
                        </>
                      ) : key === 'favorite' ? (
                        <>
                          <Heart aria-hidden="true" className="size-3.5 shrink-0" />
                          <span className="sr-only">{label}</span>
                        </>
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'size-3 shrink-0 transition-opacity',
                          state === 'none' ? 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60' : 'text-accent',
                        )}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody onKeyDown={onBodyKeyDown}>
            {range.start > 0 ? (
              <tr aria-hidden="true" style={{ height: range.start * rowHeight }}>
                <td colSpan={columns.length} className="p-0" />
              </tr>
            ) : null}
            {rendered.map((book: BookDTO, i) => {
              const index = range.start + i;
              return (
                <TableRow
                  key={book.id}
                  book={book}
                  index={index}
                  columns={columns}
                  isOwner={isOwner}
                  selected={selection.has(book.id)}
                  tabbable={index === tabIndexRow}
                  editing={editing?.id === book.id ? editing.field : null}
                  shelfRank={shelfRank.get(book.id)}
                  rowHeight={rowHeight}
                  headerHeight={headerHeight}
                  stickyTitleLeft={stickyLeft}
                  ariaRowIndex={windowed ? index + 2 : undefined}
                  handlers={handlers}
                />
              );
            })}
            {range.end < rows.length ? (
              <tr aria-hidden="true" style={{ height: (rows.length - range.end) * rowHeight }}>
                <td colSpan={columns.length} className="p-0" />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}


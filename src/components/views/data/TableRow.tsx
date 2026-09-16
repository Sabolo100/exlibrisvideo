'use client';

import { CircleAlert, Heart, PenLine } from 'lucide-react';
import { memo, useEffect, useRef, type MouseEvent } from 'react';
import { ConfidenceMeter, READING_STATUS_META, ReadingStatusBadge, TopicChip } from '@/components/books';
import { Badge, Checkbox, cn, IconButton, Select, StarRating, Tooltip, VisuallyHidden } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { bookTopicKeys, isPendingReview, languageName, spineColor } from '@/lib/book-utils';
import { topicLabel } from '@/lib/taxonomy';
import { READING_STATUSES, type BookDTO, type ReadingStatus } from '@/lib/types';
import { InlineTextEditor, type EditFinish } from './InlineTextEditor';
import type { ColumnKey } from './table';

export type EditableField = 'title' | 'author';

/** Handlers shared by every row (stable identity – rows are memoised). */
export interface RowHandlers {
  rowClick: (e: MouseEvent<HTMLTableRowElement>, book: BookDTO) => void;
  rowDoubleClick: (e: MouseEvent<HTMLTableRowElement>, book: BookDTO) => void;
  rowMouseDown: (e: MouseEvent<HTMLTableRowElement>) => void;
  rowFocus: (book: BookDTO) => void;
  checkboxClick: (e: MouseEvent<HTMLInputElement>, book: BookDTO) => void;
  startEdit: (book: BookDTO, field: EditableField) => void;
  submitEdit: (book: BookDTO, field: EditableField, value: string, via: EditFinish) => void;
  cancelEdit: (book: BookDTO, via: EditFinish) => void;
  setStatus: (book: BookDTO, status: ReadingStatus) => void;
  setRating: (book: BookDTO, rating: number | null) => void;
  toggleFavorite: (book: BookDTO) => void;
}

export interface TableRowProps {
  book: BookDTO;
  index: number;
  columns: readonly ColumnKey[];
  isOwner: boolean;
  selected: boolean;
  /** the row that takes part in the tab order (roving tabindex) */
  tabbable: boolean;
  editing: EditableField | null;
  shelfRank: number | undefined;
  rowHeight: number;
  headerHeight: number;
  stickyTitleLeft: number;
  /** aria-rowindex when windowed */
  ariaRowIndex?: number;
  handlers: RowHandlers;
}

/** Background shared by the row and its sticky cells (sticky cells must paint their own). */
const ROW_BG =
  'bg-surface group-hover:bg-[color-mix(in_oklab,var(--surface-2)_70%,var(--surface))] group-data-[selected=true]:bg-[color-mix(in_oklab,var(--accent-soft)_75%,var(--surface))]';

function Dash() {
  const { t } = useI18n();
  return (
    <span className="text-muted/70">
      <span aria-hidden="true">—</span>
      <VisuallyHidden>{t('data.noData')}</VisuallyHidden>
    </span>
  );
}

/** StarRating whose star buttons leave the tab order while the row is not the active one. */
function RatingCell({ book, tabbable, onChange, label }: { book: BookDTO; tabbable: boolean; onChange: (v: number | null) => void; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const rating = book.rating;
  useEffect(() => {
    const stars = ref.current?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
    if (!stars?.length) return;
    const current = rating ? Math.round(rating) - 1 : 0;
    stars.forEach((star, i) => {
      star.tabIndex = tabbable && i === Math.max(0, Math.min(stars.length - 1, current)) ? 0 : -1;
    });
  }, [tabbable, rating]);
  return (
    <span ref={ref} className="inline-flex" data-row-ignore="">
      <StarRating value={rating} onChange={onChange} size="sm" label={label} />
    </span>
  );
}

function EditableText({
  book,
  field,
  editing,
  isOwner,
  tabbable,
  handlers,
  className,
}: {
  book: BookDTO;
  field: EditableField;
  editing: boolean;
  isOwner: boolean;
  tabbable: boolean;
  handlers: RowHandlers;
  className?: string;
}) {
  const { t } = useI18n();
  const value = field === 'title' ? book.title : (book.author ?? '');
  if (editing && isOwner) {
    return (
      <InlineTextEditor
        initial={value}
        label={t(field === 'title' ? 'data.table.edit.title' : 'data.table.edit.author')}
        placeholder={field === 'author' ? t('data.table.edit.authorPlaceholder') : undefined}
        required={field === 'title'}
        requiredMessage={t('data.table.edit.titleRequired')}
        onSubmit={(v, via) => handlers.submitEdit(book, field, v, via)}
        onCancel={(via) => handlers.cancelEdit(book, via)}
      />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn('min-w-0 truncate', className)}
        title={value || undefined}
        data-editable={isOwner ? field : undefined}
      >
        {value || (field === 'author' ? <span className="text-muted italic">{t('common.book.unknownAuthor')}</span> : null)}
      </span>
      {isOwner ? (
        <IconButton
          size="xs"
          variant="ghost"
          icon={<PenLine />}
          aria-label={`${t(field === 'title' ? 'data.table.edit.title' : 'data.table.edit.author')}: ${book.title}`}
          tabIndex={tabbable ? 0 : -1}
          className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-60"
          onClick={(e) => {
            e.stopPropagation();
            handlers.startEdit(book, field);
          }}
        />
      ) : null}
    </span>
  );
}

function TableRowImpl({
  book,
  index,
  columns,
  isOwner,
  selected,
  tabbable,
  editing,
  shelfRank,
  rowHeight,
  headerHeight,
  stickyTitleLeft,
  ariaRowIndex,
  handlers,
}: TableRowProps) {
  const { t, n, d, locale } = useI18n();
  const controlTab = tabbable ? 0 : -1;
  const pending = isOwner && isPendingReview(book);

  const cell = (key: ColumnKey) => {
    switch (key) {
      case 'select':
        return (
          <td
            key={key}
            className={cn('sticky left-0 z-[1] border-b border-line/70 px-3', ROW_BG)}
            data-row-ignore=""
          >
            <span className="flex items-center justify-center">
              <Checkbox
                size="sm"
                checked={selected}
                onChange={() => undefined}
                onClick={(e) => handlers.checkboxClick(e, book)}
                aria-label={t('data.table.selectRow', { title: book.title })}
                tabIndex={controlTab}
                className="[&>span]:mt-0"
              />
            </span>
          </td>
        );
      case 'shelf':
        return (
          <td key={key} className="border-b border-line/70 px-3 text-right text-xs text-muted tabular-nums">
            {shelfRank !== undefined ? n(shelfRank) : <Dash />}
          </td>
        );
      case 'color': {
        const color = spineColor(book);
        return (
          <td key={key} className="border-b border-line/70 px-2">
            <span
              aria-hidden="true"
              className="mx-auto block h-5 w-2.5 rounded-[2px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12),1px_1px_2px_rgb(0_0_0/0.15)]"
              style={{ background: `linear-gradient(90deg, rgb(0 0 0 / 0.2), transparent 35%, rgb(255 255 255 / 0.18) 55%, rgb(0 0 0 / 0.18)), ${color}` }}
            />
          </td>
        );
      }
      case 'author':
        return (
          <td key={key} className="border-b border-line/70 px-3 text-sm text-ink">
            <EditableText book={book} field="author" editing={editing === 'author'} isOwner={isOwner} tabbable={tabbable} handlers={handlers} />
          </td>
        );
      case 'title':
        return (
          <th
            key={key}
            scope="row"
            className={cn(
              'sticky z-[1] border-b border-line/70 px-3 text-left text-sm font-medium text-ink',
              "after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-3 after:translate-x-full after:bg-[linear-gradient(90deg,hsl(var(--shadow-color)/0.12),transparent)] after:opacity-0 after:transition-opacity after:content-['']",
              '[[data-scrolled-x=true]_&]:after:opacity-100',
              ROW_BG,
            )}
            style={{ left: stickyTitleLeft }}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {pending ? (
                <Tooltip content={t('data.table.needsReview')}>
                  <span tabIndex={-1} className="inline-flex shrink-0 text-warning" role="img" aria-label={t('data.table.needsReview')}>
                    <CircleAlert aria-hidden="true" className="size-3.5" />
                  </span>
                </Tooltip>
              ) : null}
              <EditableText
                book={book}
                field="title"
                editing={editing === 'title'}
                isOwner={isOwner}
                tabbable={tabbable}
                handlers={handlers}
                className="font-display text-[0.9375rem] font-semibold"
              />
            </span>
          </th>
        );
      case 'year':
        return (
          <td key={key} className="border-b border-line/70 px-3 text-right text-sm text-ink tabular-nums">
            {typeof book.firstPublishedYear === 'number' ? book.firstPublishedYear : <Dash />}
          </td>
        );
      case 'topics': {
        const keys = bookTopicKeys(book);
        // one chip that may truncate plus a "+N" badge: a second chip would be clipped mid-word
        const shown = keys.slice(0, 1);
        const rest = keys.slice(1);
        return (
          <td key={key} className="border-b border-line/70 px-3">
            {keys.length === 0 ? (
              <Dash />
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                {shown.map((k) => (
                  <TopicChip key={k} topic={k} size="sm" className="max-w-[calc(100%-2.25rem)] min-w-0 shrink" />
                ))}
                {rest.length > 0 ? (
                  <Badge size="sm" tone="neutral" title={t('data.table.moreTopics', { topics: rest.map((k) => topicLabel(k, locale)).join(', ') })}>
                    +{n(rest.length)}
                  </Badge>
                ) : null}
              </span>
            )}
          </td>
        );
      }
      case 'language':
        return (
          <td key={key} className="truncate border-b border-line/70 px-3 text-sm text-ink">
            {book.language ? <span title={book.language}>{languageName(book.language, locale)}</span> : <Dash />}
          </td>
        );
      case 'status':
        return (
          <td key={key} className="border-b border-line/70 px-3" data-row-ignore={isOwner ? '' : undefined}>
            {isOwner ? (
              <Select
                size="sm"
                value={READING_STATUSES.includes(book.readingStatus) ? book.readingStatus : 'unknown'}
                onChange={(e) => handlers.setStatus(book, e.target.value as ReadingStatus)}
                aria-label={t('data.table.statusFor', { title: book.title })}
                tabIndex={controlTab}
                options={READING_STATUSES.map((s) => ({ value: s, label: t(READING_STATUS_META[s].labelKey) }))}
              />
            ) : book.readingStatus === 'unknown' ? (
              <Dash />
            ) : (
              <ReadingStatusBadge status={book.readingStatus} size="sm" />
            )}
          </td>
        );
      case 'rating':
        return (
          <td key={key} className="border-b border-line/70 px-3">
            {isOwner ? (
              <RatingCell
                book={book}
                tabbable={tabbable}
                label={t('data.table.ratingFor', { title: book.title })}
                onChange={(v) => handlers.setRating(book, v)}
              />
            ) : book.rating ? (
              <StarRating value={book.rating} size="sm" />
            ) : (
              <Dash />
            )}
          </td>
        );
      case 'favorite':
        return (
          <td key={key} className="border-b border-line/70 px-1 text-center">
            {isOwner ? (
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={t('data.table.favorite.toggle', { title: book.title })}
                aria-pressed={book.favorite}
                tabIndex={controlTab}
                icon={<Heart className={book.favorite ? 'fill-burgundy text-burgundy' : undefined} />}
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.toggleFavorite(book);
                }}
              />
            ) : book.favorite ? (
              <span role="img" aria-label={t('data.table.favorite.yes')} className="inline-flex text-burgundy">
                <Heart aria-hidden="true" className="size-4 fill-current" />
              </span>
            ) : null}
          </td>
        );
      case 'confidence':
        return (
          <td key={key} className="border-b border-line/70 px-3">
            <span className="inline-flex items-center gap-2">
              <ConfidenceMeter value={book.confidence} size="sm" />
              <span className="text-xs text-muted tabular-nums" aria-hidden="true">
                {n(Math.round(Math.min(1, Math.max(0, book.confidence || 0)) * 100))}%
              </span>
            </span>
          </td>
        );
      case 'added':
        return (
          <td key={key} className="truncate border-b border-line/70 px-3 text-xs text-muted tabular-nums">
            {Number.isNaN(Date.parse(book.createdAt)) ? <Dash /> : d(book.createdAt, { year: 'numeric', month: 'short', day: 'numeric' })}
          </td>
        );
      default:
        return null;
    }
  };

  return (
    <tr
      data-row-index={index}
      data-book-id={book.id}
      data-selected={selected || undefined}
      aria-rowindex={ariaRowIndex}
      tabIndex={tabbable ? 0 : -1}
      className={cn(
        'group cursor-pointer outline-none transition-colors duration-100',
        'bg-surface hover:bg-[color-mix(in_oklab,var(--surface-2)_70%,var(--surface))] data-[selected=true]:bg-[color-mix(in_oklab,var(--accent-soft)_75%,var(--surface))]',
        '[&:focus-visible>*]:shadow-[inset_0_2px_0_var(--focus),inset_0_-2px_0_var(--focus)]',
        '[&:focus-visible>*:first-child]:shadow-[inset_2px_0_0_var(--focus),inset_0_2px_0_var(--focus),inset_0_-2px_0_var(--focus)]',
        '[&:focus-visible>*:last-child]:shadow-[inset_-2px_0_0_var(--focus),inset_0_2px_0_var(--focus),inset_0_-2px_0_var(--focus)]',
      )}
      style={{ height: rowHeight, scrollMarginTop: headerHeight }}
      onClick={(e) => handlers.rowClick(e, book)}
      onDoubleClick={(e) => handlers.rowDoubleClick(e, book)}
      onMouseDown={handlers.rowMouseDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget) handlers.rowFocus(book);
      }}
    >
      {columns.map((key) => cell(key))}
    </tr>
  );
}

export const TableRow = memo(TableRowImpl);

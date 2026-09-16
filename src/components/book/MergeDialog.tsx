'use client';

import { Combine, Hand, Info, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { BookSpine, ConfidenceMeter, TopicChip } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { Badge, Button, Dialog, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';
import { isPendingReview, languageName } from '@/lib/book-utils';
import { topicLabel } from '@/lib/taxonomy';
import type { BookDTO } from '@/lib/types';
import { pickDefaultKeep, previewMerge, type MergeFillField } from './book-form-utils';
import { invalidateFrames } from './frames-store';

export interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceIds: string[];
  /** called with the merged (kept) book after a successful merge */
  onMerged?: (book: BookDTO) => void;
}

const FIELD_LABEL: Record<MergeFillField, MessageKey> = {
  author: 'book.form.author',
  subtitle: 'book.form.subtitle',
  originalTitle: 'book.form.originalTitle',
  series: 'book.form.series',
  publisher: 'book.form.publisher',
  language: 'book.form.language',
  firstPublishedYear: 'book.form.firstPublishedYear',
  editionYear: 'book.form.editionYear',
  isbn: 'book.form.isbn',
  pageCount: 'book.form.pageCount',
  category: 'book.form.category',
};

/** Owner: merge several entries of the same book into one (choose which entry survives, preview, confirm). */
export function MergeDialog({ open, onOpenChange, sourceIds, onMerged }: MergeDialogProps) {
  const { t, tp, n, locale } = useI18n();
  const { books, mergeBooks, clearSelection, isOwner, collection } = useCollection();
  const groupName = useId();

  // while the merge request runs the provider already removes the merged entries optimistically:
  // keep showing the books as they were when the user confirmed
  const [frozen, setFrozen] = useState<BookDTO[] | null>(null);
  const live = useMemo(() => {
    const byId = new Map(books.map((b) => [b.id, b]));
    return [...new Set(sourceIds)].map((id) => byId.get(id)).filter((b): b is BookDTO => Boolean(b));
  }, [books, sourceIds]);
  const selected = frozen ?? live;
  const missing = new Set(sourceIds).size - selected.length;

  // default choice, re-evaluated whenever the dialog opens for another set of books
  const sourceKey = `${open ? 1 : 0}|${[...new Set(sourceIds)].sort().join(',')}`;
  const [choice, setChoice] = useState<{ key: string; id: string | null }>({ key: '', id: null });
  let keepId = choice.key === sourceKey ? choice.id : null;
  if (!keepId || !selected.some((b) => b.id === keepId)) keepId = pickDefaultKeep(selected)?.id ?? null;
  const keep = selected.find((b) => b.id === keepId) ?? null;
  const others = selected.filter((b) => b.id !== keepId);
  const preview = keep && others.length > 0 ? previewMerge(keep, others) : null;

  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    onOpenChange(false);
  };

  const confirm = async () => {
    if (!keep || others.length === 0 || busy) return;
    setBusy(true);
    setFrozen(selected);
    const merged = await mergeBooks(keep.id, others.map((b) => b.id));
    setBusy(false);
    setFrozen(null);
    if (!merged) return; // provider rolled back and showed the error (success is toasted there too)
    // detections moved to the kept book: the cached frame boxes are stale
    invalidateFrames(collection.id);
    clearSelection();
    onOpenChange(false);
    onMerged?.(merged);
  };

  if (!isOwner) return null;

  const enough = selected.length >= 2;

  const fieldValue = (field: MergeFillField, value: string | number) => {
    if (field === 'language') return languageName(String(value), locale);
    if (field === 'category') return topicLabel(String(value), locale);
    return typeof value === 'number' && field === 'pageCount' ? n(value) : String(value);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('book.merge.title')}
      description={t('book.merge.description')}
      icon={<Combine />}
      size="lg"
      closeOnOverlayClick={!busy}
      footer={
        enough ? (
          <>
            <Button onClick={close} disabled={busy}>
              {t('common.action.cancel')}
            </Button>
            <Button variant="primary" leftIcon={<Combine />} loading={busy} disabled={!preview} onClick={() => void confirm()}>
              {t('book.merge.confirm')}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t('common.action.close')}</Button>
        )
      }
    >
      {!enough ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {missing > 0 ? t('book.merge.missing') : t('book.merge.notEnough')}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {missing > 0 ? (
            <p className="flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('book.merge.missing')}
            </p>
          ) : null}

          <fieldset className="min-w-0">
            <legend className="mb-1 text-sm font-medium text-ink">{t('book.merge.keepLabel')}</legend>
            <p className="mb-3 text-[0.8125rem] leading-snug text-muted">{t('book.merge.keepHint')}</p>
            <div className="flex max-h-[min(22rem,40dvh)] flex-col gap-2 overflow-y-auto overscroll-contain p-0.5">
              {selected.map((book) => {
                const checked = book.id === keepId;
                return (
                  <label
                    key={book.id}
                    className={cn(
                      'relative flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-[border-color,background-color,box-shadow] duration-150',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                      checked
                        ? 'border-primary bg-[color-mix(in_oklab,var(--primary)_7%,var(--surface))] shadow-[0_0_0_1px_var(--primary)]'
                        : 'border-line bg-surface hover:border-[color-mix(in_oklab,var(--line),var(--ink)_20%)]',
                    )}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      value={book.id}
                      checked={checked}
                      onChange={() => setChoice({ key: sourceKey, id: book.id })}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        checked ? 'border-primary' : 'border-[color-mix(in_oklab,var(--line),var(--ink)_25%)]',
                      )}
                    >
                      {checked ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                    </span>
                    <BookSpine book={book} size="xs" photo decorative />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-ink">{book.title}</span>
                      <span className="truncate text-sm text-muted">{book.author ?? t('common.book.unknownAuthor')}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        {book.source === 'manual' ? (
                          <span className="inline-flex items-center gap-1">
                            <Hand className="size-3" aria-hidden="true" />
                            {t('book.evidence.source.manual')}
                          </span>
                        ) : (
                          <>
                            <ConfidenceMeter value={book.confidence} size="sm" showLabel />
                            {book.detectionCount > 0 ? <span>{tp('book.evidence.seenIn', book.detectionCount)}</span> : null}
                          </>
                        )}
                        {book.firstPublishedYear ? <span className="tabular-nums">{book.firstPublishedYear}</span> : null}
                        {book.publisher ? <span className="max-w-40 truncate">{book.publisher}</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {checked ? (
                        <Badge tone="green" size="sm">
                          {t('book.merge.keepBadge')}
                        </Badge>
                      ) : null}
                      {isPendingReview(book) ? (
                        <Badge tone="gold" size="sm">
                          {t('book.merge.pendingReview')}
                        </Badge>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {preview ? (
            <section aria-live="polite" className="rounded-card border border-line bg-surface-2/50 p-4">
              <h3 className="mb-2 font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase">{t('book.merge.preview')}</h3>
              <div className="flex items-start gap-3">
                <BookSpine book={preview.evidenceFrom ?? preview.keep} size="sm" photo decorative />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg leading-tight font-semibold text-balance [overflow-wrap:anywhere]">{preview.keep.title}</p>
                  <p className="text-sm text-muted">
                    {preview.keep.author ?? preview.filled.find((f) => f.field === 'author')?.value ?? t('common.book.unknownAuthor')}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
                    {preview.detectionCount > 0 ? <li>{tp('book.merge.preview.detections', preview.detectionCount)}</li> : null}
                    {preview.evidenceFrom && preview.evidenceFrom.id !== preview.keep.id ? (
                      <li className="text-muted">{t('book.merge.preview.spine')}</li>
                    ) : null}
                    {/* the API marks the merged entry as reviewed */}
                    {selected.some(isPendingReview) ? <li className="text-muted">{t('book.merge.preview.reviewed')}</li> : null}
                  </ul>
                  {preview.filled.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-muted">{t('book.merge.preview.filled')}</p>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                        {preview.filled.map((f) => (
                          <div key={f.field} className="contents">
                            <dt className="text-muted">{t(FIELD_LABEL[f.field])}</dt>
                            <dd className="min-w-0 truncate text-ink">{fieldValue(f.field, f.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}
                  {preview.topics.length > 0 ? (
                    <div className="mt-3">
                      <p className="sr-only">{t('book.merge.preview.topics')}</p>
                      <div className="flex flex-wrap gap-1">
                        {preview.topics.map((topic) => (
                          <TopicChip key={topic} topic={topic} size="sm" />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 border-t border-line/70 pt-3 text-[0.8125rem] text-muted">
                {preview.others.some((b) => b.detectionCount > 0)
                  ? tp('book.merge.preview.removed', preview.others.length)
                  : tp('book.merge.preview.removedPlain', preview.others.length)}
              </p>
              {preview.lostOwnerData.map((b) => (
                <p key={b.id} className="mt-2 flex items-start gap-2 text-[0.8125rem] text-[#8a5a12] dark:text-warning">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{t('book.merge.preview.lostData', { title: b.title })}</span>
                </p>
              ))}
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

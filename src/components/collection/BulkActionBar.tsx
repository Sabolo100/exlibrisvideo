'use client';

/**
 * Floating action bar for the multi-selection (owner): reading status, main topic, merge, delete
 * (with confirmation), select all visible, clear. Appears while at least one book is selected.
 */
import { AnimatePresence, motion } from 'motion/react';
import { BookMarked, ChevronUp, Combine, ListChecks, Shapes, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { READING_STATUS_META } from '@/components/books';
import { MergeDialog } from '@/components/book/MergeDialog';
import { Button, Dialog, DropdownMenu, IconButton, Portal, type DropdownMenuItem } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { TOPIC_GROUP_LABELS, TOPICS } from '@/lib/taxonomy';
import { READING_STATUSES } from '@/lib/types';
import { useCollection } from './context';
import { quoteTitle, titleSample } from './labels';
import { mainTopicPatch } from './mutations';
import { useCollectionShell } from './shell-context';

export function BulkActionBar() {
  const { t, tp, n, locale } = useI18n();
  const { isOwner, books, visibleBooks, selection, setSelection, clearSelection, deleteBooks } = useCollection();
  const { bulkUpdate } = useCollectionShell();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const count = selection.size;
  const ids = [...selection];
  const selectedBooks = books.filter((b) => selection.has(b.id));
  const visibleIds = visibleBooks.map((b) => b.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));

  // Esc clears the selection when no overlay is open and focus is not in a text field
  useEffect(() => {
    if (count === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, clearSelection]);

  if (!isOwner) return null;

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const statusItems: DropdownMenuItem[] = READING_STATUSES.map((status) => {
    const meta = READING_STATUS_META[status];
    const Icon = meta.icon;
    const all = selectedBooks.length > 0 && selectedBooks.every((b) => b.readingStatus === status);
    return {
      type: 'radio',
      key: status,
      label: t(meta.labelKey),
      icon: <Icon />,
      checked: all,
      onSelect: () => void run(() => bulkUpdate(ids, (book) => (book.readingStatus === status ? null : { readingStatus: status }))),
    };
  });

  const topicItems: DropdownMenuItem[] = [];
  (Object.keys(TOPIC_GROUP_LABELS) as (keyof typeof TOPIC_GROUP_LABELS)[]).forEach((group, index) => {
    if (index > 0) topicItems.push({ type: 'separator', key: `sep-${group}` });
    topicItems.push({ type: 'label', key: `label-${group}`, label: TOPIC_GROUP_LABELS[group][locale] });
    for (const topic of TOPICS.filter((d) => d.group === group)) {
      const all = selectedBooks.length > 0 && selectedBooks.every((b) => b.category === topic.key);
      topicItems.push({
        type: 'radio',
        key: topic.key,
        label: topic[locale],
        textValue: topic[locale],
        icon: (
          <span aria-hidden="true" className="text-[0.9375rem] leading-none">
            {topic.icon}
          </span>
        ),
        checked: all,
        onSelect: () => void run(() => bulkUpdate(ids, (book) => mainTopicPatch(book, topic.key))),
      });
    }
  });

  const confirmDelete = async () => {
    const targets = ids;
    setConfirmOpen(false);
    await run(() => deleteBooks(targets));
    clearSelection();
  };

  const deleteTitle = tp('collection.bulk.deleteTitle', count);

  return (
    <>
      <Portal>
        <AnimatePresence>
          {count > 0 ? (
            <motion.div
              key="bulk-bar"
              role="toolbar"
              aria-label={t('collection.bulk.label')}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-3xl flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface/95 p-2 pl-3 shadow-lift backdrop-blur-md sm:inset-x-6 sm:gap-2 print:hidden"
            >
              <p aria-live="polite" className="mr-auto flex items-center gap-2 text-sm font-semibold whitespace-nowrap text-ink tabular-nums">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs text-primary-ink">{n(count)}</span>
                <span className="max-sm:sr-only">{tp('collection.bulk.selected', count)}</span>
              </p>

              {!allVisibleSelected && visibleIds.length > count ? (
                <Button size="sm" variant="ghost" leftIcon={<ListChecks className="size-4" />} onClick={() => setSelection(visibleIds)} disabled={busy}>
                  <span className="max-md:sr-only">{t('collection.bulk.selectVisible', { count: n(visibleIds.length) })}</span>
                </Button>
              ) : null}

              <DropdownMenu
                aria-label={t('collection.bulk.statusMenu')}
                side="top"
                align="end"
                minWidth={220}
                items={statusItems}
                trigger={
                  <Button size="sm" leftIcon={<BookMarked className="size-4" />} rightIcon={<ChevronUp className="size-3.5 opacity-60" />} disabled={busy}>
                    {t('collection.bulk.status')}
                  </Button>
                }
              />
              <DropdownMenu
                aria-label={t('collection.bulk.topicMenu')}
                side="top"
                align="end"
                minWidth={248}
                items={topicItems}
                trigger={
                  <Button size="sm" leftIcon={<Shapes className="size-4" />} rightIcon={<ChevronUp className="size-3.5 opacity-60" />} disabled={busy}>
                    {t('collection.bulk.topic')}
                  </Button>
                }
              />
              <Button
                size="sm"
                leftIcon={<Combine className="size-4" />}
                disabled={busy || count < 2}
                title={count < 2 ? t('collection.bulk.mergeHint') : undefined}
                onClick={() => {
                  setMergeIds(ids);
                  setMergeOpen(true);
                }}
              >
                {t('collection.bulk.merge')}
              </Button>
              <Button size="sm" variant="secondary" tone="danger" leftIcon={<Trash2 className="size-4" />} disabled={busy} onClick={() => setConfirmOpen(true)}>
                {t('collection.bulk.delete')}
              </Button>
              <IconButton size="sm" aria-label={t('collection.bulk.clear')} tooltip icon={<X />} onClick={clearSelection} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Portal>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tone="danger"
        size="sm"
        icon={<Trash2 />}
        title={deleteTitle}
        description={t('collection.bulk.deleteDescription')}
        initialFocusRef={cancelRef}
        footer={
          <>
            <Button ref={cancelRef} onClick={() => setConfirmOpen(false)}>
              {t('common.action.cancel')}
            </Button>
            <Button variant="danger" leftIcon={<Trash2 className="size-4" />} onClick={() => void confirmDelete()}>
              {t('collection.bulk.delete')}
            </Button>
          </>
        }
      >
        {selectedBooks.length > 0 ? (
          <p className="text-sm text-pretty break-words text-muted">
            {count === 1 ? quoteTitle(selectedBooks[0].title, locale) : t('collection.bulk.deleteList', { titles: titleSample(selectedBooks, locale) })}
          </p>
        ) : null}
      </Dialog>

      <MergeDialog
        open={mergeOpen}
        onOpenChange={(open) => {
          setMergeOpen(open);
          if (!open) setMergeIds([]);
        }}
        sourceIds={mergeIds}
        onMerged={() => clearSelection()}
      />
    </>
  );
}

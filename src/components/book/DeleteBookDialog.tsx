'use client';

import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useCollection } from '@/components/collection/context';
import { Button, Dialog } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { BookDTO } from '@/lib/types';

export interface DeleteBookDialogProps {
  book: BookDTO | null;
  open: boolean;
  onClose: () => void;
  /** called after the book is gone */
  onDeleted?: (book: BookDTO) => void;
  /** focus the destructive button (fast keyboard flow: Del, then Enter) instead of Cancel */
  focusConfirm?: boolean;
}

/** Waits until React has committed the provider's state changes (rollback on failure). */
function afterCommit(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** "Delete this book?" confirmation. The provider removes it optimistically and rolls back + toasts on failure. */
export function DeleteBookDialog({ book, open, onClose, onDeleted, focusConfirm = false }: DeleteBookDialogProps) {
  const { t } = useI18n();
  const { deleteBooks, books } = useCollection();
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const booksRef = useRef(books);
  booksRef.current = books;

  const confirm = async () => {
    if (!book || busy) return;
    setBusy(true);
    let failed = false;
    try {
      await deleteBooks([book.id]);
      await afterCommit();
      failed = booksRef.current.some((b) => b.id === book.id);
    } catch {
      failed = true;
    }
    setBusy(false);
    if (failed) return; // the provider has already shown the error (and confirms success with its own toast)
    onClose();
    onDeleted?.(book);
  };

  return (
    <Dialog
      open={open && Boolean(book)}
      onClose={busy ? () => {} : onClose}
      title={t('book.delete.title')}
      description={book ? t('book.delete.body', { title: book.title }) : undefined}
      tone="danger"
      icon={<Trash2 />}
      size="sm"
      initialFocusRef={focusConfirm ? confirmRef : cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button ref={confirmRef} variant="danger" leftIcon={<Trash2 />} loading={busy} onClick={() => void confirm()}>
            {t('common.action.delete')}
          </Button>
        </>
      }
    />
  );
}

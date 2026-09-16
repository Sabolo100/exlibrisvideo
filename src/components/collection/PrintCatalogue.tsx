'use client';

/**
 * Print-only catalogue (window.print / Ctrl+P): the books currently shown, grouped by author.
 * It is mounted on the first `beforeprint` (flushSync, so the snapshot already contains it) instead of
 * keeping hundreds of hidden rows in the DOM; the screen never shows it.
 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useI18n } from '@/i18n/client';
import { useCollection } from './context';
import { collectionTitle } from './labels';
import { groupBooksForPrint, printDetails } from './print';

export function PrintCatalogue() {
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  useEffect(() => {
    const arm = () => {
      const now = new Date();
      try {
        flushSync(() => setPrintedAt(now));
      } catch {
        setPrintedAt(now);
      }
    };
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const onMedia = (event: MediaQueryListEvent) => {
      if (event.matches) arm();
    };
    window.addEventListener('beforeprint', arm);
    mql?.addEventListener?.('change', onMedia);
    return () => {
      window.removeEventListener('beforeprint', arm);
      mql?.removeEventListener?.('change', onMedia);
    };
  }, []);

  return printedAt ? <PrintCatalogueContent printedAt={printedAt} /> : null;
}

/** The printable list itself (hidden on screen). */
export function PrintCatalogueContent({ printedAt }: { printedAt: Date }) {
  const { t, tp, d, locale } = useI18n();
  const { collection, books, visibleBooks, activeFilterCount } = useCollection();
  const groups = useMemo(() => groupBooksForPrint(visibleBooks, locale), [visibleBooks, locale]);
  const filtered = activeFilterCount > 0 && visibleBooks.length !== books.length;

  return (
    <section className="exl-print-catalogue hidden print:block" aria-hidden="true">
      <div className="exl-print-meta">
        <span>{t('collection.print.heading')}</span>
        <span>{t('collection.print.generated', { date: d(printedAt, { dateStyle: 'long' }) })}</span>
        <span>{t('collection.print.link', { url: collection.publicUrl })}</span>
      </div>
      <p className="exl-print-summary">
        {filtered
          ? t('collection.print.filtered', { shown: visibleBooks.length, total: books.length })
          : tp('collection.header.books', books.length)}
        {' – '}
        {collectionTitle(collection, t)}
      </p>

      <div className="exl-print-groups">
        {groups.map((group) => (
          <div key={group.key || '__none__'} className="exl-print-group">
            <h2 className="exl-print-author">{group.author ?? t('collection.print.noAuthor')}</h2>
            <ol className="exl-print-books">
              {group.books.map((book) => {
                const details = printDetails(book);
                return (
                  <li key={book.id}>
                    <span className="exl-print-title">
                      {book.title}
                      {book.subtitle ? `: ${book.subtitle}` : ''}
                    </span>
                    {details ? <span className="exl-print-details"> · {details}</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

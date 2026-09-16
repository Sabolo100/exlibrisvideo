import { FileSpreadsheet, Mail, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { getServerT } from '@/i18n/server';
import { BookCover } from '@/components/books/BookCover';
import { SAMPLE_BOOKS } from '@/components/books/sample-books';
import { Shelf } from '@/components/books/Shelf';
import { cn } from '@/components/ui/cn';
import type { BookDTO } from '@/lib/types';
import { SectionHeading } from './SectionHeading';

function byTitle(title: string, fallbackIndex: number): BookDTO {
  return SAMPLE_BOOKS.find((b) => b.title === title) ?? SAMPLE_BOOKS[fallbackIndex % SAMPLE_BOOKS.length];
}

function Tile({ title, text, preview, className }: { title: string; text: string; preview: ReactNode; className?: string }) {
  return (
    <li className={cn('flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-soft', className)}>
      <div aria-hidden="true" className="relative flex h-48 items-center justify-center overflow-hidden border-b border-line/70 bg-surface-2/60 px-4">
        {preview}
      </div>
      <div className="flex flex-col gap-1.5 p-5">
        <h3 className="font-display text-lg leading-snug font-semibold text-ink">{title}</h3>
        <p className="text-[0.9375rem] leading-relaxed text-muted text-pretty">{text}</p>
      </div>
    </li>
  );
}

/** "What you get" preview tiles: shelf, covers, statistics, table, Excel by e-mail. */
export async function WhatYouGet() {
  const { t, n } = await getServerT();
  const shelfBooks = SAMPLE_BOOKS.slice(0, 22);
  const covers = [byTitle('Az ajtó', 0), byTitle('A Mester és Margarita', 1), byTitle('Utas és holdvilág', 2)];
  const rows = [byTitle('Sorstalanság', 3), byTitle('Egri csillagok', 4), byTitle('1984', 5), byTitle('Száz év magány', 6)];
  // donut segments (percent of the ring)
  const segments = [
    { pct: 38, className: 'stroke-primary' },
    { pct: 24, className: 'stroke-accent' },
    { pct: 20, className: 'stroke-burgundy' },
    { pct: 18, className: 'stroke-wood-light' },
  ];
  const circumference = 2 * Math.PI * 30;
  let offset = 0;

  return (
    <section id="what-you-get" aria-labelledby="landing-get-title" className="scroll-mt-20 border-y border-line/70 bg-surface-2/40">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="landing-get-title" eyebrow={t('landing.get.eyebrow')} title={t('landing.get.title')} lead={t('landing.get.lead')} />
        <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          <Tile
            className="sm:col-span-2"
            title={t('landing.get.shelf.title')}
            text={t('landing.get.shelf.text')}
            preview={
              <div className="w-full max-w-xl">
                <div className="sm:hidden">
                  <Shelf books={shelfBooks} size="xs" bookends />
                </div>
                <div className="max-sm:hidden">
                  <Shelf books={shelfBooks} size="sm" bookends />
                </div>
              </div>
            }
          />
          <Tile
            title={t('landing.get.covers.title')}
            text={t('landing.get.covers.text')}
            preview={
              <div className="relative h-40 w-56">
                {covers.map((book, i) => (
                  <div
                    key={book.id}
                    className="absolute top-2 w-[6.25rem] shadow-lift"
                    style={{ left: `${i * 3.6}rem`, transform: `rotate(${(i - 1) * 7}deg)`, zIndex: i === 1 ? 2 : 1 }}
                  >
                    <BookCover book={book} generatedOnly decorative />
                  </div>
                ))}
              </div>
            }
          />
          <Tile
            title={t('landing.get.stats.title')}
            text={t('landing.get.stats.text')}
            preview={
              <div className="flex w-full max-w-xs items-center gap-5">
                <svg viewBox="0 0 80 80" className="size-28 shrink-0 -rotate-90">
                  <circle cx={40} cy={40} r={30} className="stroke-line" strokeWidth={12} fill="none" />
                  {segments.map((s) => {
                    const length = (s.pct / 100) * circumference;
                    const el = (
                      <circle
                        key={s.className}
                        cx={40}
                        cy={40}
                        r={30}
                        fill="none"
                        strokeWidth={12}
                        className={s.className}
                        strokeDasharray={`${length - 1.5} ${circumference - length + 1.5}`}
                        strokeDashoffset={-offset}
                      />
                    );
                    offset += length;
                    return el;
                  })}
                </svg>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: n(248), label: t('landing.get.stats.books') },
                    { value: n(131), label: t('landing.get.stats.authors') },
                    { value: n(6.2), label: t('landing.get.stats.metres') },
                  ].map((s) => (
                    <p key={s.label} className="flex items-baseline gap-1.5">
                      <span className="font-display text-2xl leading-none font-semibold text-ink tabular-nums">{s.value}</span>
                      <span className="text-xs text-muted">{s.label}</span>
                    </p>
                  ))}
                </div>
              </div>
            }
          />
          <Tile
            title={t('landing.get.table.title')}
            text={t('landing.get.table.text')}
            preview={
              <table className="w-full max-w-xs table-fixed overflow-hidden rounded-lg border border-line bg-surface text-left text-[0.6875rem]">
                <thead className="bg-surface-2 text-muted">
                  <tr>
                    <th className="w-[38%] px-2 py-1.5 font-semibold">{t('landing.get.table.author')}</th>
                    <th className="px-2 py-1.5 font-semibold">{t('landing.get.table.bookTitle')}</th>
                    <th className="w-[18%] px-2 py-1.5 text-right font-semibold">{t('landing.get.table.year')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="border-t border-line/70">
                      <td className="truncate px-2 py-1.5 text-muted">{b.author}</td>
                      <td className="truncate px-2 py-1.5 font-medium text-ink">{b.title}</td>
                      <td className="px-2 py-1.5 text-right text-muted tabular-nums">{b.firstPublishedYear ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
          <Tile
            title={t('landing.get.email.title')}
            text={t('landing.get.email.text')}
            preview={
              <div className="w-full max-w-xs rounded-xl border border-line bg-surface p-3.5 shadow-soft">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-ink [&_svg]:size-4">
                    <Mail />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{t('landing.get.email.from')}</p>
                    <p className="truncate text-xs text-muted">{t('landing.get.email.subject')}</p>
                  </div>
                </div>
                <p className="mt-2.5 text-xs text-ink">{t('landing.get.email.body')}</p>
                <div className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink">
                  <Paperclip className="size-3.5 shrink-0 text-muted" />
                  <FileSpreadsheet className="size-4 shrink-0 text-success" />
                  <span className="truncate font-medium">{t('landing.get.email.attachment')}</span>
                </div>
              </div>
            }
          />
        </ul>
      </div>
    </section>
  );
}

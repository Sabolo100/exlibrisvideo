import { ArrowRight, Search, SlidersHorizontal, Tag } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { SAMPLE_BOOKS } from '@/components/books/sample-books';
import { Shelf } from '@/components/books/Shelf';
import { VIEW_META } from '@/components/collection/view-meta';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import type { ViewKey } from '@/lib/types';
import { SectionHeading } from './SectionHeading';

const PEEK_VIEWS: ViewKey[] = ['shelf', 'covers', 'table', 'authors', 'topics', 'stats'];

/**
 * A quick peek at a finished library: the page header, the views, a few tags and two shelves of books –
 * what the visitor will get after the recording. Static (decorative), server-rendered.
 */
export async function LibraryPeek({ demoCollectionId }: { demoCollectionId?: string | null }) {
  const { t, tp } = await getServerT();
  // two full rows that run past the edge of the window (never wrap)
  const half = Math.ceil(SAMPLE_BOOKS.length / 2);
  const rows = [SAMPLE_BOOKS.slice(0, half), [...SAMPLE_BOOKS.slice(half), ...SAMPLE_BOOKS.slice(0, 6).map((b) => ({ ...b, id: `${b.id}-again` }))]];
  const count = 214;

  return (
    <section aria-labelledby="landing-peek-title" className="scroll-mt-20">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="landing-peek-title" eyebrow={t('landing.peek.eyebrow')} title={t('landing.peek.title')} lead={t('landing.peek.lead')} />

        {/* a browser-like window with a library in it */}
        <div aria-hidden="true" className="mt-10 overflow-hidden rounded-card border border-line bg-surface shadow-lift sm:mt-12">
          <div className="flex items-center gap-1.5 border-b border-line/70 bg-surface-2/70 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#e5484d]/70" />
            <span className="size-2.5 rounded-full bg-[#f5b74f]/80" />
            <span className="size-2.5 rounded-full bg-[#46a758]/70" />
            <span className="ml-3 truncate rounded-md bg-bg px-3 py-0.5 font-mono text-xs text-muted">exlibrisvideo.hu/334345435</span>
          </div>

          <div className="flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-display text-xs tracking-[0.3em] text-accent uppercase italic">Ex libris</p>
                <p className="font-display text-2xl leading-tight font-semibold text-ink sm:text-3xl">{t('landing.peek.libraryName')}</p>
                <p className="mt-1 text-sm text-muted">
                  {tp('collection.header.books', count)} · {tp('collection.header.authors', 168)}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-muted max-sm:hidden">
                  <Search className="size-4" />
                  {t('landing.peek.search')}
                </span>
                <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-ink">
                  <SlidersHorizontal className="size-4" />
                  {t('landing.peek.filters')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-line/70 pb-3">
              {PEEK_VIEWS.map((v, i) => {
                const Icon = VIEW_META[v].icon;
                return (
                  <span
                    key={v}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium [&_svg]:size-4',
                      i === 0 ? 'bg-accent-soft text-ink' : 'text-muted',
                      i > 3 && 'max-sm:hidden',
                    )}
                  >
                    <Icon />
                    {t(VIEW_META[v].labelKey)}
                  </span>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[t('landing.peek.tag1'), t('landing.peek.tag2'), t('landing.peek.tag3')].map((tag, i) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium [&_svg]:size-3.5',
                    i === 0 ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-bg text-ink',
                  )}
                >
                  <Tag />
                  {tag}
                </span>
              ))}
            </div>

            <style>{'[data-peek-shelves] [role="list"] { flex-wrap: nowrap; overflow: hidden; }'}</style>
            <div data-peek-shelves="" className="flex flex-col gap-2.5">
              {rows.map((row, r) => (
                <div key={r}>
                  <div className="sm:hidden">
                    <Shelf books={row} size="xs" bookends={r === 0} />
                  </div>
                  <div className="max-sm:hidden">
                    <Shelf books={row} size="sm" bookends={r === 0} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {demoCollectionId ? (
          <div className="mt-6 flex justify-center">
            <Button href={`/${demoCollectionId}`} variant="secondary" rightIcon={<ArrowRight />}>
              {t('landing.hero.demo')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

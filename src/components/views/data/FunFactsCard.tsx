'use client';

import { CalendarClock, CalendarRange, Hourglass, Lightbulb, Quote, Sparkles, WholeWord } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/client';
import type { BookDTO } from '@/lib/types';
import { DashboardCard } from './ChartKit';
import { PAGES_PER_DAY, type CollectionStats } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface FunFactsCardProps {
  stats: CollectionStats;
  onOpenBook: (id: string) => void;
  className?: string;
  delay?: number;
}

interface Fact {
  key: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  book?: BookDTO;
}

/** Oldest / newest book, longest title, most common title word, busiest decade, reading time. */
export function FunFactsCard({ stats, onOpenBook, className, delay }: FunFactsCardProps) {
  const { t, tp, n } = useI18n();
  const fmt = useStatsFormat();
  const f = stats.facts;
  const byline = (b: BookDTO) => {
    const author = b.author?.trim() || t('common.book.unknownAuthor');
    return typeof b.firstPublishedYear === 'number' ? `${author} · ${fmt.yearText(b.firstPublishedYear)}` : author;
  };

  const facts: Fact[] = [];
  if (f.oldest) {
    facts.push({ key: 'oldest', icon: <Hourglass />, label: t('data.stats.facts.oldest'), value: f.oldest.title, hint: byline(f.oldest), book: f.oldest });
  }
  if (f.newest && f.newest.id !== f.oldest?.id) {
    facts.push({ key: 'newest', icon: <Sparkles />, label: t('data.stats.facts.newest'), value: f.newest.title, hint: byline(f.newest), book: f.newest });
  }
  if (f.longestTitle) {
    facts.push({
      key: 'longest',
      icon: <WholeWord />,
      label: t('data.stats.facts.longestTitle'),
      value: f.longestTitle.title,
      hint: tp('data.stats.facts.characters', [...f.longestTitle.title.trim()].length),
      book: f.longestTitle,
    });
  }
  if (f.commonWord) {
    facts.push({
      key: 'word',
      icon: <Quote />,
      label: t('data.stats.facts.commonWord'),
      value: t('data.stats.facts.commonWordValue', { word: f.commonWord.word }),
      hint: tp('data.stats.facts.commonWordCount', f.commonWord.count),
    });
  }
  if (f.topDecade && f.topDecade.count > 1) {
    facts.push({
      key: 'decade',
      icon: <CalendarRange />,
      label: t('data.stats.facts.topDecade'),
      value: fmt.decadeLabel(f.topDecade.decade),
      hint: tp('common.unit.book', f.topDecade.count),
    });
  }
  if (stats.total > 0) {
    facts.push(
      f.unreadBooks > 0
        ? {
            key: 'reading',
            icon: <CalendarClock />,
            label: t('data.stats.facts.readingTime', { pages: n(PAGES_PER_DAY) }),
            value: fmt.duration(f.readingDays),
            hint: tp('data.stats.facts.readingTimeHint', f.unreadBooks),
          }
        : { key: 'reading', icon: <CalendarClock />, label: t('data.stats.card.read'), value: t('data.stats.facts.allRead') },
    );
  }

  return (
    <DashboardCard
      title={t('data.stats.facts.title')}
      description={t('data.stats.facts.description')}
      icon={<Lightbulb />}
      className={className}
      delay={delay}
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {facts.map((fact) => (
          <li key={fact.key} className="flex min-w-0 gap-3 rounded-xl border border-line/70 bg-surface-2/40 p-3.5">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-[1.125rem]"
            >
              {fact.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">{fact.label}</p>
              {fact.book ? (
                <button
                  type="button"
                  onClick={() => onOpenBook(fact.book!.id)}
                  aria-label={t('data.stats.facts.openBook', { title: fact.book.title })}
                  className="mt-0.5 block w-full rounded-sm text-left font-display text-base leading-snug font-semibold break-words text-ink decoration-accent/60 underline-offset-[3px] hover:underline"
                >
                  <span className="line-clamp-3 text-balance">{fact.value}</span>
                </button>
              ) : (
                <p className="mt-0.5 font-display text-base leading-snug font-semibold text-balance break-words text-ink">{fact.value}</p>
              )}
              {fact.hint ? <p className="mt-0.5 text-[0.8125rem] text-muted">{fact.hint}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </DashboardCard>
  );
}

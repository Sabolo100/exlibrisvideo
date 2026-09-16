'use client';

import { BookCheck, BookOpen, Heart, Languages, Ruler, ScrollText, Shapes, Users } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Stat } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { languageName } from '@/lib/book-utils';
import { topicLabel } from '@/lib/taxonomy';
import { CountUp, EASE_OUT } from './ChartKit';
import { oneDecimal, shelfLengthDisplay } from './format';
import { usePrefersReducedMotion } from './hooks';
import { BOOK_THICKNESS_CM, percent, type CollectionStats } from './stats';

interface CardDef {
  key: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'green' | 'gold';
}

/** The row of headline numbers at the top of the dashboard. */
export function StatCards({ stats, isOwner }: { stats: CollectionStats; isOwner: boolean }) {
  const { t, n, locale } = useI18n();
  const reduced = usePrefersReducedMotion();
  const shelf = shelfLengthDisplay(stats.shelfLengthCm);
  const readPct = percent(stats.read, stats.total);
  const topLanguage = stats.languages.entries[0];

  const cards: CardDef[] = [
    {
      key: 'books',
      icon: <BookOpen />,
      label: t('data.stats.card.books'),
      value: <CountUp value={stats.total} format={(v) => n(Math.round(v))} />,
      hint:
        isOwner && stats.quality.pendingReview > 0
          ? t('data.stats.card.booksHint', { count: n(stats.quality.pendingReview) })
          : undefined,
    },
    {
      key: 'authors',
      icon: <Users />,
      label: t('data.stats.card.authors'),
      value: <CountUp value={stats.authorCount} format={(v) => n(Math.round(v))} />,
      hint: stats.authorCount > 0 ? t('data.stats.card.authorsHint', { value: n(oneDecimal(stats.booksPerAuthor)) }) : undefined,
    },
    {
      key: 'topics',
      icon: <Shapes />,
      label: t('data.stats.card.topics'),
      value: <CountUp value={stats.topicCount} format={(v) => n(Math.round(v))} />,
      hint: stats.topTopic ? t('data.stats.card.topicsHint', { label: topicLabel(stats.topTopic.key, locale) }) : undefined,
    },
    {
      key: 'languages',
      icon: <Languages />,
      label: t('data.stats.card.languages'),
      value: <CountUp value={stats.languageCount} format={(v) => n(Math.round(v))} />,
      hint: topLanguage ? t('data.stats.card.languagesHint', { label: languageName(topLanguage.key, locale) }) : undefined,
    },
    {
      key: 'pages',
      icon: <ScrollText />,
      label: t('data.stats.card.pages'),
      value: (
        <CountUp
          value={stats.pages.total}
          format={(v) => `${stats.pages.isEstimate ? '~' : ''}${n(Math.round(v))}`}
          duration={1.1}
        />
      ),
      hint: stats.pages.isEstimate
        ? t('data.stats.card.pagesHintEstimate', { per: n(stats.pages.perUnknownBook) })
        : t('data.stats.card.pagesHintExact'),
    },
    {
      key: 'shelf',
      icon: <Ruler />,
      label: t('data.stats.card.shelf'),
      value: (
        <CountUp
          value={shelf.value}
          format={(v) =>
            t(shelf.unit === 'm' ? 'data.stats.unit.m' : 'data.stats.unit.cm', {
              value: n(shelf.unit === 'm' && shelf.value < 100 ? oneDecimal(v) : Math.round(v)),
            })
          }
        />
      ),
      hint: t('data.stats.card.shelfHint', { cm: n(BOOK_THICKNESS_CM) }),
    },
    {
      key: 'favorites',
      icon: <Heart />,
      label: t('data.stats.card.favorites'),
      value: <CountUp value={stats.favorites} format={(v) => n(Math.round(v))} />,
      hint:
        stats.favorites > 0
          ? t('data.stats.card.favoritesHint', { percent: n(percent(stats.favorites, stats.total)) })
          : t('data.stats.card.favoritesNone'),
    },
    {
      key: 'read',
      icon: <BookCheck />,
      label: t('data.stats.card.read'),
      tone: 'green',
      value: <CountUp value={readPct} format={(v) => t('data.stats.percent', { value: n(Math.round(v)) })} />,
      hint: t('data.stats.card.readHint', { read: n(stats.read), total: n(stats.total) }),
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {cards.map((card, i) => (
        <motion.li
          key={card.key}
          className="min-w-0"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : i * 0.04, ease: EASE_OUT }}
        >
          <Stat
            framed
            size="md"
            tone={card.tone ?? 'gold'}
            icon={card.icon}
            label={card.label}
            value={card.value}
            hint={card.hint}
            className="h-full max-sm:flex-col max-sm:gap-2 max-sm:p-3.5"
          />
        </motion.li>
      ))}
    </ul>
  );
}

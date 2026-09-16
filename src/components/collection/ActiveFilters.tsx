'use client';

/** Removable chips for every active filter value, plus "clear all". */
import { Handshake, Heart, ScanEye, Search } from 'lucide-react';
import { READING_STATUS_META, TopicChip } from '@/components/books';
import { Button, Chip, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { languageName } from '@/lib/book-utils';
import { useCollection } from './context';
import { decadeLabel } from './labels';

export function ActiveFilters({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { filters, setFilters, resetFilters, activeFilterCount } = useCollection();
  if (activeFilterCount === 0) return null;

  const without = <T,>(list: readonly T[], value: T) => list.filter((v) => v !== value);
  const q = filters.q.trim();

  return (
    <div role="group" aria-label={t('collection.filter.active')} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {q ? (
        <Chip size="sm" icon={<Search className="size-3.5" />} onRemove={() => setFilters({ q: '' })} removeLabel={t('common.aria.remove', { label: q })}>
          {t('collection.filter.search', { q: q.length > 32 ? `${q.slice(0, 31)}…` : q })}
        </Chip>
      ) : null}
      {filters.topics.map((key) => (
        <TopicChip key={`t-${key}`} topic={key} size="sm" onRemove={() => setFilters({ topics: without(filters.topics, key) })} />
      ))}
      {filters.statuses.map((status) => {
        const meta = READING_STATUS_META[status];
        const Icon = meta.icon;
        const label = t(meta.labelKey);
        return (
          <Chip
            key={`s-${status}`}
            size="sm"
            icon={<Icon className="size-3.5" />}
            onRemove={() => setFilters({ statuses: without(filters.statuses, status) })}
            removeLabel={t('common.aria.remove', { label })}
          >
            {label}
          </Chip>
        );
      })}
      {filters.authors.map((author) => (
        <Chip
          key={`a-${author}`}
          size="sm"
          onRemove={() => setFilters({ authors: without(filters.authors, author) })}
          removeLabel={t('common.aria.remove', { label: author })}
        >
          {author}
        </Chip>
      ))}
      {filters.languages.map((code) => {
        const label = languageName(code, locale) || code;
        return (
          <Chip
            key={`l-${code}`}
            size="sm"
            onRemove={() => setFilters({ languages: without(filters.languages, code) })}
            removeLabel={t('common.aria.remove', { label })}
          >
            {label}
          </Chip>
        );
      })}
      {filters.decades.map((decade) => {
        const label = decadeLabel(decade, locale, t);
        return (
          <Chip
            key={`d-${decade}`}
            size="sm"
            onRemove={() => setFilters({ decades: without(filters.decades, decade) })}
            removeLabel={t('common.aria.remove', { label })}
          >
            {label}
          </Chip>
        );
      })}
      {filters.needsReview ? (
        <Chip size="sm" icon={<ScanEye className="size-3.5" />} onRemove={() => setFilters({ needsReview: false })} removeLabel={t('common.aria.remove', { label: t('collection.filter.needsReview') })}>
          {t('collection.filter.needsReview')}
        </Chip>
      ) : null}
      {filters.favorites ? (
        <Chip size="sm" icon={<Heart className="size-3.5" />} onRemove={() => setFilters({ favorites: false })} removeLabel={t('common.aria.remove', { label: t('collection.filter.favorites') })}>
          {t('collection.filter.favorites')}
        </Chip>
      ) : null}
      {filters.lent ? (
        <Chip size="sm" icon={<Handshake className="size-3.5" />} onRemove={() => setFilters({ lent: false })} removeLabel={t('common.aria.remove', { label: t('collection.filter.lent') })}>
          {t('collection.filter.lent')}
        </Chip>
      ) : null}
      {activeFilterCount > 1 ? (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          {t('collection.filter.clearAll')}
        </Button>
      ) : null}
    </div>
  );
}

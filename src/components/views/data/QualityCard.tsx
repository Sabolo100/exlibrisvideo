'use client';

import { CircleCheck, ClipboardCheck, ScanText, TriangleAlert } from 'lucide-react';
import { confidenceLevel } from '@/components/books';
import { Button, ProgressRing } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { CardNote, DashboardCard, SrTable } from './ChartKit';
import { ColumnChart } from './ColumnChart';
import { CONFIDENCE_COLOR } from './palette';
import type { CollectionStats, ConfidenceBand } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface QualityCardProps {
  stats: CollectionStats;
  isOwner: boolean;
  onReview: () => void;
  className?: string;
  delay?: number;
}

const LEVEL_KEY = {
  low: 'common.confidence.low',
  medium: 'common.confidence.medium',
  high: 'common.confidence.high',
} as const;

const LEVELS: readonly ConfidenceBand[] = ['low', 'medium', 'high'];

/** Recognition confidence: average, distribution, review queue (with a shortcut for owners) and sources. */
export function QualityCard({ stats, isOwner, onReview, className, delay = 0 }: QualityCardProps) {
  const { t, tp, n } = useI18n();
  const fmt = useStatsFormat();
  const q = stats.quality;
  const title = t('data.stats.quality.title');
  const recognised = q.bySource.video + q.bySource.image;
  const average = q.average === null ? null : Math.round(q.average * 100);
  const level = q.average === null ? null : confidenceLevel(q.average);
  const bucketLabel = (from: number, to: number) => t('data.stats.quality.bucket', { from: n(Math.round(from * 100)), to: n(Math.round(to * 100)) });

  return (
    <DashboardCard
      title={title}
      description={t('data.stats.quality.description')}
      icon={<ScanText />}
      className={className}
      delay={delay}
    >
      {recognised === 0 || average === null || level === null ? (
        <CardNote>{t('data.stats.quality.noRecognised')}</CardNote>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <ProgressRing
              value={average}
              size={64}
              thickness={6}
              tone={level === 'high' ? 'success' : level === 'medium' ? 'gold' : 'danger'}
              label={t('data.stats.quality.average')}
            >
              <span className="font-display text-base font-semibold text-ink">{fmt.percentText(average)}</span>
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">{t('data.stats.quality.average')}</p>
              <p className="mt-0.5 font-display text-xl leading-tight font-semibold text-ink">{t(LEVEL_KEY[level])}</p>
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-medium tracking-[0.06em] text-muted uppercase">{t('data.stats.quality.distribution')}</h4>
            <ColumnChart
              data={q.buckets.map((b) => ({
                key: `${b.from}`,
                value: b.count,
                label: bucketLabel(b.from, b.to),
                shortLabel: bucketLabel(b.from, b.to),
                color: CONFIDENCE_COLOR[b.level],
              }))}
              title={t('data.stats.quality.distribution')}
              desc={t('data.stats.quality.desc', { percent: n(average), pending: n(q.pendingReview) })}
              groupLabel={t('data.stats.quality.distribution')}
              formatValue={(v) => tp('common.unit.book', v)}
              formatNumber={(v) => n(v)}
              plotHeight={92}
              axis={false}
              capLabels="all"
              highlight="dim"
              delay={delay}
            />
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {LEVELS.map((l) => (
                <li key={l} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: CONFIDENCE_COLOR[l] }} />
                  {t(LEVEL_KEY[l])}
                </li>
              ))}
            </ul>
            <SrTable
              caption={t('data.stats.table.caption', { title: t('data.stats.quality.distribution') })}
              columns={[t('data.stats.table.confidence'), t('data.stats.table.books')]}
              rows={q.buckets.map((b) => [`${bucketLabel(b.from, b.to)} (${t(LEVEL_KEY[b.level])})`, n(b.count)])}
            />
          </div>

          {q.pendingReview > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line/70 bg-surface-2/60 px-3 py-2.5">
              <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-warning" />
              <p className="min-w-[9rem] flex-1 text-sm text-ink">
                <span className="block text-xs text-muted">{t('data.stats.quality.pending')}</span>
                <span className="font-semibold tabular-nums">{tp('common.unit.book', q.pendingReview)}</span>
              </p>
              {isOwner ? (
                <Button size="sm" variant="primary" leftIcon={<ClipboardCheck aria-hidden="true" />} onClick={onReview}>
                  {t('data.stats.quality.review')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink">
              <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-success" />
              {t('data.stats.quality.allReviewed')}
            </p>
          )}

          {q.reviewed > 0 ? <p className="-mb-2 text-xs text-muted">{tp('data.stats.quality.reviewed', q.reviewed)}</p> : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-2">
            {(['video', 'image', 'manual'] as const)
              .filter((s) => q.bySource[s] > 0)
              .map((s) => (
                <div key={s} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted">{t(`data.stats.quality.source.${s}`)}</dt>
                  <dd className="text-ink tabular-nums">{n(q.bySource[s])}</dd>
                </div>
              ))}
          </dl>

          <p className="text-xs text-muted">{t('data.stats.quality.note')}</p>
        </div>
      )}
    </DashboardCard>
  );
}

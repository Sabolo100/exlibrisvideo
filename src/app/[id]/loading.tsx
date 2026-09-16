/**
 * Loading skeleton of `/<id>`: bookplate header, toolbar and three walnut shelves of pulsing spines.
 * Server Component (no client JS); widths/heights come from a fixed pseudo-random sequence so the
 * skeleton is identical on every render.
 */
import { Skeleton } from '@/components/ui';
import { getServerT } from '@/i18n/server';

interface SpineShape {
  width: number;
  height: number;
  tone: number;
}

/** Deterministic spine row (LCG) – no Math.random, so server and client markup never differ. */
function spineRow(seed: number, count: number): SpineShape[] {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    width: Math.round(18 + next() * 16),
    height: Math.round(62 + next() * 36),
    tone: Math.floor(next() * 3),
  }));
}

const TONES = ['bg-[color-mix(in_oklab,var(--accent-soft)_38%,transparent)]', 'bg-[color-mix(in_oklab,var(--surface)_22%,transparent)]', 'bg-[color-mix(in_oklab,var(--wood-light)_55%,transparent)]'];

function ShelfSkeleton({ seed, count }: { seed: number; count: number }) {
  const spines = spineRow(seed, count);
  return (
    <div className="overflow-hidden rounded-xl border border-wood-dark/40 bg-[linear-gradient(180deg,var(--wood-dark),color-mix(in_oklab,var(--wood-dark),var(--wood)_45%))] shadow-soft">
      <div className="h-3 bg-[linear-gradient(180deg,var(--wood-light),var(--wood))]" />
      <div className="flex h-36 items-end gap-[3px] overflow-hidden px-4 sm:px-6">
        {spines.map((spine, index) => (
          <div
            key={index}
            className={`shrink-0 animate-pulse rounded-t-[3px] ${TONES[spine.tone]}`}
            style={{ width: spine.width, height: `${spine.height}%`, animationDelay: `${(index % 7) * 120}ms` }}
          />
        ))}
      </div>
      <div className="h-4 bg-[linear-gradient(180deg,var(--wood-light),var(--wood)_60%,var(--wood-dark))] shadow-[0_2px_6px_hsl(var(--shadow-color)/0.35)]" />
    </div>
  );
}

export default async function CollectionLoading() {
  const { t } = await getServerT();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('collection.loading.label')}</span>

      {/* bookplate header */}
      <div className="relative overflow-hidden rounded-card border border-line bg-surface px-5 pt-7 pb-6 shadow-soft sm:px-10 sm:pt-9 sm:pb-8">
        <span aria-hidden="true" className="pointer-events-none absolute inset-[7px] rounded-[calc(var(--radius-card)-6px)] border border-accent/25" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton width={120} height={14} />
            <Skeleton className="h-9 w-[min(28rem,85%)] sm:h-11" />
            <Skeleton width={200} height={18} />
            <div className="mt-2 flex flex-wrap gap-4">
              <Skeleton width={84} height={20} />
              <Skeleton width={84} height={20} />
              <Skeleton width={72} height={20} />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton width={104} height={40} />
            <Skeleton width={104} height={40} />
            <Skeleton width={40} height={40} />
          </div>
        </div>
      </div>

      {/* toolbar */}
      <div className="mt-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 min-w-0 flex-[1_1_16rem] md:max-w-sm" />
          <div className="ml-auto flex gap-2">
            <Skeleton width={148} height={40} />
            <Skeleton width={96} height={40} />
          </div>
        </div>
        <div className="flex gap-2 overflow-hidden">
          {[76, 88, 92, 80, 72, 84, 96].map((width, index) => (
            <Skeleton key={index} width={width} height={36} className="shrink-0" />
          ))}
        </div>
      </div>

      {/* shelves */}
      <div className="mt-6 flex flex-col gap-6" aria-hidden="true">
        <ShelfSkeleton seed={7} count={38} />
        <ShelfSkeleton seed={23} count={38} />
        <ShelfSkeleton seed={101} count={38} />
      </div>
    </div>
  );
}

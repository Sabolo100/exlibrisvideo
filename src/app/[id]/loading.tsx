/**
 * Loading skeleton of `/<id>`: a ghost of the catalogue page, laid out like the real one – bookplate header,
 * the add block (only for a signed-in visitor, who is nearly always looking at their own library), the toolbar,
 * the view options and ONE plank of the bookcase. The skeleton cannot know how many books there are: a library
 * of a few dozen is one plank long, a bigger one simply grows downwards when it arrives – which is far less
 * jarring than a wall of planks that collapses to one. It fades in only after a short wait (`.exl-loading-fade`),
 * so a quick load never flashes it at all.
 * Server Component (the add block ghost is a tiny client island that reads the session from the layout);
 * widths/heights come from a fixed pseudo-random sequence so the skeleton is identical on every render.
 */
import { SPINE_SIZES } from '@/components/books/spine-layout';
import { AddPanelGhost } from '@/components/collection/AddPanelGhost';
import { Skeleton } from '@/components/ui';
import { ShelfGhost, type GhostRow } from '@/components/views/visual/ShelfGhost';
import { DENSITY_SIZE } from '@/components/views/visual/shelf-layout';
import { getServerT } from '@/i18n/server';

/** the shelf view's default size – what the real bookcase will have unless the reader chose "compact" */
const SIZE = DENSITY_SIZE.comfortable;
/** spines on the ghost plank: about a third of a desktop plank, between "a few books" and "a full shelf" */
const GHOST_SPINES = 12;

/** One plank of ghost spines (LCG, no Math.random: server and client markup never differ). */
function ghostPlank(): GhostRow {
  let state = 7;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const base = SPINE_SIZES[SIZE];
  return {
    key: 'ghost:0',
    startBookend: true,
    spines: Array.from({ length: GHOST_SPINES }, (_, i) => ({
      key: `spine-${i}`,
      width: Math.round(base.width * (0.74 + next() * 0.6)),
      height: Math.round(base.height * (0.78 + next() * 0.22)),
    })),
  };
}

export default async function CollectionLoading() {
  const { t } = await getServerT();
  return (
    <div
      className="exl-loading-fade mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{t('collection.loading.label')}</span>

      {/* bookplate header */}
      <div className="relative min-h-[13.5rem] overflow-hidden rounded-card border border-line bg-surface px-5 pt-7 pb-6 shadow-soft sm:px-10 sm:pt-9 sm:pb-8">
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

      <AddPanelGhost className="mt-4" />

      {/* toolbar: search / sort / filters, then the view tabs */}
      <div aria-hidden="true" className="-mx-4 mt-6 border-b border-line/70 px-4 pt-2 pb-2 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 min-w-0 flex-[1_1_16rem] md:max-w-sm" />
          <div className="ml-auto flex shrink-0 gap-2">
            <Skeleton className="h-10 w-[10.5rem] max-sm:w-[8.75rem]" />
            <Skeleton width={96} height={40} />
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2 overflow-hidden py-1">
          {[76, 88, 92, 80, 72, 84, 96].map((width, index) => (
            <Skeleton key={index} width={width} height={36} className="shrink-0" />
          ))}
        </div>
      </div>

      {/* the view panel: its options row and one plank */}
      <div aria-hidden="true" className="mt-5 min-h-[40vh]">
        <div className="mb-5 flex min-h-[2.125rem] flex-wrap items-center gap-x-5 gap-y-3">
          <Skeleton width={196} height={32} />
          <Skeleton width={188} height={32} />
          <Skeleton width={150} height={20} />
          <Skeleton className="ml-auto h-4 w-64 max-md:hidden" />
        </div>
        <div className="pt-2">
          <ShelfGhost rows={[ghostPlank()]} size={SIZE} />
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Framing help over the preview: coach card before the first clip (animated pan across a mini shelf),
 * rule-of-thirds grid, and the "another shelf?" hint after a clip. Keyframes live in <CameraKeyframes/>.
 */
import { ArrowRight, Plus } from 'lucide-react';
import { useI18n } from '@/i18n/client';

/** Scoped keyframes of the recorder (rendered once inside the overlay). */
const KEYFRAMES = `
@keyframes exl-cam-in { from { opacity: 0; transform: scale(1.025); } to { opacity: 1; transform: none; } }
@keyframes exl-cam-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes exl-cam-sweep {
  0% { transform: translateX(0); opacity: 0; }
  12% { opacity: 1; }
  78% { opacity: 1; }
  100% { transform: translateX(var(--exl-sweep, 170px)); opacity: 0; }
}
.exl-cam-in { animation: exl-cam-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.exl-cam-rise { animation: exl-cam-rise 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.exl-cam-sweep { animation: exl-cam-sweep 2.6s cubic-bezier(0.45, 0.05, 0.4, 1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .exl-cam-in, .exl-cam-rise { animation: none; }
  .exl-cam-sweep { animation: none; transform: translateX(56px); }
}
`;

export function CameraKeyframes() {
  return <style>{KEYFRAMES}</style>;
}

/** Book spines of the mini shelf: width, height (px) and cloth colour. */
const SPINES: ReadonlyArray<readonly [number, number, string]> = [
  [10, 44, '#7a2e3a'],
  [13, 52, '#1f4d3a'],
  [8, 40, '#c49645'],
  [11, 48, '#2f4a6b'],
  [15, 54, '#6f4527'],
  [9, 42, '#a8452f'],
  [12, 50, '#3c5e45'],
  [10, 38, '#d8c39a'],
  [14, 53, '#4a2f4f'],
  [9, 46, '#8b6a2f'],
  [12, 49, '#264b5a'],
  [10, 43, '#7d3b2c'],
  [13, 51, '#2d3f2b'],
  [8, 41, '#b98b3a'],
];

function ShelfSweep() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[4.75rem] w-[14rem] [--exl-sweep:10.25rem]">
      <div className="absolute inset-x-1 bottom-[6px] flex items-end justify-center gap-[3px]">
        {SPINES.map(([w, h, color], i) => (
          <span
            key={i}
            className="relative block rounded-t-[2px]"
            style={{
              width: w,
              height: h,
              background: color,
              boxShadow: 'inset -2px 0 0 rgb(0 0 0 / 0.22), inset 1px 0 0 rgb(255 255 255 / 0.08)',
            }}
          >
            <span className="absolute inset-x-0 top-[18%] h-[2px] bg-[#e9cf8f]/55" />
            <span className="absolute inset-x-0 bottom-[16%] h-[2px] bg-[#e9cf8f]/40" />
          </span>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[6px] rounded-[2px] bg-[linear-gradient(180deg,#a8764a,#5d3a20)] shadow-[0_3px_6px_rgb(0_0_0/0.4)]" />
      {/* viewfinder panning left → right */}
      <div className="exl-cam-sweep absolute top-0 bottom-[3px] left-0 w-[3.75rem]">
        <svg viewBox="0 0 60 73" className="absolute inset-0 size-full" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
          <path d="M2 16V6a4 4 0 0 1 4-4h10M44 2h10a4 4 0 0 1 4 4v10M58 57v10a4 4 0 0 1-4 4H44M16 71H6a4 4 0 0 1-4-4V57" />
        </svg>
        <span className="absolute inset-[5px] rounded-[6px] bg-white/10" />
        <ArrowRight className="absolute top-1/2 -right-6 size-5 -translate-y-1/2 text-[#f2d48a]" strokeWidth={2.75} />
      </div>
    </div>
  );
}

/** Coach card shown before the first clip; `compact` is a single row for short landscape screens. */
export function GuidanceCard({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  if (compact) {
    return (
      <div className="exl-cam-rise pointer-events-none mx-auto flex w-fit max-w-[36rem] items-center gap-5 rounded-[1.5rem] bg-black/55 py-3 pr-6 pl-5 text-left text-white shadow-[0_16px_48px_rgb(0_0_0/0.4)] ring-1 ring-white/10 backdrop-blur-xl">
        <div className="shrink-0">
          <ShelfSweep />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[1.0625rem] leading-tight font-semibold">{t('camera.guide.title')}</p>
          <p className="mt-1 text-[0.875rem] leading-snug text-pretty text-white/85">{t('camera.guide.body')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="exl-cam-rise pointer-events-none mx-auto w-full max-w-[21rem] rounded-[1.75rem] bg-black/55 px-5 pt-5 pb-4 text-center text-white shadow-[0_16px_48px_rgb(0_0_0/0.4)] ring-1 ring-white/10 backdrop-blur-xl">
      <ShelfSweep />
      <p className="mt-4 font-display text-[1.1875rem] leading-tight font-semibold text-balance">{t('camera.guide.title')}</p>
      <p className="mt-2 text-[0.9375rem] leading-snug text-pretty text-white/85">{t('camera.guide.body')}</p>
      <p className="mt-2.5 text-[0.8125rem] leading-snug text-pretty text-white/55">{t('camera.guide.tip')}</p>
    </div>
  );
}

/** Subtle rule-of-thirds grid over the preview. */
export function ThirdsGrid() {
  const line = 'absolute bg-white/25 shadow-[0_0_1px_rgb(0_0_0/0.35)]';
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className={`${line} inset-y-0 left-1/3 w-px`} />
      <span className={`${line} inset-y-0 left-2/3 w-px`} />
      <span className={`${line} inset-x-0 top-1/3 h-px`} />
      <span className={`${line} inset-x-0 top-2/3 h-px`} />
    </div>
  );
}

/** "Még egy polc?" hint after a clip was saved. */
export function AnotherShelfHint() {
  const { t } = useI18n();
  return (
    <div className="exl-cam-rise pointer-events-none mx-auto flex w-fit max-w-[21rem] items-center gap-3 rounded-2xl bg-black/55 py-2.5 pr-4 pl-2.5 text-left text-white shadow-[0_8px_28px_rgb(0_0_0/0.35)] ring-1 ring-white/10 backdrop-blur-xl">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f2d48a]/15 text-[#f2d48a]">
        <Plus className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] leading-tight font-semibold">{t('camera.hint.another.title')}</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-white/75">{t('camera.hint.another.body')}</span>
      </span>
    </div>
  );
}

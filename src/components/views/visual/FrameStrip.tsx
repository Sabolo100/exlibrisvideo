'use client';

/**
 * Key frames of one source as a horizontal thumbnail strip, with the source's name, length and
 * counts. The selected thumbnail is kept in view inside the strip (without scrolling the page).
 */
import { Camera, Film } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import type { FrameDTO } from '@/lib/types';
import { formatDuration, formatTimestamp, type FrameGroup } from './frames-layout';
import { scrollBehavior } from './hooks';

export interface FrameStripProps {
  group: FrameGroup;
  selectedId: string | null;
  detectionCounts: ReadonlyMap<string, number>;
  onSelect: (frame: FrameDTO) => void;
}

export const FrameStrip = memo(function FrameStrip({ group, selectedId, detectionCounts, onSelect }: FrameStripProps) {
  const { t, tp, locale } = useUiTranslator();
  const stripRef = useRef<HTMLUListElement>(null);
  const containsSelected = selectedId !== null && group.frames.some((f) => f.id === selectedId);
  const name = group.video?.originalFilename ?? t('visual.frames.unknownSource');
  const isPhoto = group.video?.kind === 'image';
  const decimal = locale === 'hu' ? ',' : '.';

  useEffect(() => {
    if (!containsSelected || !selectedId) return;
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-frame-id="${selectedId}"]`);
    if (!strip || !el) return;
    const target = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2;
    if (el.offsetLeft < strip.scrollLeft || el.offsetLeft + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, target), behavior: scrollBehavior() });
    }
  }, [containsSelected, selectedId]);

  const totalDetections = group.frames.reduce((s, f) => s + (detectionCounts.get(f.id) ?? 0), 0);

  return (
    <section aria-label={t('visual.frames.strip', { name })} className="min-w-0">
      <header className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', containsSelected ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted')}>
          {isPhoto ? <Camera aria-hidden="true" /> : <Film aria-hidden="true" />}
        </span>
        <h3 className="min-w-0 truncate text-sm font-semibold text-ink" title={name}>
          {name}
        </h3>
        <span className="text-xs text-muted tabular-nums">
          {[
            isPhoto ? t('visual.frames.photo') : formatDuration(group.video?.durationSec),
            tp('visual.frames.frames', group.frames.length),
            tp('visual.frames.detections', totalDetections),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </header>
      <ul ref={stripRef} className="relative flex gap-2 overflow-x-auto overscroll-x-contain pt-1 pb-2.5 [scrollbar-width:thin]">
        {group.frames.map((frame) => {
          const selected = frame.id === selectedId;
          const count = detectionCounts.get(frame.id) ?? 0;
          const time = formatTimestamp(frame.timeSec, decimal);
          return (
            <li key={frame.id} className="shrink-0">
              <button
                type="button"
                data-frame-id={frame.id}
                aria-current={selected || undefined}
                aria-label={t('visual.frames.thumb', { name, time, detections: tp('visual.frames.detections', count) })}
                onClick={() => onSelect(frame)}
                className={cn(
                  'group relative block h-24 cursor-pointer overflow-hidden rounded-lg bg-surface-2 transition-[box-shadow,transform,opacity] duration-150',
                  selected
                    ? 'shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)]'
                    : 'opacity-80 hover:-translate-y-0.5 hover:opacity-100 hover:shadow-soft',
                )}
                style={{ aspectRatio: frame.width > 0 && frame.height > 0 ? `${frame.width} / ${frame.height}` : '9 / 16' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frame.thumb ?? frame.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {count > 0 ? (
                  <span className="absolute top-1 right-1 min-w-4 rounded-full bg-[#e7b35c] px-1 text-center text-[0.625rem] leading-4 font-semibold text-[#2a1c08] tabular-nums shadow-[0_1px_2px_rgb(0_0_0/0.45)]">
                    {count}
                  </span>
                ) : null}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1 pt-3 pb-0.5 text-center text-[0.625rem] font-medium text-white tabular-nums">
                  {time}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

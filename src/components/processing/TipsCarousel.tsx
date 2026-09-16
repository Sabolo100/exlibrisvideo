'use client';

import { ChevronLeft, ChevronRight, Lightbulb, Pause, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/cn';

export const TIP_KEYS: readonly MessageKey[] = [
  'processing.tips.1',
  'processing.tips.2',
  'processing.tips.3',
  'processing.tips.4',
  'processing.tips.5',
  'processing.tips.6',
  'processing.tips.7',
  'processing.tips.8',
  'processing.tips.9',
  'processing.tips.10',
];

const ROTATE_MS = 9000;

/** Rotating tips and fun facts while the catalogue is being made (pausable, pauses on hover / focus). */
export function TipsCarousel({ className }: { className?: string }) {
  const { t, n } = useI18n();
  const headingId = useId();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const total = TIP_KEYS.length;

  // start at a random tip (after hydration, so server and client markup match)
  useEffect(() => {
    setIndex(Math.floor(Math.random() * total));
  }, [total]);

  useEffect(() => {
    if (!playing || hovered) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % total), ROTATE_MS);
    return () => clearInterval(timer);
  }, [playing, hovered, total]);

  const go = (delta: number) => setIndex((i) => (i + delta + total) % total);

  return (
    <Card
      variant="inset"
      as="section"
      aria-labelledby={headingId}
      aria-roledescription="carousel"
      className={cn('p-4', className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Lightbulb aria-hidden="true" className="size-4 text-accent" />
          {t('processing.tips.title')}
        </h2>
        <div className="flex items-center gap-0.5">
          <IconButton
            size="xs"
            aria-label={playing ? t('processing.tips.pause') : t('processing.tips.play')}
            icon={playing ? <Pause /> : <Play />}
            onClick={() => setPlaying((p) => !p)}
          />
          <IconButton size="xs" aria-label={t('processing.tips.prev')} icon={<ChevronLeft />} onClick={() => go(-1)} />
          <span className="min-w-[2.75rem] text-center text-xs text-muted tabular-nums" aria-hidden="true">
            {t('processing.tips.counter', { index: n(index + 1), total: n(total) })}
          </span>
          <IconButton size="xs" aria-label={t('processing.tips.next')} icon={<ChevronRight />} onClick={() => go(1)} />
        </div>
      </div>
      <div className="relative mt-2 min-h-[4.5rem]" aria-live={playing && !hovered ? 'off' : 'polite'}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-sm leading-relaxed text-ink text-pretty"
          >
            {t(TIP_KEYS[index])}
          </motion.p>
        </AnimatePresence>
      </div>
    </Card>
  );
}

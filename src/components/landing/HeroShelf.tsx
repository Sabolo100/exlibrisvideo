'use client';

import { CircleCheck } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { Shelf } from '@/components/books/Shelf';
import { spineLabel } from '@/components/books/BookSpine';
import type { SpineSize } from '@/components/books/spine-layout';
import { cn } from '@/components/ui/cn';
import type { BookDTO } from '@/lib/types';
import { HERO_BOOKS } from './hero-books';

const ROWS: BookDTO[][] = [HERO_BOOKS.slice(0, 9), HERO_BOOKS.slice(9)];
/** the order in which the "recognised" chip names the books (follows the sweeping phone) */
const CHIP_ORDER = [9, 1, 11, 5, 14, 3, 16, 7, 12, 0, 10, 4, 13, 8, 15, 2, 17, 6];
const CHIP_MS = 2800;

const SCAN_CSS = `
@keyframes exl-hero-scan {
  0%, 6% { left: 1%; }
  44%, 56% { left: 71%; }
  94%, 100% { left: 1%; }
}
.exl-hero-scan { animation: exl-hero-scan 10s ease-in-out infinite; }
@keyframes exl-hero-rec { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.exl-hero-rec { animation: exl-hero-rec 1.4s ease-in-out infinite; }
`;

function Bookcase({ size }: { size: SpineSize }) {
  return (
    <div className="flex flex-col gap-2.5">
      {ROWS.map((row, r) => (
        <Shelf
          key={r}
          size={size}
          books={row}
          bookends={r === 0}
          renderBook={(book, spine, i) => (
            <motion.span
              className="block"
              initial={{ opacity: 0, y: -40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 20, delay: 0.2 + (r * 9 + i) * 0.055 }}
            >
              {spine}
            </motion.span>
          )}
        />
      ))}
    </div>
  );
}

/**
 * Hero illustration: two shelves of Hungarian classics slide in, a phone viewfinder sweeps across them
 * and a chip names the books it "recognises". Decorative – exposed to assistive tech as one image.
 */
export function HeroShelf({ className }: { className?: string }) {
  const { t, tp } = useI18n();
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setTick((i) => (i + 1) % CHIP_ORDER.length), CHIP_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  const current = HERO_BOOKS[CHIP_ORDER[tick]];

  return (
    <figure role="img" aria-label={t('landing.hero.illustration')} className={cn('relative mx-auto w-full max-w-[34rem]', className)}>
      <style>{SCAN_CSS}</style>
      <div aria-hidden="true" className="relative">
        <div className="sm:hidden">
          <Bookcase size="sm" />
        </div>
        <div className="max-sm:hidden">
          <Bookcase size="md" />
        </div>

        {/* the phone sweeping along the shelves */}
        <div className="exl-hero-scan pointer-events-none absolute -top-3 -bottom-3 left-[1%] w-[28%]">
          <div className="relative h-full w-full rounded-[1.1rem] border-[3px] border-[#fdf8ee]/90 bg-[linear-gradient(180deg,rgb(255_255_255/0.08),rgb(255_255_255/0.02))] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.55),inset_0_0_0_1px_rgb(0_0_0/0.25)]">
            <span className="absolute top-2 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-[#fdf8ee]/70" />
            <span className="absolute top-2.5 right-3 flex items-center gap-1 text-[0.5625rem] font-semibold tracking-wider text-[#fdf8ee]">
              <span className="exl-hero-rec size-1.5 rounded-full bg-[#e5484d]" />
              REC
            </span>
            {/* focus corners */}
            <span className="absolute top-7 left-2.5 size-3 border-t-2 border-l-2 border-[#f3d58c]" />
            <span className="absolute top-7 right-2.5 size-3 border-t-2 border-r-2 border-[#f3d58c]" />
            <span className="absolute bottom-5 left-2.5 size-3 border-b-2 border-l-2 border-[#f3d58c]" />
            <span className="absolute right-2.5 bottom-5 size-3 border-r-2 border-b-2 border-[#f3d58c]" />
          </div>
        </div>

        <span className="absolute -top-3 right-3 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink shadow-soft tabular-nums">
          {tp('landing.hero.found', HERO_BOOKS.length)}
        </span>

        <div className="absolute -bottom-4 left-3 max-w-[calc(100%-1.5rem)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="flex max-w-full items-center gap-2 rounded-full border border-line bg-surface py-1.5 pr-3.5 pl-2 text-[0.8125rem] shadow-lift"
            >
              <CircleCheck className="size-4 shrink-0 text-success" />
              <span className="shrink-0 font-medium text-muted">{t('landing.hero.recognised')}</span>
              <span className="min-w-0 truncate font-semibold text-ink">{spineLabel(current)}</span>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </figure>
  );
}

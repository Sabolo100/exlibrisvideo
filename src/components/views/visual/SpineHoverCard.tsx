'use client';

/**
 * One floating label for a whole view: shows the title, author and year of the spine under the
 * pointer (or keyboard-focused). Event delegation on the container (`[data-book-id]` elements),
 * so thousands of spines cost no extra listeners or portals.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type RefObject } from 'react';
import { useUiTranslator } from '@/components/ui/hooks';
import { topicDef } from '@/lib/taxonomy';
import type { BookDTO } from '@/lib/types';
import { yearLabel } from './timeline-layout';

interface CardState {
  id: string;
  /** centre x of the spine, relative to the container */
  x: number;
  top: number;
  bottom: number;
  width: number;
  /** not enough room above the spine in the viewport (sticky page header, top of the window) */
  below: boolean;
}

const HALF_CARD = 124;
const LIFT = 14;
/** viewport space the card needs above a spine: its height plus a sticky page header */
const ROOM_ABOVE = 170;

export function SpineHoverCard({
  containerRef,
  booksById,
}: {
  /** positioned (relative) element that contains the spines */
  containerRef: RefObject<HTMLElement | null>;
  booksById: ReadonlyMap<string, BookDTO>;
}) {
  const { t } = useUiTranslator();
  const [card, setCard] = useState<CardState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let current: Element | null = null;

    const show = (el: Element) => {
      const id = (el as HTMLElement).dataset.bookId;
      if (!id) return;
      const c = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      current = el;
      setCard({
        id,
        x: r.left + r.width / 2 - c.left,
        top: r.top - c.top,
        bottom: r.bottom - c.top,
        width: c.width,
        below: r.top < ROOM_ABOVE,
      });
    };
    const hide = () => {
      current = null;
      setCard(null);
    };
    const spineOf = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest('[data-book-id]');
      return el && container.contains(el) ? el : null;
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = spineOf(e.target);
      if (el && el !== current) show(el);
    };
    const onOut = (e: PointerEvent) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      if (spineOf(to) === current) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = spineOf(e.target);
      if (el && (e.target as Element).matches?.(':focus-visible')) show(el);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (spineOf(e.relatedTarget)) return;
      hide();
    };
    const onPointerDown = () => hide();

    container.addEventListener('pointerover', onOver);
    container.addEventListener('pointerout', onOut);
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    container.addEventListener('pointerdown', onPointerDown);
    // nested horizontal scrollers (timeline) move spines away from the card
    container.addEventListener('scroll', hide, true);
    return () => {
      container.removeEventListener('pointerover', onOver);
      container.removeEventListener('pointerout', onOut);
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('scroll', hide, true);
    };
  }, [containerRef]);

  const book = card ? booksById.get(card.id) : undefined;
  const below = card?.below ?? false;
  const left = card ? Math.min(Math.max(card.x, Math.min(HALF_CARD, card.width / 2)), Math.max(card.width - HALF_CARD, card.width / 2)) : 0;
  const topic = book ? topicDef(book.category ?? book.topics[0]) : undefined;

  return (
    <AnimatePresence>
      {card && book ? (
        <motion.div
          key={card.id}
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          className="pointer-events-none absolute z-30 w-max max-w-[15.5rem] rounded-lg bg-ink px-3 py-2 text-bg shadow-lift"
          style={{
            left,
            top: below ? card.bottom + 10 : card.top - LIFT,
            x: '-50%',
            y: below ? '0%' : '-100%',
            transformOrigin: below ? '50% 0%' : '50% 100%',
          }}
        >
          <span className="block font-display text-[0.9375rem] leading-snug font-semibold text-pretty">{book.title}</span>
          {book.author ? <span className="mt-0.5 block text-xs leading-snug opacity-80">{book.author}</span> : null}
          {book.firstPublishedYear !== null || topic ? (
            <span className="mt-1 flex items-center gap-2 text-[0.6875rem] opacity-70">
              {book.firstPublishedYear !== null ? (
                <span>{t('visual.hover.published', { year: yearLabel(book.firstPublishedYear, t) })}</span>
              ) : null}
              {topic ? <span>{topic.icon}</span> : null}
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

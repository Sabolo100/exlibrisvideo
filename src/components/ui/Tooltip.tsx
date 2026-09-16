'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import type { Align, Side } from './floating';
import { useFloating } from './hooks';
import { Portal } from './Portal';

export interface TooltipProps {
  /** tooltip text (keep it short; no interactive content) */
  content: ReactNode;
  /** a single focusable element */
  children: ReactElement;
  side?: Side;
  align?: Align;
  /** ms before showing on hover (focus shows immediately) */
  delay?: number;
  /** adds aria-describedby to the child (default true). Set false when the text equals its aria-label. */
  describeChild?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Small label on hover (mouse/pen) and keyboard focus. Esc hides it. Touch does not trigger it,
 * so never put essential information only in a tooltip.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delay = 350,
  describeChild = true,
  disabled = false,
  className,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pos = useFloating({ open, anchorRef, floatingRef, side, align, offset: 8 });

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(
    (immediate: boolean) => {
      if (disabled || content === null || content === undefined || content === '') return;
      clear();
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [content, delay, disabled],
  );
  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => clear, []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const child = isValidElement<Record<string, unknown>>(children)
    ? describeChild
      ? cloneElement(children, {
          'aria-describedby': cn(children.props['aria-describedby'] as string | undefined, open ? id : undefined) || undefined,
        })
      : children
    : children;

  const offsetFor = (s: Side) => (s === 'top' ? { y: 4 } : s === 'bottom' ? { y: -4 } : s === 'left' ? { x: 4 } : { x: -4 });

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex max-w-full"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'touch') show(false);
        }}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocus={(e) => {
          // only keyboard-visible focus opens it
          if ((e.target as HTMLElement).matches?.(':focus-visible')) show(true);
        }}
        onBlur={hide}
      >
        {child}
      </span>
      <Portal>
        <AnimatePresence>
          {open && (
            <motion.div
              ref={floatingRef}
              id={id}
              role="tooltip"
              initial={{ opacity: 0, scale: 0.96, ...offsetFor(pos.side) }}
              animate={{ opacity: pos.ready ? 1 : 0, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              style={{ position: 'fixed', top: pos.y, left: pos.x }}
              className={cn(
                'pointer-events-none z-[70] max-w-[min(18rem,calc(100vw-1rem))] rounded-md px-2.5 py-1.5',
                'bg-ink text-[0.8125rem] leading-snug font-medium text-bg shadow-lift',
                className,
              )}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>
      </Portal>
    </>
  );
}

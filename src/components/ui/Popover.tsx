'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import type { Align, Side } from './floating';
import {
  getTabbables,
  isTopLayer,
  useControllableState,
  useEscape,
  useFloating,
  useLayer,
  useOutsidePointerDown,
} from './hooks';
import { Portal } from './Portal';

export interface PopoverProps {
  /** the element that toggles the popover (a Button / IconButton) */
  trigger: ReactElement;
  /** content, or a render function receiving `close` */
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  align?: Align;
  offset?: number;
  /** accessible name of the popover panel */
  'aria-label'?: string;
  /** match the trigger width at least */
  matchTriggerWidth?: boolean;
  /** move focus into the panel on open (default true) */
  autoFocus?: boolean;
  className?: string;
}

/**
 * Non-modal floating panel anchored to a trigger. Click toggles, Esc / outside click / focus
 * leaving closes, focus returns to the trigger.
 */
export function Popover({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  offset = 8,
  'aria-label': ariaLabel,
  matchTriggerWidth = false,
  autoFocus = true,
  className,
}: PopoverProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const layer = useLayer(open);
  const pos = useFloating({ open, anchorRef, floatingRef: panelRef, side, align, offset });

  const focusTrigger = () => {
    const el = anchorRef.current?.querySelector<HTMLElement>('button, a, [tabindex]') ?? anchorRef.current;
    el?.focus({ preventScroll: true });
  };
  const close = useCallback(
    (restore = true) => {
      setOpen(false);
      if (restore) requestAnimationFrame(focusTrigger);
    },
    [setOpen],
  );

  useEscape(open, layer, () => close(true));
  useOutsidePointerDown(open, [anchorRef, panelRef], () => {
    // a nested layer (menu inside the popover) handles its own outside clicks first
    if (isTopLayer(layer)) close(false);
  });

  useEffect(() => {
    if (!open || !autoFocus) return;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>('[data-autofocus]') ?? getTabbables(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, autoFocus]);

  const triggerEl = isValidElement<Record<string, unknown>>(trigger)
    ? cloneElement(trigger, {
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
        onClick: (e: MouseEvent) => {
          (trigger.props.onClick as ((ev: MouseEvent) => void) | undefined)?.(e);
          if (!e.defaultPrevented) setOpen(!open);
        },
      })
    : trigger;

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        {triggerEl}
      </span>
      <Portal>
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              id={id}
              role="dialog"
              data-exl-floating=""
              aria-label={ariaLabel}
              tabIndex={-1}
              initial={{ opacity: 0, y: pos.side === 'top' ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: pos.ready ? 1 : 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              style={{
                position: 'fixed',
                top: pos.y,
                left: pos.x,
                minWidth: matchTriggerWidth ? pos.anchorWidth : undefined,
                maxHeight: pos.available > 0 ? pos.available : undefined,
              }}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (!next || panelRef.current?.contains(next) || anchorRef.current?.contains(next)) return;
                if ((next as Element).closest?.('[data-exl-floating]')) return;
                close(false);
              }}
              className={cn(
                'z-[65] max-w-[calc(100vw-1rem)] overflow-auto rounded-xl border border-line bg-surface p-3 text-ink shadow-lift outline-none',
                className,
              )}
            >
              {typeof children === 'function' ? children(() => close(true)) : children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Portal>
    </>
  );
}

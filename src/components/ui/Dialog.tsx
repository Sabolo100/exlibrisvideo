'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from './cn';
import { useEscape, useFocusTrap, useLayer, useScrollLock, useUiTranslator } from './hooks';
import { IconButton } from './IconButton';
import { Portal } from './Portal';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export interface DialogProps {
  open: boolean;
  /** called on Esc, overlay click and the close button */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** action row (right-aligned buttons) */
  footer?: ReactNode;
  size?: DialogSize;
  /** keep the title for screen readers only */
  hideTitle?: boolean;
  /** icon in a soft medallion next to the title */
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  /** element to focus on open (default: [data-autofocus] or the first focusable) */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

/**
 * Modal dialog: portal, focus trap, Esc / overlay click to close, scroll lock, focus restore.
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Beállítások" footer={<Button …/>}>…</Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideTitle = false,
  icon,
  tone = 'default',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  initialFocusRef,
  className,
  bodyClassName,
}: DialogProps) {
  const { t } = useUiTranslator();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const layer = useLayer(open);
  useEscape(open && closeOnEsc, layer, onClose);
  useFocusTrap(panelRef, open, layer, { initialFocus: initialFocusRef });
  useScrollLock(open);

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[60]" key="dialog">
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-[rgb(20_14_8/0.45)] backdrop-blur-[2px] dark:bg-[rgb(0_0_0/0.6)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={closeOnOverlayClick ? onClose : undefined}
            />
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descId : undefined}
                tabIndex={-1}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.14 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className={cn(
                  'pointer-events-auto relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-ink shadow-lift outline-none sm:max-h-[calc(100dvh-3rem)]',
                  WIDTH[size],
                  className,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 h-1',
                    tone === 'danger' ? 'bg-danger' : 'bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] opacity-60',
                  )}
                />
                <div className={cn('flex items-start gap-3 px-5 pt-5 sm:px-6', hideTitle ? 'pb-0' : 'pb-3')}>
                  {icon ? (
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5',
                        tone === 'danger'
                          ? 'bg-[color-mix(in_oklab,var(--danger)_12%,var(--surface))] text-danger'
                          : 'bg-accent-soft text-accent',
                      )}
                    >
                      {icon}
                    </div>
                  ) : null}
                  <div className={cn('min-w-0 flex-1', hideTitle && 'sr-only')}>
                    <h2 id={titleId} className="font-display text-xl leading-tight font-semibold text-balance">
                      {title}
                    </h2>
                    {description ? (
                      <p id={descId} className="mt-1.5 text-sm text-muted">
                        {description}
                      </p>
                    ) : null}
                  </div>
                  {showCloseButton ? (
                    <IconButton
                      aria-label={t('common.action.close')}
                      icon={<X />}
                      size="sm"
                      onClick={onClose}
                      className={cn('-mt-1 -mr-2', hideTitle && 'ml-auto')}
                    />
                  ) : null}
                </div>
                {children !== undefined && children !== null ? (
                  <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6', bodyClassName)}>
                    {children}
                  </div>
                ) : null}
                {footer ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-2/40 px-5 py-3 sm:px-6">
                    {footer}
                  </div>
                ) : null}
              </motion.div>
            </div>
          </div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}

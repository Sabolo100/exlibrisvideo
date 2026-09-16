'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from './cn';
import { useEscape, useFocusTrap, useLayer, useMediaQuery, useScrollLock, useUiTranslator } from './hooks';
import { IconButton } from './IconButton';
import { Portal } from './Portal';

export type DrawerSize = 'sm' | 'md' | 'lg';

const WIDTH: Record<DrawerSize, string> = {
  sm: 'md:w-[22rem]',
  md: 'md:w-[30rem]',
  lg: 'md:w-[min(40rem,100vw)]',
};

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** sticky action row at the bottom */
  footer?: ReactNode;
  /** extra buttons in the header before the close button (e.g. prev / next) */
  headerActions?: ReactNode;
  /** desktop panel width */
  size?: DrawerSize;
  hideTitle?: boolean;
  closeOnOverlayClick?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

/**
 * Side panel from the right on ≥ md screens, bottom sheet with a drag handle on mobile
 * (drag down to dismiss). Same a11y as Dialog: focus trap, Esc, overlay click, scroll lock.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  headerActions,
  size = 'md',
  hideTitle = false,
  closeOnOverlayClick = true,
  initialFocusRef,
  className,
  bodyClassName,
}: DrawerProps) {
  const { t } = useUiTranslator();
  const desktop = useMediaQuery('(min-width: 768px)');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const dragControls = useDragControls();
  const layer = useLayer(open);
  useEscape(open, layer, onClose);
  useFocusTrap(panelRef, open, layer, { initialFocus: initialFocusRef });
  useScrollLock(open);

  const onDragEnd = (_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose();
  };

  const motionProps = desktop
    ? {
        initial: { x: '100%' },
        animate: { x: 0 },
        exit: { x: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as const } },
        transition: { type: 'spring' as const, stiffness: 380, damping: 38 },
      }
    : {
        initial: { y: '100%' },
        animate: { y: 0 },
        exit: { y: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as const } },
        transition: { type: 'spring' as const, stiffness: 380, damping: 36 },
        drag: 'y' as const,
        dragListener: false,
        dragControls,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.7 },
        onDragEnd,
      };

  return (
    <Portal>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[60]" key="drawer">
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-[rgb(20_14_8/0.4)] dark:bg-[rgb(0_0_0/0.55)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeOnOverlayClick ? onClose : undefined}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
              tabIndex={-1}
              {...motionProps}
              className={cn(
                'absolute flex flex-col overflow-hidden border-line bg-surface text-ink shadow-lift outline-none',
                'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[1.25rem] border-t pb-[env(safe-area-inset-bottom)]',
                'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:rounded-none md:border-t-0 md:border-l md:pb-0',
                WIDTH[size],
                className,
              )}
            >
              {!desktop ? (
                <div
                  className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing"
                  onPointerDown={(e) => dragControls.start(e)}
                  aria-hidden="true"
                  title={t('common.aria.dragToClose')}
                >
                  <span className="h-1.5 w-11 rounded-full bg-[color-mix(in_oklab,var(--line),var(--ink)_22%)]" />
                </div>
              ) : null}
              <div
                className={cn('flex items-start gap-2 border-b border-line/70 px-5 pb-3 md:pt-4', desktop ? 'pt-4' : 'pt-1')}
                onPointerDown={desktop ? undefined : (e) => {
                  if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                  dragControls.start(e);
                }}
              >
                <div className={cn('min-w-0 flex-1 py-1', hideTitle && 'sr-only')}>
                  <h2 id={titleId} className="font-display text-lg leading-tight font-semibold text-balance">
                    {title}
                  </h2>
                  {description ? (
                    <p id={descId} className="mt-1 text-sm text-muted">
                      {description}
                    </p>
                  ) : null}
                </div>
                <div className={cn('flex shrink-0 items-center gap-1', hideTitle && 'ml-auto')}>
                  {headerActions}
                  <IconButton aria-label={t('common.action.close')} icon={<X />} size="sm" onClick={onClose} />
                </div>
              </div>
              <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', bodyClassName)}>{children}</div>
              {footer ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-2/40 px-5 py-3">
                  {footer}
                </div>
              ) : null}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </Portal>
  );
}

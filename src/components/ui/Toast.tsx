'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';
import { Portal } from './Portal';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 keeps it until closed. Default 5000 (errors 8000). */
  duration?: number;
  /** one action button, e.g. "Visszavonás" */
  action?: { label: string; onClick: () => void };
  /** replaces an existing toast with the same id instead of stacking */
  id?: string;
}

interface ToastItem extends Required<Pick<ToastOptions, 'tone' | 'duration'>> {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastOptions['action'];
}

export interface ToastApi {
  /** shows a toast, returns its id */
  toast: (options: ToastOptions) => string;
  success: (title: ReactNode, description?: ReactNode) => string;
  error: (title: ReactNode, description?: ReactNode) => string;
  info: (title: ReactNode, description?: ReactNode) => string;
  dismiss: (id?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 4;
let counter = 0;

/** Mount once near the root (done by site/Providers). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id?: string) => {
    setToasts((list) => (id ? list.filter((t) => t.id !== id) : []));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? 'info';
    counter += 1;
    const id = options.id ?? `toast-${counter}`;
    const item: ToastItem = {
      id,
      title: options.title,
      description: options.description,
      tone,
      duration: options.duration ?? (tone === 'error' ? 8000 : 5000),
      action: options.action,
    };
    setToasts((list) => {
      const without = list.filter((t) => t.id !== id);
      return [...without, item].slice(-MAX_VISIBLE);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
      info: (title, description) => toast({ title, description, tone: 'info' }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const noop: ToastApi = {
  toast: () => {
    if (process.env.NODE_ENV !== 'production') console.warn('[ui] useToast() used outside <ToastProvider>');
    return '';
  },
  success: () => '',
  error: () => '',
  info: () => '',
  dismiss: () => {},
};

/**
 *   const { toast } = useToast();
 *   toast({ title: 'Mentve', tone: 'success' });
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noop;
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const { t } = useUiTranslator();
  return (
    <Portal>
      <section
        aria-label={t('common.aria.notifications')}
        data-exl-toast-region=""
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-0 sm:items-end sm:p-5"
      >
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
          ))}
        </AnimatePresence>
      </section>
    </Portal>
  );
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
};

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-primary',
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const { t } = useUiTranslator();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    remaining.current = item.duration;
  }, [item.duration, item.title, item.description]);

  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [item.id, item.duration, paused, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border border-line bg-surface py-3 pr-2 pl-4 text-ink shadow-lift',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1',
          item.tone === 'success' && 'bg-success',
          item.tone === 'error' && 'bg-danger',
          item.tone === 'info' && 'bg-accent',
        )}
      />
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-5', TONE_CLASS[item.tone])}>{TONE_ICON[item.tone]}</span>
      <div className="min-w-0 flex-1 py-px">
        <div className="text-sm leading-snug font-semibold">{item.title}</div>
        {item.description ? <div className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{item.description}</div> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss(item.id);
            }}
            className="mt-2 rounded-md text-[0.8125rem] font-semibold text-primary underline decoration-accent/60 underline-offset-4 hover:decoration-accent"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('common.aria.dismiss')}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink [&_svg]:size-4"
      >
        <X aria-hidden="true" />
      </button>
    </motion.div>
  );
}

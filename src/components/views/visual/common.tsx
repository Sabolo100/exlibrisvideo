'use client';

/**
 * Small building blocks shared by the visual views: the options bar, keyboard hints and the empty
 * states (nothing matches the filters / no books at all).
 */
import type { ReactNode } from 'react';
import { useCollection } from '@/components/collection/context';
import { Button, EmptyState, Kbd } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';

/** The row of view options above a visual view. */
export function ViewOptionsBar({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  const { t } = useUiTranslator();
  return (
    <div
      role="group"
      aria-label={t('visual.options')}
      className={cn('mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 print:hidden', className)}
    >
      {children}
      {aside ? <div className="ml-auto flex items-center gap-3 max-md:hidden">{aside}</div> : null}
    </div>
  );
}

/** "Keyboard: ← → ↑ ↓ move · Enter open" (hidden on touch-first small screens). */
export function KeyboardHint({ keys, action, secondKeys, secondAction }: { keys: string[]; action: string; secondKeys?: string[]; secondAction?: string }) {
  const { t } = useUiTranslator();
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted" aria-hidden="true">
      <span>{t('visual.keys.hint')}</span>
      {keys.map((k) => (
        <Kbd key={k} size="sm">
          {k}
        </Kbd>
      ))}
      <span>{action}</span>
      {secondKeys && secondAction ? (
        <>
          <span className="px-0.5 text-line">·</span>
          {secondKeys.map((k) => (
            <Kbd key={k} size="sm">
              {k}
            </Kbd>
          ))}
          <span>{secondAction}</span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Empty state of a visual view: "no match" with a reset button when filters hide every book,
 * otherwise "the shelf is still empty".
 */
export function VisualEmptyState({ className }: { className?: string }) {
  const { books, resetFilters, activeFilterCount, isOwner } = useCollection();
  const { t } = useUiTranslator();
  if (books.length > 0) {
    return (
      <EmptyState
        className={className}
        title={t('visual.empty.filtered.title')}
        description={t('visual.empty.filtered.description')}
        action={
          activeFilterCount > 0 ? (
            <Button variant="primary" onClick={resetFilters}>
              {t('visual.empty.filtered.reset')}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <EmptyState
      className={className}
      title={t('visual.empty.noBooks.title')}
      description={isOwner ? t('visual.empty.noBooks.owner') : t('visual.empty.noBooks.description')}
    />
  );
}

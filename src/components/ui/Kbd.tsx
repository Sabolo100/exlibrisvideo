import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export type KbdProps = ComponentPropsWithRef<'kbd'> & { size?: 'sm' | 'md' };

/** Keyboard key hint, e.g. <Kbd>Enter</Kbd> or <Kbd>←</Kbd>. */
export function Kbd({ className, size = 'md', ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.6em] items-center justify-center rounded-md border border-line bg-surface font-sans font-medium text-muted',
        'shadow-[inset_0_-2px_0_var(--line)]',
        size === 'sm' ? 'h-5 px-1 text-[0.6875rem]' : 'h-6 px-1.5 text-xs',
        className,
      )}
      {...rest}
    />
  );
}

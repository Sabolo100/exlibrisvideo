import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';
import { cn } from './cn';

export type VisuallyHiddenProps = {
  children: ReactNode;
  /** element to render (default span) */
  as?: ElementType;
  /** becomes visible when focused (skip links) */
  focusable?: boolean;
} & Omit<ComponentPropsWithRef<'span'>, 'children'>;

/** Content for screen readers only. */
export function VisuallyHidden({ children, as: Tag = 'span', focusable = false, className, ...rest }: VisuallyHiddenProps) {
  return (
    <Tag className={cn('sr-only', focusable && 'focus:not-sr-only', className)} {...rest}>
      {children}
    </Tag>
  );
}

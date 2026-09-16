'use client';

/**
 * One full-screen app screen: top bar · scrollable content · bottom bar. The document never scrolls
 * (html.app-mode); only the content area does, with contained overscroll – like a native app.
 */
import type { ReactNode, Ref } from 'react';
import { cn } from '@/components/ui';

export const APP_MAIN_ID = 'app-main';

export interface AppScreenProps {
  top?: ReactNode;
  bottom?: ReactNode;
  children: ReactNode;
  /** content area classes (padding etc.) */
  mainClassName?: string;
  mainRef?: Ref<HTMLElement>;
  /** content that must not scroll (e.g. a camera-like full-bleed view) */
  fixedContent?: boolean;
  className?: string;
}

export function AppScreen({ top, bottom, children, mainClassName, mainRef, fixedContent, className }: AppScreenProps) {
  return (
    <div className={cn('flex h-dvh w-full flex-col overflow-hidden bg-bg', className)}>
      {top}
      <main
        id={APP_MAIN_ID}
        ref={mainRef}
        className={cn(
          'relative min-h-0 flex-1',
          fixedContent ? 'overflow-hidden' : 'app-scroll overflow-x-hidden overflow-y-auto',
          mainClassName,
        )}
      >
        {children}
      </main>
      {bottom}
    </div>
  );
}

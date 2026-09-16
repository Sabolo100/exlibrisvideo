'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { useTheme } from '@/components/ui/theme';
import { ToastProvider } from '@/components/ui/Toast';

/** Keeps data-theme in sync with the stored preference and the OS setting (system mode). */
function ThemeSync() {
  useTheme();
  return null;
}

/**
 * Global client providers, mounted once in app/layout.tsx inside <I18nProvider>:
 * toasts, theme synchronisation and motion defaults (respects prefers-reduced-motion).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ThemeSync />
        {children}
      </ToastProvider>
    </MotionConfig>
  );
}

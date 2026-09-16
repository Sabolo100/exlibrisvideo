'use client';

/** A long read (privacy, terms) as an app screen: back button + title bar, the document scrolls inside. */
import type { ReactNode } from 'react';
import { AppScreen } from './AppScreen';
import { AppBackButton, AppTopBar } from './AppTopBar';

export function AppDocumentScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AppScreen top={<AppTopBar leading={<AppBackButton fallbackHref="/" />} title={title} />} mainClassName="pb-8">
      {children}
    </AppScreen>
  );
}

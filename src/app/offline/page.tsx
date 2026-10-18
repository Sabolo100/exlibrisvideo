import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { getServerT } from '@/i18n/server';

/**
 * `/offline` – what the installed app shows when a page cannot be loaded (no connection): the service worker
 * (app/sw.js) keeps a copy of this page and serves it instead of the browser's error screen.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OfflinePage() {
  const { t } = await getServerT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center pt-safe pb-safe">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <WifiOff aria-hidden="true" className="size-8" />
      </span>
      <h1 className="mt-5 font-display text-2xl font-semibold text-ink">{t('app.offline.title')}</h1>
      <p className="mt-2 max-w-xs text-[0.9375rem] leading-relaxed text-muted text-pretty">{t('app.offline.text')}</p>
      {/* a plain link: a full page load is the retry (the service worker tries the network first) */}
      <a href="/" className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-[0.9375rem] font-semibold text-primary-ink">
        {t('app.offline.retry')}
      </a>
    </div>
  );
}

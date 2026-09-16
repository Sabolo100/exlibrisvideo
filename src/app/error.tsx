'use client';

/** Route error boundary (owner: frontend-landing): friendly message, retry (re-fetches server data too), home link. */
import { Home, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';
import { useI18n } from '@/i18n/client';
import { EmptyShelfIllustration } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    console.error('[app] page error', { message: error.message, digest: error.digest });
  }, [error]);

  const retry = () => {
    // a Server Component error needs fresh server data; reset() alone would re-render the stale payload
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <div role="alert" className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
      <EmptyShelfIllustration className="h-24 w-auto" />
      <p className="mt-6 text-xs font-semibold tracking-[0.16em] text-accent uppercase">{t('landing.error.eyebrow')}</p>
      <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-4xl">{t('landing.error.title')}</h1>
      <p className="mt-3 text-base leading-relaxed text-muted text-pretty">{t('landing.error.text')}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="primary" leftIcon={<RotateCcw />} onClick={retry}>
          {t('landing.error.retry')}
        </Button>
        <Button href="/" leftIcon={<Home />}>
          {t('landing.error.home')}
        </Button>
      </div>
      {error.digest ? (
        <p className="mt-6 font-mono text-xs text-muted select-all">{t('landing.error.code', { code: error.digest })}</p>
      ) : null}
    </div>
  );
}

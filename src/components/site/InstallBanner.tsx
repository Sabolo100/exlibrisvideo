'use client';

/**
 * "Put Ex Libris on your home screen" card for phones. The browser's own install mini-infobar is suppressed
 * (install-prompt.ts keeps the `beforeinstallprompt` event for our buttons), so without this card nobody was
 * ever asked. Chrome / Edge / Samsung on Android: one tap opens the browser's install dialog. iPhone / iPad:
 * Safari has no install dialog at all – the card shows the two steps (Share → Add to Home Screen).
 * Hidden when the app already runs installed; "Not now" hides it for two weeks (this browser only).
 */
import { Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { promptInstall, useInstallState } from '@/lib/client/install-prompt';

const DISMISS_KEY = 'exl.install.dismissedAt';
const DISMISS_MS = 14 * 24 * 3600 * 1000;
/** the card comes a moment after the page, not over its first paint */
const SHOW_DELAY_MS = 2500;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function isPhoneOrTablet(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 900;
}

export function InstallBanner() {
  const { t } = useI18n();
  const { canPrompt, standalone, ios } = useInstallState();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHidden(dismissedRecently() || !isPhoneOrTablet());
      setReady(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready || hidden || standalone || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: hidden for this page view only */
    }
    setHidden(true);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="exl-install-title"
      className="app-chrome fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[70] mx-auto max-w-md animate-[app-screen-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-2xl border border-line bg-surface p-3 text-ink shadow-[0_18px_40px_-12px_hsl(var(--shadow-color)/0.55)]"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl shadow-sm" />
        <div className="min-w-0 flex-1">
          <p id="exl-install-title" className="font-display text-[1.0625rem] leading-tight font-semibold">
            {t('app.settings.install.title')}
          </p>
          {canPrompt ? (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{t('app.install.text')}</p>
          ) : (
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
              {t('app.install.iosStep1')}{' '}
              <Share aria-label={t('app.install.shareIcon')} className="inline size-4 -translate-y-px text-primary" />{' '}
              {t('app.install.iosStep2')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('app.install.later')}
          className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-surface-2 [&_svg]:size-4"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {canPrompt ? (
        <div className="mt-2.5 flex justify-end gap-2">
          <button type="button" onClick={dismiss} className="h-9 rounded-full px-3.5 text-sm font-medium text-muted active:bg-surface-2">
            {t('app.install.later')}
          </button>
          <button
            type="button"
            onClick={() => void promptInstall().then((accepted) => (accepted ? setHidden(true) : undefined))}
            className="h-9 rounded-full bg-primary px-4 text-sm font-semibold text-primary-ink active:scale-95"
          >
            {t('app.settings.install.button')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

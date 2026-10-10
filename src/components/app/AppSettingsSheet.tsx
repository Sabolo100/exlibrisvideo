'use client';

/** App settings sheet: language, appearance, "add to home screen", desktop view, legal links. */
import { ChevronRight, Download, LogOut, Monitor, Moon, Sun, SunMoon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Drawer, SegmentedControl, useTheme, type ThemePreference } from '@/components/ui';
import { versionLabel } from '@/lib/version';
import { useI18n } from '@/i18n/client';
import type { Locale } from '@/lib/types';
import { UserAvatar } from '@/components/site/AccountMenu';
import { useSession } from '@/components/site/SessionProvider';
import { SignInButton } from '@/components/site/SignInButton';
import { promptInstall, useInstallState } from '@/lib/client/install-prompt';
import { useUiMode } from './UiModeProvider';

/** Signed in: who, and sign-out. Signed out (sign-in configured): the Google button. */
function AccountRow() {
  const { t } = useI18n();
  const { user, authEnabled, signOut } = useSession();
  if (user) {
    return (
      <div className="flex items-center gap-3 py-3">
        <UserAvatar user={user} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-ink">{user.name ?? user.email}</span>
          <span className="block truncate text-sm text-muted">{user.email}</span>
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium text-ink active:bg-surface-2"
        >
          <LogOut aria-hidden="true" className="size-4" />
          {t('account.menu.signOut')}
        </button>
      </div>
    );
  }
  if (!authEnabled) return null;
  return (
    <div className="py-3">
      <SignInButton fullWidth />
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-3">{children}</div>;
}

export function AppSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const { switchTo } = useUiMode();
  const install = useInstallState();

  return (
    <Drawer open={open} onClose={onClose} title={t('app.settings.title')} size="sm">
      <div className="flex flex-col divide-y divide-line/70">
        <AccountRow />
        <Row>
          <span className="text-[0.9375rem] font-medium text-ink">{t('app.settings.language')}</span>
          <SegmentedControl<Locale>
            aria-label={t('app.settings.language')}
            value={locale}
            onChange={(next) => setLocale(next)}
            options={[
              { value: 'hu', label: 'Magyar' },
              { value: 'en', label: 'English' },
            ]}
            size="sm"
          />
        </Row>
        <div className="py-3">
          <span className="text-[0.9375rem] font-medium text-ink">{t('app.settings.theme')}</span>
          <SegmentedControl<ThemePreference>
            aria-label={t('app.settings.theme')}
            value={preference}
            onChange={setPreference}
            fullWidth
            className="mt-2"
            options={[
              { value: 'light', label: t('app.settings.theme.light'), icon: <Sun /> },
              { value: 'dark', label: t('app.settings.theme.dark'), icon: <Moon /> },
              { value: 'system', label: t('app.settings.theme.system'), icon: <SunMoon /> },
            ]}
          />
        </div>
        <div className="py-3">
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-ink">
            <Download aria-hidden="true" className="size-[18px] text-accent" />
            {t('app.settings.install.title')}
          </p>
          {install.standalone ? (
            <p className="mt-1 text-sm text-muted">{t('app.settings.installed')}</p>
          ) : install.canPrompt ? (
            <button
              type="button"
              onClick={() => {
                void promptInstall();
              }}
              className="mt-2 h-11 w-full rounded-xl bg-primary text-[0.9375rem] font-semibold text-primary-ink active:opacity-90"
            >
              {t('app.settings.install.button')}
            </button>
          ) : (
            <p className="mt-1 text-sm text-pretty text-muted">
              {install.ios ? t('app.settings.install.ios') : t('app.settings.install.android')}
            </p>
          )}
        </div>
        <button type="button" onClick={() => switchTo('web')} className="flex items-center gap-3 py-3 text-left active:opacity-70">
          <Monitor aria-hidden="true" className="size-5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-medium text-ink">{t('app.settings.desktop')}</span>
            <span className="block text-sm text-muted">{t('app.settings.desktopHint')}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-5 text-muted" />
        </button>
        <nav className="flex flex-col py-2">
          {[
            { href: '/privacy', label: t('app.settings.privacy') },
            { href: '/terms', label: t('app.settings.terms') },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onClose}
              className="flex items-center justify-between py-2.5 text-[0.9375rem] text-ink active:opacity-70"
            >
              {l.label}
              <ChevronRight aria-hidden="true" className="size-5 text-muted" />
            </Link>
          ))}
        </nav>
        <p className="pt-3 pb-1 text-center font-display text-sm text-muted italic">{t('app.settings.about')}</p>
        <p className="pb-1 text-center font-mono text-[0.6875rem] text-muted/80">{versionLabel()}</p>
      </div>
    </Drawer>
  );
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/client';
import { getRequestLocale } from '@/i18n/server';
import { translate } from '@/i18n';
import { getSessionUser } from '@/lib/auth/users';
import { BOOT_SCRIPT } from '@/lib/boot-script';
import { env, googleAuthEnabled } from '@/lib/env';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Providers } from '@/components/site/Providers';
import { PwaStart } from '@/components/site/PwaStart';
import { InstallBanner } from '@/components/site/InstallBanner';
import { SessionProvider } from '@/components/site/SessionProvider';
import { UiModeProvider } from '@/components/app/UiModeProvider';
import { getUiMode } from '@/components/app/ui-mode.server';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    metadataBase: new URL(env().APP_URL),
    title: { default: translate(locale, 'common.appName'), template: `%s · ${translate(locale, 'common.appName')}` },
    description: translate(locale, 'common.tagline'),
    applicationName: 'Ex Libris Video',
    openGraph: { siteName: 'Ex Libris Video', type: 'website' },
    // "Add to Home Screen" opens full screen, without browser chrome (see app/manifest.ts)
    appleWebApp: { capable: true, title: 'Ex Libris', statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  // lets the app shell draw under the notch / home indicator (padded with env(safe-area-inset-*))
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6efe2' },
    { media: '(prefers-color-scheme: dark)', color: '#13100c' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, uiMode, user] = await Promise.all([getRequestLocale(), getUiMode(), getSessionUser()]);
  const app = uiMode === 'app';
  return (
    <html lang={locale} data-theme="light" className={app ? 'app-mode' : undefined} suppressHydrationWarning>
      <head>
        {/* applies the saved theme and shelf density before the first paint (see lib/boot-script.ts) */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        {/*
          The app manifest and the home-screen tags are written here by hand: Next 15.5 streams the metadata into
          the <body> for ordinary browsers, and Chrome only takes a manifest from the <head> – without these lines
          the site was not installable ("no-manifest") and the install prompt never came.
        */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Ex Libris" />
      </head>
      <body className={app ? 'paper app-body' : 'paper flex min-h-dvh flex-col'}>
        <I18nProvider locale={locale}>
          <Providers>
            <SessionProvider user={user} authEnabled={googleAuthEnabled()}>
            <PwaStart />
            <InstallBanner />
            <UiModeProvider mode={uiMode}>
              {app ? (
                // phone app: every page renders its own full-screen <AppScreen> (top bar, content, tab bar)
                children
              ) : (
                <>
                  <SiteHeader />
                  <main className="flex-1">{children}</main>
                  <SiteFooter />
                </>
              )}
            </UiModeProvider>
            </SessionProvider>
          </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}

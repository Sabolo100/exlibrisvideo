import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/client';
import { getRequestLocale } from '@/i18n/server';
import { translate } from '@/i18n';
import { env } from '@/lib/env';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Providers } from '@/components/site/Providers';
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

/** Applies the saved theme before paint (localStorage "exl_theme": light | dark | system). */
const themeScript = `(function(){try{var t=localStorage.getItem('exl_theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, uiMode] = await Promise.all([getRequestLocale(), getUiMode()]);
  const app = uiMode === 'app';
  return (
    <html lang={locale} data-theme="light" className={app ? 'app-mode' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={app ? 'paper app-body' : 'paper flex min-h-dvh flex-col'}>
        <I18nProvider locale={locale}>
          <Providers>
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
          </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}

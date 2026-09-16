import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/client';
import { getRequestLocale } from '@/i18n/server';
import { translate } from '@/i18n';
import { env } from '@/lib/env';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Providers } from '@/components/site/Providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    metadataBase: new URL(env().APP_URL),
    title: { default: translate(locale, 'common.appName'), template: `%s · ${translate(locale, 'common.appName')}` },
    description: translate(locale, 'common.tagline'),
    applicationName: 'Ex Libris Video',
    openGraph: { siteName: 'Ex Libris Video', type: 'website' },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6efe2' },
    { media: '(prefers-color-scheme: dark)', color: '#13100c' },
  ],
};

/** Applies the saved theme before paint (localStorage "exl_theme": light | dark | system). */
const themeScript = `(function(){try{var t=localStorage.getItem('exl_theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="paper flex min-h-dvh flex-col">
        <I18nProvider locale={locale}>
          <Providers>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </Providers>
        </I18nProvider>
      </body>
    </html>
  );
}

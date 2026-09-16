/**
 * Landing page (owner: frontend-landing): hero with the uploader itself, how it works, filming tips,
 * what you get, privacy promise, FAQ and a final call to action.
 */
import type { Metadata } from 'next';
import { getServerT } from '@/i18n/server';
import { Faq } from '@/components/landing/Faq';
import { FilmingTips } from '@/components/landing/FilmingTips';
import { FinalCta } from '@/components/landing/FinalCta';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { PrivacyPromise } from '@/components/landing/PrivacyPromise';
import { WhatYouGet } from '@/components/landing/WhatYouGet';
import { AppHome } from '@/components/app/AppHome';
import { getUiMode } from '@/components/app/ui-mode.server';
import { serverUploadLimits } from '@/components/upload/server-limits';

/** Optional sample collection (public build-time setting, like the header's "Minta könyvtár" link). */
function demoCollectionId(): string | null {
  const id = process.env.NEXT_PUBLIC_DEMO_COLLECTION_ID?.trim();
  return id && /^[1-9]\d{8}$/.test(id) ? id : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getServerT();
  const title = t('landing.meta.title');
  const description = t('landing.meta.description');
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      title,
      description,
      type: 'website',
      url: '/',
      locale: locale === 'hu' ? 'hu_HU' : 'en_GB',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function HomePage() {
  // phones get the app home screen instead of the marketing page
  if ((await getUiMode()) === 'app') return <AppHome limits={serverUploadLimits()} />;
  const demoId = demoCollectionId();
  return (
    <>
      <Hero demoCollectionId={demoId} />
      <HowItWorks />
      <FilmingTips />
      <WhatYouGet />
      <PrivacyPromise />
      <Faq />
      <FinalCta demoCollectionId={demoId} />
    </>
  );
}

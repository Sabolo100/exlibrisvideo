/**
 * Landing page (owner: frontend-landing): hero with the uploader itself, how it works, filming tips,
 * what you get, privacy promise, FAQ and a final call to action.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
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
import { AuthNotice } from '@/components/site/SignInCard';
import { ensureLibrary, findUser, getSessionUser } from '@/lib/auth/users';

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

/** A signed-in user's home is their library (created on first use). */
async function signedInLibraryId(): Promise<string | null> {
  const session = await getSessionUser();
  if (!session) return null;
  if (session.libraryId) return session.libraryId;
  const user = await findUser(session.id);
  return user ? (await ensureLibrary(user)).id : null;
}

export default async function HomePage() {
  const libraryId = await signedInLibraryId();
  if (libraryId) redirect(`/${libraryId}`);
  const notice = (
    <Suspense fallback={null}>
      <AuthNotice />
    </Suspense>
  );
  // phones get the app home screen instead of the marketing page
  if ((await getUiMode()) === 'app') {
    return (
      <>
        {notice}
        <AppHome limits={serverUploadLimits()} />
      </>
    );
  }
  const demoId = demoCollectionId();
  return (
    <>
      {notice}
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

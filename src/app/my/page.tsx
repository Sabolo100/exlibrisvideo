import type { Metadata } from 'next';
import { getServerT } from '@/i18n/server';
import { AppLibrary } from '@/components/app/AppLibrary';
import { getUiMode } from '@/components/app/ui-mode.server';
import { serverUploadLimits } from '@/components/upload/server-limits';
import { MyCollections } from './MyCollections';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: t('my.meta.title'),
    description: t('my.meta.description'),
    // personal, device-specific page: nothing for search engines
    robots: { index: false, follow: true },
  };
}

export default async function MyCollectionsPage() {
  if ((await getUiMode()) === 'app') return <AppLibrary limits={serverUploadLimits()} />;
  return <MyCollections />;
}

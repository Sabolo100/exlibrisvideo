import type { Metadata } from 'next';
import { getServerT } from '@/i18n/server';
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

export default function MyCollectionsPage() {
  return <MyCollections />;
}

/**
 * `/<id>` – the collection page (owner: collection-shell).
 * Server Component: loads the collection with the viewer's access (owner cookie / PIN cookie), then hands
 * the data to the client shell. Unknown ids → 404, PIN-protected collections without a PIN cookie → PIN gate.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AppCollection } from '@/components/app/AppCollection';
import { AppPinGate } from '@/components/app/AppPinGate';
import { getUiMode } from '@/components/app/ui-mode.server';
import { CollectionPage } from '@/components/collection/CollectionPage';
import { CollectionProvider } from '@/components/collection/CollectionProvider';
import { PinGate } from '@/components/collection/PinGate';
import { headerCounts } from '@/components/collection/facets';
import { collectionTitle } from '@/components/collection/labels';
import { getServerT } from '@/i18n/server';
import { loadCollectionPage } from '@/lib/collections/queries';

export const dynamic = 'force-dynamic';

/** Public collection id: 9 digits, first digit 1–9 (SPEC §2). */
const COLLECTION_ID_RE = /^[1-9]\d{8}$/;

type Props = { params: Promise<{ id: string }> };

/**
 * One load per request, shared by generateMetadata and the page (React cache is request-scoped),
 * so the database is queried – and a non-owner view counted – only once.
 */
const getCollectionPage = cache((id: string) => loadCollectionPage(id));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { t, tp } = await getServerT();
  const robots: Metadata['robots'] = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };
  if (!COLLECTION_ID_RE.test(id)) return { robots };

  const result = await getCollectionPage(id);
  if (result.kind === 'not_found') return { robots };
  if (result.kind === 'needs_pin') {
    // never leak anything about a protected library to link previews
    const title = t('collection.meta.protected');
    const description = t('collection.meta.protectedDescription');
    return { title, description, robots, openGraph: { title, description }, twitter: { card: 'summary_large_image', title, description } };
  }

  const data = result.data;
  const title = collectionTitle(data, t);
  const counts = headerCounts(data.books);
  let description: string;
  if (data.status === 'draft' || (data.status === 'processing' && counts.books === 0)) {
    description = t('collection.meta.descriptionProcessing');
  } else if (counts.books === 0) {
    description = t('collection.meta.descriptionEmpty');
  } else {
    description = t('collection.meta.description', {
      books: tp('collection.header.books', counts.books),
      authors: tp('collection.header.authors', counts.authors),
    });
  }
  const owner = data.description?.trim();
  const fullDescription = owner ? `${description} ${owner.length > 160 ? `${owner.slice(0, 157)}…` : owner}` : description;

  return {
    title,
    description: fullDescription,
    robots,
    openGraph: { title, description: fullDescription, url: data.publicUrl, type: 'website' },
    twitter: { card: 'summary_large_image', title, description: fullDescription },
  };
}

export default async function CollectionRoute({ params }: Props) {
  const { id } = await params;
  if (!COLLECTION_ID_RE.test(id)) notFound();

  const [result, uiMode] = await Promise.all([getCollectionPage(id), getUiMode()]);
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'needs_pin') {
    return uiMode === 'app' ? (
      <AppPinGate key={`pin-${result.id}`} id={result.id} title={result.title} />
    ) : (
      <PinGate key={`pin-${result.id}`} id={result.id} title={result.title} />
    );
  }

  return (
    <CollectionProvider key={result.data.id} initial={result.data}>
      {uiMode === 'app' ? <AppCollection /> : <CollectionPage />}
    </CollectionProvider>
  );
}

import type { Metadata } from 'next';
import { getServerT } from '@/i18n/server';
import { AppDocumentScreen } from '@/components/app/AppDocumentScreen';
import { getUiMode } from '@/components/app/ui-mode.server';
import { LegalDocument, type LegalSection } from '@/components/landing/LegalDocument';
import { uploadLimitVars } from '@/components/upload/limits';
import { serverUploadLimits } from '@/components/upload/server-limits';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: t('legal.terms.meta.title'),
    description: t('legal.terms.meta.description'),
    alternates: { canonical: '/terms' },
  };
}

const SECTIONS: LegalSection[] = [
  {
    id: 'provider',
    title: 'legal.terms.provider.title',
    blocks: [
      { type: 'p', text: 'legal.terms.provider.p1' },
      { type: 'placeholder', text: 'legal.terms.provider.placeholder' },
      { type: 'contact' },
    ],
  },
  {
    id: 'service',
    title: 'legal.terms.service.title',
    blocks: [
      { type: 'p', text: 'legal.terms.service.p1' },
      { type: 'p', text: 'legal.terms.service.p2' },
    ],
  },
  {
    id: 'use',
    title: 'legal.terms.use.title',
    blocks: [{ type: 'ul', items: ['legal.terms.use.item1', 'legal.terms.use.item2', 'legal.terms.use.item3', 'legal.terms.use.item4'] }],
  },
  {
    id: 'accuracy',
    title: 'legal.terms.accuracy.title',
    blocks: [{ type: 'p', text: 'legal.terms.accuracy.p1' }],
  },
  {
    id: 'links',
    title: 'legal.terms.link.title',
    blocks: [{ type: 'ul', items: ['legal.terms.link.item1', 'legal.terms.link.item2', 'legal.terms.link.item3'] }],
  },
  {
    id: 'content',
    title: 'legal.terms.rights.title',
    blocks: [
      { type: 'p', text: 'legal.terms.rights.p1' },
      { type: 'p', text: 'legal.terms.rights.p2' },
    ],
  },
  {
    id: 'deletion',
    title: 'legal.terms.deletion.title',
    blocks: [
      { type: 'p', text: 'legal.terms.deletion.p1' },
      { type: 'p', text: 'legal.terms.deletion.p2' },
    ],
  },
  {
    id: 'liability',
    title: 'legal.terms.liability.title',
    blocks: [{ type: 'p', text: 'legal.terms.liability.p1' }],
  },
  {
    id: 'law',
    title: 'legal.terms.law.title',
    blocks: [{ type: 'p', text: 'legal.terms.law.p1' }],
  },
  {
    id: 'contact',
    title: 'legal.terms.contact.title',
    blocks: [{ type: 'p', text: 'legal.terms.contact.p1' }, { type: 'contact' }],
  },
];

export default async function TermsPage() {
  const tr = await getServerT();
  const legalDocument = (
    <LegalDocument
      title="legal.terms.title"
      intro="legal.terms.intro"
      updated="legal.terms.updated"
      sections={SECTIONS}
      related={{ href: '/privacy', label: 'legal.related.privacy' }}
      // "3. What may you upload?" quotes the configured limits
      vars={uploadLimitVars(serverUploadLimits(), tr)}
    />
  );
  if ((await getUiMode()) === 'app') {
    const { t } = await getServerT();
    return <AppDocumentScreen title={t('legal.terms.title')}>{legalDocument}</AppDocumentScreen>;
  }
  return legalDocument;
}

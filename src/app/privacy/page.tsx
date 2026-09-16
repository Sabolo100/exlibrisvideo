import type { Metadata } from 'next';
import { getServerT } from '@/i18n/server';
import { AppDocumentScreen } from '@/components/app/AppDocumentScreen';
import { getUiMode } from '@/components/app/ui-mode.server';
import { LegalDocument, type LegalSection } from '@/components/landing/LegalDocument';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: t('legal.privacy.meta.title'),
    description: t('legal.privacy.meta.description'),
    alternates: { canonical: '/privacy' },
  };
}

const SECTIONS: LegalSection[] = [
  {
    id: 'controller',
    title: 'legal.privacy.controller.title',
    blocks: [
      { type: 'p', text: 'legal.privacy.controller.p1' },
      { type: 'placeholder', text: 'legal.privacy.controller.placeholder' },
      { type: 'p', text: 'legal.privacy.controller.p2' },
      { type: 'contact' },
    ],
  },
  {
    id: 'data',
    title: 'legal.privacy.data.title',
    blocks: [
      {
        type: 'ul',
        items: [
          'legal.privacy.data.item1',
          'legal.privacy.data.item2',
          'legal.privacy.data.item3',
          'legal.privacy.data.item4',
          'legal.privacy.data.item5',
        ],
      },
      { type: 'p', text: 'legal.privacy.data.p1' },
    ],
  },
  {
    id: 'purposes',
    title: 'legal.privacy.purpose.title',
    blocks: [
      { type: 'ul', items: ['legal.privacy.purpose.item1', 'legal.privacy.purpose.item2', 'legal.privacy.purpose.item3'] },
      { type: 'p', text: 'legal.privacy.purpose.p1' },
    ],
  },
  {
    id: 'processors',
    title: 'legal.privacy.ai.title',
    blocks: [
      { type: 'p', text: 'legal.privacy.ai.p1' },
      { type: 'ul', items: ['legal.privacy.ai.item1', 'legal.privacy.ai.item2'] },
      { type: 'p', text: 'legal.privacy.ai.p2' },
      { type: 'p', text: 'legal.privacy.ai.p3' },
      { type: 'p', text: 'legal.privacy.ai.p4' },
      { type: 'placeholder', text: 'legal.privacy.ai.placeholder' },
    ],
  },
  {
    id: 'hosting',
    title: 'legal.privacy.hosting.title',
    blocks: [
      { type: 'p', text: 'legal.privacy.hosting.p1' },
      { type: 'p', text: 'legal.privacy.hosting.p2' },
    ],
  },
  {
    id: 'retention',
    title: 'legal.privacy.retention.title',
    blocks: [
      {
        type: 'ul',
        items: [
          'legal.privacy.retention.item1',
          'legal.privacy.retention.item2',
          'legal.privacy.retention.item3',
          'legal.privacy.retention.item4',
          'legal.privacy.retention.item5',
        ],
      },
    ],
  },
  {
    id: 'cookies',
    title: 'legal.privacy.cookies.title',
    blocks: [
      { type: 'p', text: 'legal.privacy.cookies.p1' },
      {
        type: 'ul',
        items: ['legal.privacy.cookies.item1', 'legal.privacy.cookies.item2', 'legal.privacy.cookies.item3', 'legal.privacy.cookies.item4'],
      },
      { type: 'p', text: 'legal.privacy.cookies.p2' },
    ],
  },
  {
    id: 'rights',
    title: 'legal.privacy.rights.title',
    blocks: [
      { type: 'p', text: 'legal.privacy.rights.p1' },
      {
        type: 'ul',
        items: [
          'legal.privacy.rights.item1',
          'legal.privacy.rights.item2',
          'legal.privacy.rights.item3',
          'legal.privacy.rights.item4',
          'legal.privacy.rights.item5',
        ],
      },
      { type: 'p', text: 'legal.privacy.rights.p2' },
      { type: 'p', text: 'legal.privacy.rights.p3' },
      { type: 'p', text: 'legal.privacy.rights.p4' },
    ],
  },
  {
    id: 'children',
    title: 'legal.privacy.children.title',
    blocks: [{ type: 'p', text: 'legal.privacy.children.p1' }],
  },
  {
    id: 'changes',
    title: 'legal.privacy.changes.title',
    blocks: [{ type: 'p', text: 'legal.privacy.changes.p1' }, { type: 'contact' }],
  },
];

export default async function PrivacyPage() {
  const legalDocument = (
    <LegalDocument
      title="legal.privacy.title"
      intro="legal.privacy.intro"
      updated="legal.privacy.updated"
      sections={SECTIONS}
      related={{ href: '/terms', label: 'legal.related.terms' }}
    />
  );
  if ((await getUiMode()) === 'app') {
    const { t } = await getServerT();
    return <AppDocumentScreen title={t('legal.privacy.title')}>{legalDocument}</AppDocumentScreen>;
  }
  return legalDocument;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UiPreview } from './UiPreview';

export const metadata: Metadata = {
  title: 'UI kit',
  robots: { index: false, follow: false },
};

/** Dev-only living style guide of the UI kit (404 in production builds). */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiPreview />;
}

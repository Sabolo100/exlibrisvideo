import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DevCameraHarness } from '@/components/camera/DevCameraHarness';

export const metadata: Metadata = {
  title: 'Camera recorder (dev)',
  robots: { index: false, follow: false },
};

/** Dev-only harness of the in-app recorder (404 in production builds). */
export default function DevCameraPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevCameraHarness />;
}

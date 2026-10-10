'use client';

import { useEffect } from 'react';
import { startPwa } from '@/lib/client/install-prompt';

let started = false;

/** Mounted once in the root layout: service worker + catching the install prompt. */
export function PwaStart() {
  useEffect(() => {
    if (started) return;
    started = true;
    startPwa();
  }, []);
  return null;
}

'use client';

import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMounted } from './hooks';

export interface PortalProps {
  children: ReactNode;
  /** defaults to document.body */
  container?: HTMLElement | null;
}

/** Renders children into document.body after hydration (nothing on the server). */
export function Portal({ children, container }: PortalProps) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(children, container ?? document.body);
}

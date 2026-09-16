'use client';

import { createContext, useContext } from 'react';
import type { SpineSize } from './spine-layout';

export interface ShelfContextValue {
  size: SpineSize;
  photo: boolean;
}

/** Provided by <Shelf>: BookSpine children default to the shelf's size and photo mode. */
export const ShelfContext = createContext<ShelfContextValue | null>(null);

export function useShelfContext(): ShelfContextValue | null {
  return useContext(ShelfContext);
}

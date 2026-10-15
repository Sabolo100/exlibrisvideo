'use client';

/**
 * The phone's back button closes an open sheet (bottom drawer) instead of leaving the page.
 *
 * Opening the first sheet pushes one history entry (same URL, `{ exlSheet: true }`); the back button pops it and
 * every open sheet closes. A sheet closed by the UI takes the entry away again with history.back() – one tick
 * later, so a sheet that replaces another (More → Filters) keeps the entry. The popstate of such a "sheet entry"
 * must not move the catalogue's state (its URL may be older than a filter set inside the sheet): the collection
 * provider asks `isSheetPop(event)` and rewrites its current state instead of reading the URL.
 *
 * Only one history entry is ever pushed for any number of stacked sheets.
 */
import { useEffect, useRef } from 'react';

type Closer = () => void;

const openSheets = new Set<Closer>();
let entryPushed = false;
/** our own history.back() (a sheet closed by the UI) is on its way */
let uiBackPending = false;
let lastSheetPop: Event | null = null;
let checkScheduled = false;

function onPopState(event: PopStateEvent) {
  if (uiBackPending) {
    uiBackPending = false;
    lastSheetPop = event;
    return;
  }
  if (entryPushed) {
    entryPushed = false;
    lastSheetPop = event;
    for (const close of [...openSheets]) close();
  }
}

if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);

/** true when this popstate only removed a sheet entry (the page state did not change). */
export function isSheetPop(event: Event): boolean {
  return event === lastSheetPop;
}

function dropEntryIfUnused() {
  checkScheduled = false;
  if (openSheets.size > 0 || !entryPushed) return;
  entryPushed = false;
  uiBackPending = true;
  window.history.back();
}

/** Registers an open sheet; the returned function unregisters it (the sheet closed). */
export function openSheet(close: Closer): () => void {
  openSheets.add(close);
  if (!entryPushed) {
    try {
      window.history.pushState({ exlSheet: true }, '', window.location.href);
      entryPushed = true;
    } catch {
      /* history throttled: the back button just leaves as before */
    }
  }
  return () => {
    openSheets.delete(close);
    if (checkScheduled) return;
    checkScheduled = true;
    window.setTimeout(dropEntryIfUnused, 0);
  };
}

/** While `open`, the back button calls `onClose` instead of leaving the screen. */
export function useBackDismiss(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return openSheet(() => closeRef.current());
  }, [open]);
}

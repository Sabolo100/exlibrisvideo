'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { uploadStore, type UploadItem, type UploadStoreState } from '@/lib/client/upload-store';
import { createUploadLimitsSource, DEFAULT_UPLOAD_LIMITS, UPLOAD_LIMITS_URL, type UploadLimits } from './limits';
import { getFileThumbnail, type FileThumbnail } from './thumbnails';

/** GET /api/config, shared by every component of the tab (the response may be cached for 5 minutes). */
const uploadLimitsSource = createUploadLimitsSource(() => fetch(UPLOAD_LIMITS_URL, { credentials: 'same-origin' }));

/**
 * The server's upload limits. `known` (read by a Server Component) is used as is; otherwise they are loaded from
 * GET /api/config, with the defaults until the answer arrives (and during SSR and hydration).
 */
export function useUploadLimits(known?: UploadLimits): UploadLimits {
  const remote = useSyncExternalStore(uploadLimitsSource.subscribe, uploadLimitsSource.get, () => null);
  const needsRemote = !known;
  useEffect(() => {
    if (needsRemote) void uploadLimitsSource.load();
  }, [needsRemote]);
  return known ?? remote ?? DEFAULT_UPLOAD_LIMITS;
}

/** Whole upload-store snapshot (re-renders on every store change). */
export function useUploadState(): UploadStoreState {
  return useSyncExternalStore(uploadStore.subscribe, uploadStore.getSnapshot, uploadStore.getServerSnapshot);
}

/** Upload items of one collection (stable array identity between unrelated store changes). */
export function useCollectionUploads(collectionId: string | null | undefined): readonly UploadItem[] {
  const { items } = useUploadState();
  return useMemo(() => (collectionId ? items.filter((i) => i.collectionId === collectionId) : []), [items, collectionId]);
}

/** Current time, refreshed every `intervalMs` while `active` (for smooth progress estimates / ETAs). */
export function useNow(active: boolean, intervalMs = 400): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

/** Thumbnail of a picked file (null while generating). */
export function useFileThumbnail(file: Blob | undefined, kind: 'video' | 'image'): FileThumbnail | null {
  const [thumb, setThumb] = useState<{ file: Blob; value: FileThumbnail } | null>(null);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    void getFileThumbnail(file, kind).then((value) => {
      if (alive) setThumb({ file, value });
    });
    return () => {
      alive = false;
    };
  }, [file, kind]);
  return thumb && thumb.file === file ? thumb.value : null;
}

/** navigator.onLine as a live value (true during SSR). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

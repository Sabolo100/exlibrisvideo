'use client';

/**
 * App-wide "new catalogue" flow: the record button opens the in-app camera, the gallery button a file
 * picker; the resulting files go into the "Új katalógus" sheet, which uploads them and starts processing.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CameraRecorder } from '@/components/camera/CameraRecorder';
import { copyPickedFiles } from '@/lib/client/stable-files';
import type { UploadLimits } from '@/components/upload/limits';
import { AppNewCatalogSheet } from './AppNewCatalogSheet';

interface AppRecordValue {
  /** opens the in-app camera */
  record: () => void;
  /** opens the photo / video picker */
  pickFromGallery: () => void;
}

const AppRecordContext = createContext<AppRecordValue>({ record: () => undefined, pickFromGallery: () => undefined });

const GALLERY_ACCEPT = 'video/*,image/jpeg,image/png,image/webp,.mp4,.m4v,.mov,.webm,.mkv,.3gp,.jpg,.jpeg,.png,.webp';

export function AppRecordProvider({ children, limits }: { children: ReactNode; limits?: UploadLimits }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  /** picked files still being copied (see stable-files.ts) */
  const [preparing, setPreparing] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((next: File[]) => {
    if (next.length === 0) return;
    setFiles((prev) => [...prev, ...next]);
    setSheetOpen(true);
  }, []);

  const record = useCallback(() => setCameraOpen(true), []);
  const pickFromGallery = useCallback(() => inputRef.current?.click(), []);
  const value = useMemo(() => ({ record, pickFromGallery }), [record, pickFromGallery]);
  const maxDurationSec = Math.min(180, limits?.maxVideoSeconds ?? 180);

  return (
    <AppRecordContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={GALLERY_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const input = e.currentTarget;
          const picked = Array.from(input.files ?? []);
          if (picked.length === 0) return;
          // open the files right now: Chrome on Android drops access to picked files after a moment
          const copies = copyPickedFiles(picked);
          setPreparing((n) => n + picked.length);
          setSheetOpen(true);
          void copies.then((ready) => {
            input.value = '';
            setPreparing((n) => Math.max(0, n - picked.length));
            addFiles(ready);
          });
        }}
      />
      <CameraRecorder
        open={cameraOpen}
        maxDurationSec={maxDurationSec}
        onClose={() => setCameraOpen(false)}
        onDone={(recorded: File[]) => {
          setCameraOpen(false);
          addFiles(recorded);
        }}
      />
      <AppNewCatalogSheet
        open={sheetOpen}
        files={files}
        preparing={preparing}
        limits={limits}
        onClose={() => setSheetOpen(false)}
        onRecordMore={() => setCameraOpen(true)}
      />
    </AppRecordContext.Provider>
  );
}

export function useAppRecord(): AppRecordValue {
  return useContext(AppRecordContext);
}

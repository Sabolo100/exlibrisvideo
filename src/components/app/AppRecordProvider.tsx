'use client';

/**
 * App-wide "new catalogue" flow: the record button opens the in-app camera, the gallery button a file
 * picker; the resulting files go into the "Új katalógus" sheet, which uploads them and starts processing.
 * A signed-in user has one library: their recordings are uploaded into it and the library opens. A guest is
 * asked once whether to sign in first (SignInNudge) before the camera / picker opens.
 */
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CameraRecorder } from '@/components/camera/CameraRecorder';
import { useSession } from '@/components/site/SessionProvider';
import { useSignInNudge } from '@/components/site/SignInNudge';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/client';
import { copyPickedFiles } from '@/lib/client/stable-files';
import { uploadStore } from '@/lib/client/upload-store';
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
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const libraryId = useSession().user?.libraryId ?? null;
  const { guard, nudge } = useSignInNudge();

  const addFiles = useCallback(
    (next: File[]) => {
      if (next.length === 0) return;
      if (libraryId) {
        // signed in: straight into the user's library
        uploadStore.enqueue(libraryId, next);
        toast({ title: t('app.collection.uploadStarted'), tone: 'info' });
        router.push(`/${libraryId}`);
        return;
      }
      setFiles((prev) => [...prev, ...next]);
      setSheetOpen(true);
    },
    [libraryId, router, t, toast],
  );

  const record = useCallback(() => guard(() => setCameraOpen(true)), [guard]);
  const pickFromGallery = useCallback(() => guard(() => inputRef.current?.click()), [guard]);
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
          if (!libraryId) setSheetOpen(true);
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
      {nudge}
    </AppRecordContext.Provider>
  );
}

export function useAppRecord(): AppRecordValue {
  return useContext(AppRecordContext);
}

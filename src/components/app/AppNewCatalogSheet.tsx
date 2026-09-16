'use client';

/**
 * "Új katalógus" bottom sheet: the recorded / picked files start uploading at once (the uploader creates
 * the collection on the first file); the optional title, name and e-mail sit below; "start processing"
 * navigates to the new catalogue while the uploads continue in the background.
 */
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Uploader, type UploaderHandle } from '@/components/upload/Uploader';
import type { UploadLimits } from '@/components/upload/limits';
import { Drawer } from '@/components/ui';
import { useI18n } from '@/i18n/client';

export interface AppNewCatalogSheetProps {
  open: boolean;
  onClose: () => void;
  /** files to add when the sheet opens (each batch is added once) */
  files: readonly File[];
  /** picked files still being prepared (copied) before they can be added */
  preparing?: number;
  limits?: UploadLimits;
  onRecordMore?: () => void;
}

export function AppNewCatalogSheet({ open, onClose, files, preparing = 0, limits, onRecordMore }: AppNewCatalogSheetProps) {
  const { t } = useI18n();
  const uploaderRef = useRef<UploaderHandle>(null);
  const added = useRef(new WeakSet<File>());

  useEffect(() => {
    if (!open) return;
    // the uploader mounts inside the sheet: wait a frame for its ref
    const raf = requestAnimationFrame(() => {
      const fresh = files.filter((f) => !added.current.has(f));
      if (fresh.length === 0 || !uploaderRef.current) return;
      fresh.forEach((f) => added.current.add(f));
      uploaderRef.current.addFiles(fresh);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, files]);

  return (
    <Drawer open={open} onClose={onClose} title={t('app.new.title')} description={t('app.new.description')} size="md">
      {preparing > 0 ? (
        <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-accent" />
          {t('app.new.preparing')}
        </p>
      ) : null}
      <Uploader ref={uploaderRef} variant="app" limits={limits} onRecordMore={onRecordMore} className="pb-2" />
    </Drawer>
  );
}

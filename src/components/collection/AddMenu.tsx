'use client';

/** Owner "add" actions: more videos/photos (Uploader in a dialog) and manual book entry. */
import { BookPlus, ChevronDown, Plus, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AddBookDialog } from '@/components/book/AddBookDialog';
import { Button, Dialog, DropdownMenu, useToast } from '@/components/ui';
import { Uploader } from '@/components/upload/Uploader';
import { useI18n } from '@/i18n/client';
import { useCollection } from './context';
import { useCollectionShell } from './shell-context';

export function AddVideoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection, refresh } = useCollection();
  const { refreshSilently } = useCollectionShell();
  // interrupted uploads on the server (e.g. the tab was closed): picking the same file again resumes them
  const resumable = useMemo(
    () =>
      collection.videos
        .filter((v) => v.uploadStatus === 'uploading')
        .map((v) => ({ videoId: v.id, name: v.originalFilename, size: v.sizeBytes })),
    [collection.videos],
  );

  const close = () => {
    onClose();
    // uploads keep running in the background store; pick up a status change (ready → processing)
    void refreshSilently();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      icon={<Video />}
      title={t('collection.add.videoTitle')}
      description={t('collection.add.videoDescription')}
    >
      <Uploader
        variant="compact"
        collectionId={collection.id}
        existingSourceCount={collection.videos.filter((v) => v.uploadStatus !== 'failed').length}
        resumableUploads={resumable}
        onAllComplete={() => {
          toast({ title: t('collection.add.videoDone'), tone: 'success' });
          onClose();
          void refresh();
        }}
      />
    </Dialog>
  );
}

export function AddMenu() {
  const { t } = useI18n();
  const [videoOpen, setVideoOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);

  return (
    <>
      <DropdownMenu
        aria-label={t('collection.add.menu')}
        align="end"
        minWidth={272}
        items={[
          {
            key: 'video',
            label: t('collection.add.video'),
            description: t('collection.add.videoHint'),
            icon: <Video />,
            onSelect: () => setVideoOpen(true),
          },
          {
            key: 'manual',
            label: t('collection.add.manual'),
            description: t('collection.add.manualHint'),
            icon: <BookPlus />,
            onSelect: () => setBookOpen(true),
          },
        ]}
        trigger={
          <Button variant="primary" leftIcon={<Plus className="size-4" />} rightIcon={<ChevronDown className="size-4 opacity-70 max-sm:hidden" />}>
            <span className="max-sm:sr-only">{t('collection.action.add')}</span>
          </Button>
        }
      />
      <AddVideoDialog open={videoOpen} onClose={() => setVideoOpen(false)} />
      <AddBookDialog open={bookOpen} onOpenChange={setBookOpen} />
    </>
  );
}

'use client';

/**
 * Owner "add" block under the catalogue header: the three ways of putting books into the library are
 * always in view, side by side, each with its own start button – a recording (video / photos, the
 * recommended one), a single book from a photo, a single book by hand. The dialogs behind them live here too.
 */
import { BookPlus, Camera, Video } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { AddBookDialog } from '@/components/book/AddBookDialog';
import { AddBookPhotoDialog } from '@/components/book/AddBookPhotoDialog';
import { Button, Dialog, cn, useToast } from '@/components/ui';
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

interface AddOption {
  key: 'video' | 'photo' | 'manual';
  icon: ReactNode;
  title: string;
  hint: string;
  cta: string;
  /** the recommended way: filled tile, gilt button, "recommended" tag */
  featured?: boolean;
  onStart: () => void;
}

function AddOptionTile({ option }: { option: AddOption }) {
  const { t } = useI18n();
  const titleId = useId();
  const { featured } = option;

  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 rounded-xl border p-3.5 sm:p-4',
        featured ? 'border-primary bg-primary text-primary-ink shadow-lift' : 'border-line bg-surface shadow-soft',
      )}
    >
      {featured ? (
        <span className="absolute -top-2.5 right-3.5 inline-flex h-5 items-center rounded-full border border-[#9c7424] bg-[linear-gradient(180deg,#ecd08e,#d3a855)] px-2 text-[0.6875rem] font-semibold tracking-wide text-[#2a1c08] uppercase shadow-soft">
          {t('collection.add.recommended')}
        </span>
      ) : null}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5',
            featured ? 'bg-primary-ink/15 text-primary-ink' : 'bg-accent-soft text-accent',
          )}
        >
          {option.icon}
        </span>
        <div className="min-w-0">
          <h3 id={titleId} className="font-display text-[1.0625rem] leading-tight font-semibold text-balance">
            {option.title}
          </h3>
          <p className={cn('mt-1 text-[0.8125rem] leading-snug text-pretty', featured ? 'text-primary-ink/80' : 'text-muted')}>{option.hint}</p>
        </div>
      </div>
      <Button
        variant={featured ? 'gold' : 'secondary'}
        fullWidth
        aria-describedby={titleId}
        leftIcon={option.icon}
        onClick={option.onStart}
        className="mt-auto"
      >
        {option.cta}
      </Button>
    </li>
  );
}

export function AddPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const [videoOpen, setVideoOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const titleId = useId();

  const options: AddOption[] = [
    {
      key: 'video',
      icon: <Video />,
      title: t('collection.add.videoOption'),
      hint: t('collection.add.videoOptionHint'),
      cta: t('collection.add.videoStart'),
      featured: true,
      onStart: () => setVideoOpen(true),
    },
    {
      key: 'photo',
      icon: <Camera />,
      title: t('book.photo.menu'),
      hint: t('book.photo.menuHint'),
      cta: t('book.photo.start'),
      onStart: () => setPhotoOpen(true),
    },
    {
      key: 'manual',
      icon: <BookPlus />,
      title: t('collection.add.manual'),
      hint: t('collection.add.manualHint'),
      cta: t('collection.add.manualStart'),
      onStart: () => setBookOpen(true),
    },
  ];

  return (
    <section
      aria-labelledby={titleId}
      className={cn('relative rounded-card border border-accent/50 bg-accent-soft/50 p-3 shadow-soft sm:p-4 print:hidden', className)}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-[calc(var(--radius-card)-5px)] border border-accent/25" />
      <div className="relative grid gap-4 pt-1 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-stretch lg:pt-0">
        <div className="flex flex-col justify-center px-1 lg:pr-2 lg:pl-3">
          <h2 id={titleId} className="font-display text-[1.375rem] leading-tight font-semibold text-balance text-ink">
            {t('collection.add.title')}
          </h2>
          <p className="mt-1.5 text-[0.8125rem] leading-snug text-pretty text-muted">{t('collection.add.subtitle')}</p>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {options.map((option) => (
            <AddOptionTile key={option.key} option={option} />
          ))}
        </ul>
      </div>
      <AddVideoDialog open={videoOpen} onClose={() => setVideoOpen(false)} />
      <AddBookDialog open={bookOpen} onOpenChange={setBookOpen} />
      <AddBookPhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} />
    </section>
  );
}

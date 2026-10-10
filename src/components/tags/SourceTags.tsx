'use client';

/**
 * Tags of one recording: shown as small chips; the owner edits them in a dialog. Saving updates the
 * recording and the books found in it (server side), then the catalogue reloads.
 */
import { Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCollection } from '@/components/collection/context';
import { Button, Chip, Dialog, cn, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import type { VideoDTO } from '@/lib/types';
import { TagPicker } from './TagPicker';
import { tagSuggestions } from './tag-utils';

export function SourceTags({ video, className }: { video: Pick<VideoDTO, 'id' | 'originalFilename' | 'tags'>; className?: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection, books, isOwner, refresh } = useCollection();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(video.tags);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => tagSuggestions(books, collection.videos), [books, collection.videos]);

  if (!isOwner && video.tags.length === 0) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.setSourceTags(video.id, draft);
      setOpen(false);
      toast({ title: t('collection.tags.saved'), tone: 'success' });
      await refresh();
    } catch {
      toast({ title: t('collection.tags.saveFailed'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {video.tags.map((tag) => (
        <Chip key={tag} size="sm" icon={<Tag />}>
          {tag}
        </Chip>
      ))}
      {isOwner ? (
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Tag />}
          onClick={() => {
            setDraft(video.tags);
            setOpen(true);
          }}
        >
          {video.tags.length ? t('collection.tags.edit') : t('collection.tags.addTo')}
        </Button>
      ) : null}
      {isOwner ? (
        <Dialog
          open={open}
          onClose={() => (busy ? undefined : setOpen(false))}
          title={t('collection.tags.editTitle')}
          description={video.originalFilename}
          icon={<Tag />}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                {t('common.action.cancel')}
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                {t('collection.tags.save')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-muted text-pretty">{t('collection.tags.editDescription')}</p>
          <TagPicker value={draft} onChange={setDraft} suggestions={suggestions} hideHint={false} disabled={busy} />
        </Dialog>
      ) : null}
    </div>
  );
}

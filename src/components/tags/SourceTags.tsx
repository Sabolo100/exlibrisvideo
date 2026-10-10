'use client';

/**
 * Tags of one recording: shown as small chips; the owner edits them in a dialog. Saving updates the
 * recording and the books found in it (server side); `onSaved` lets the screen reload.
 */
import { Tag } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Dialog, cn, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import type { VideoDTO } from '@/lib/types';
import { TagPicker } from './TagPicker';

export function SourceTags({
  video,
  suggestions,
  canEdit,
  onSaved,
  className,
}: {
  video: Pick<VideoDTO, 'id' | 'originalFilename' | 'tags'>;
  /** the library's tags, most used first */
  suggestions: readonly string[];
  canEdit: boolean;
  onSaved?: (video: VideoDTO) => void | Promise<void>;
  className?: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(video.tags);
  const [busy, setBusy] = useState(false);

  if (!canEdit && video.tags.length === 0) return null;

  const save = async () => {
    setBusy(true);
    try {
      const { video: updated } = await api.setSourceTags(video.id, draft);
      setOpen(false);
      toast({ title: t('collection.tags.saved'), tone: 'success' });
      await onSaved?.(updated);
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
      {canEdit ? (
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
      {canEdit ? (
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
          <TagPicker value={draft} onChange={setDraft} suggestions={suggestions} disabled={busy} />
        </Dialog>
      ) : null}
    </div>
  );
}

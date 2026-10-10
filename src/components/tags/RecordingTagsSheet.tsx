'use client';

/** Phone app: right after a recording, before its upload starts – "whose shelf is this?" (optional tags). */
import { Tag, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Drawer } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { TagPicker } from './TagPicker';

export function RecordingTagsSheet({
  open,
  suggestions,
  onUpload,
}: {
  open: boolean;
  suggestions: readonly string[];
  /** called once: with the chosen tags (empty = no tags) */
  onUpload: (tags: string[]) => void;
}) {
  const { t } = useI18n();
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    if (open) setTags([]);
  }, [open]);

  return (
    <Drawer
      open={open}
      // closing the sheet must not lose the recording: it is uploaded without tags
      onClose={() => onUpload([])}
      title={t('collection.tags.uploadTitle')}
      size="sm"
      footer={
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => onUpload([])}>
            {t('collection.tags.uploadSkip')}
          </Button>
          <Button variant="primary" leftIcon={tags.length ? <Tag /> : <Upload />} onClick={() => onUpload(tags)}>
            {t('collection.tags.uploadStart')}
          </Button>
        </div>
      }
    >
      <TagPicker value={tags} onChange={setTags} suggestions={suggestions} />
    </Drawer>
  );
}

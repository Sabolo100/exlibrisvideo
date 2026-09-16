'use client';

/** Owner action on a finished source in the frames view: recognise its books again from the stored frames. */
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useCollection } from '@/components/collection/context';
import { Button, Dialog, useToast } from '@/components/ui';
import { useUiTranslator } from '@/components/ui/hooks';
import { api } from '@/lib/client/api';
import type { VideoDTO } from '@/lib/types';

export function ReanalyzeButton({ video }: { video: Pick<VideoDTO, 'id' | 'originalFilename'> }) {
  const { t } = useUiTranslator();
  const { refresh } = useCollection();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await api.reanalyzeSource(video.id);
      setOpen(false);
      toast({ title: t('visual.frames.reanalyze.started'), tone: 'success' });
      await refresh();
    } catch {
      toast({ title: t('visual.frames.reanalyze.failed'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => setOpen(true)} className="ml-auto">
        {t('visual.frames.reanalyze')}
      </Button>
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title={t('visual.frames.reanalyze.title')}
        description={video.originalFilename}
        icon={<RefreshCw />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t('visual.frames.reanalyze.cancel')}
            </Button>
            <Button variant="primary" onClick={start} loading={busy} data-autofocus>
              {t('visual.frames.reanalyze.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted text-pretty">{t('visual.frames.reanalyze.body')}</p>
      </Dialog>
    </>
  );
}

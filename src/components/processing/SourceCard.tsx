'use client';

import { BookOpen, CircleAlert, Film, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';
import { formatBytes, formatDuration } from '@/components/upload/format';
import { useUploadLimits } from '@/components/upload/hooks';
import { formatVideoLimit, type UploadLimits } from '@/components/upload/limits';
import type { UploadItem } from '@/lib/client/upload-store';
import type { CollectionStatus, VideoDTO } from '@/lib/types';
import { focusStep, sourceErrorKind, sourcePhase, stageSteps, type SourcePhase } from './model';
import { StageStepper } from './StageStepper';

export interface SourceCardProps {
  video: VideoDTO;
  collectionStatus: CollectionStatus;
  /** the unfinished local upload of this source, when it runs in this tab */
  upload?: UploadItem | null;
  isOwner: boolean;
  /** owner: removes the source (resolves when done; rejects on failure) */
  onRemove?: (video: VideoDTO) => Promise<void>;
  /** the server's upload limits (the "too long" guidance quotes MAX_VIDEO_SECONDS); loaded when not given */
  limits?: UploadLimits;
  className?: string;
}

const PHASE_TONE: Record<SourcePhase, BadgeTone> = {
  uploading: 'blue',
  interrupted: 'gold',
  queued: 'neutral',
  processing: 'gold',
  waiting_enrich: 'green',
  enriching: 'gold',
  done: 'green',
  error: 'red',
};

const PHASE_KEY: Record<SourcePhase, MessageKey> = {
  uploading: 'processing.source.phase.uploading',
  interrupted: 'processing.source.phase.interrupted',
  queued: 'processing.source.phase.queued',
  processing: 'processing.source.phase.processing',
  waiting_enrich: 'processing.source.phase.waiting_enrich',
  enriching: 'processing.source.phase.enriching',
  done: 'processing.source.phase.done',
  error: 'processing.source.phase.error',
};

/** One uploaded video / photo: stage stepper, progress, frames, books found, localized errors with guidance. */
export function SourceCard({ video, collectionStatus, upload, isOwner, onRemove, limits: knownLimits, className }: SourceCardProps) {
  const { t, tp, n, locale } = useI18n();
  const limits = useUploadLimits(knownLimits);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // a local upload that already finished counts too: the server status may lag one poll behind
  const uploadingHere = Boolean(upload && upload.status !== 'error' && upload.status !== 'canceled');
  const phase = sourcePhase(video, collectionStatus, uploadingHere);
  const steps = stageSteps(video, phase);
  const focus = focusStep(steps);
  const errorKind = phase === 'error' ? (sourceErrorKind(video) ?? 'internal') : null;
  const Icon = video.kind === 'image' ? ImageIcon : Film;
  const kindLabel = video.kind === 'image' ? t('processing.source.kind.image') : t('processing.source.kind.video');
  const canRemove = isOwner && Boolean(onRemove) && (phase === 'error' || phase === 'interrupted');

  const meta = [
    kindLabel,
    formatBytes(video.sizeBytes, locale),
    video.durationSec && video.kind === 'video' ? t('processing.source.duration', { duration: formatDuration(video.durationSec) }) : null,
  ].filter(Boolean);

  const confirmRemove = async () => {
    if (!onRemove) return;
    setRemoving(true);
    try {
      await onRemove(video);
      setConfirmOpen(false);
    } catch {
      /* the parent shows the error toast; keep the dialog open for another try */
    } finally {
      setRemoving(false);
    }
  };

  const showProgress = phase === 'processing' || phase === 'enriching' || (phase === 'uploading' && upload);
  const progressValue =
    phase === 'uploading' && upload
      ? upload.size > 0
        ? (Math.min(upload.bytesSent, upload.size) / upload.size) * 100
        : 0
      : phase === 'enriching'
        ? null
        : Math.max(0, Math.min(100, video.progress));

  const hint: string | null =
    phase === 'uploading'
      ? t('processing.source.uploadingHint')
      : phase === 'queued'
        ? t('processing.source.queuedHint')
        : phase === 'waiting_enrich'
          ? t('processing.source.waitingHint')
          : phase === 'done'
            ? t('processing.source.doneHint')
            : phase === 'interrupted'
              ? isOwner
                ? t('processing.source.interruptedHint.owner')
                : t('processing.source.interruptedHint.viewer')
              : null;

  return (
    <Card as="article" aria-label={video.originalFilename} className={cn('p-4 sm:p-5', className)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-5',
            phase === 'error' ? 'border-danger/30 bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))] text-danger' : 'border-line bg-surface-2 text-muted',
          )}
        >
          <Icon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="min-w-0 truncate font-sans text-sm font-semibold text-ink" title={video.originalFilename}>
              {video.originalFilename}
            </h3>
            <Badge tone={PHASE_TONE[phase]} size="sm" dot>
              {t(PHASE_KEY[phase])}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted tabular-nums">{meta.join(' · ')}</p>
        </div>
      </div>

      {phase !== 'error' ? <StageStepper steps={steps} className="mt-4" /> : null}

      {phase === 'processing' || phase === 'enriching' ? (
        focus ? (
          <p className="mt-3 text-sm text-ink">
            <span className="font-semibold">{t(`processing.stage.${focus.stage}.label`)}</span>
            <span aria-hidden="true" className="text-muted">
              {' '}
              ·{' '}
            </span>
            <span className="text-muted">{t(`processing.stage.${focus.stage}.desc`)}</span>
          </p>
        ) : null
      ) : hint ? (
        <p className="mt-3 text-sm text-muted text-pretty">{hint}</p>
      ) : null}

      {showProgress ? (
        <ProgressBar
          className="mt-3"
          size="sm"
          tone={phase === 'uploading' ? 'gold' : 'primary'}
          value={progressValue}
          label={t('processing.source.progressLabel', { name: video.originalFilename })}
        />
      ) : null}

      {errorKind ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2.5 rounded-lg border border-danger/25 bg-[color-mix(in_oklab,var(--danger)_7%,var(--surface))] px-3 py-2.5"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-danger">{t(`processing.error.${errorKind}.title`)}</p>
            <p className="mt-0.5 text-ink text-pretty">
              {t(`processing.error.${errorKind}.hint`, { maxDuration: formatVideoLimit(limits, tp) })}
            </p>
          </div>
        </div>
      ) : null}

      {(video.framesTotal > 0 && phase !== 'error') || video.booksFound > 0 || canRemove ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted tabular-nums">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {video.framesTotal > 0 && phase !== 'error' ? (
              <span>
                {t('processing.source.frames', {
                  done: n(Math.min(video.framesAnalyzed, video.framesTotal)),
                  total: n(video.framesTotal),
                })}
              </span>
            ) : null}
            {video.booksFound > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-ink">
                <BookOpen aria-hidden="true" className="size-3.5 text-accent" />
                {tp('processing.source.books', video.booksFound)}
              </span>
            ) : null}
          </div>
          {canRemove ? (
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              leftIcon={<Trash2 />}
              aria-label={t('processing.source.removeAria', { name: video.originalFilename })}
              onClick={() => setConfirmOpen(true)}
            >
              {t('processing.source.remove')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canRemove ? (
        <Dialog
          open={confirmOpen}
          onClose={() => (removing ? undefined : setConfirmOpen(false))}
          title={t('processing.source.remove.title')}
          description={t('processing.source.remove.description', { name: video.originalFilename })}
          tone="danger"
          size="sm"
          icon={<Trash2 />}
          initialFocusRef={cancelRef}
          footer={
            <>
              <Button ref={cancelRef} onClick={() => setConfirmOpen(false)} disabled={removing}>
                {t('common.action.cancel')}
              </Button>
              <Button variant="danger" loading={removing} onClick={() => void confirmRemove()}>
                {t('processing.source.remove.confirm')}
              </Button>
            </>
          }
        />
      ) : null}
    </Card>
  );
}

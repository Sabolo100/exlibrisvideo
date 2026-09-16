'use client';

/**
 * Bottom sheets inside the recorder overlay. The UI-kit Drawer/Dialog sit at z-index 60, below the full-screen
 * camera, so the recorder brings its own sheet with the same behaviour: layer-aware Esc, focus trap + restore,
 * drag down to dismiss, spring motion (reduced-motion aware through the global MotionConfig).
 */
import { Check, Play, Plus, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useEscape, useFocusTrap, useLayer } from '@/components/ui/hooks';
import { IconButton } from '@/components/ui/IconButton';
import { formatBytes } from '@/components/upload/format';
import { useI18n } from '@/i18n/client';
import { formatClock } from './camera';
import type { RecordedClip } from './useCameraSession';

interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  headerAction?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

function CameraSheet({ open, onClose, title, description, headerAction, children, footer }: CameraSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const dragControls = useDragControls();
  const layer = useLayer(open);
  useEscape(open, layer, onClose);
  useFocusTrap(panelRef, open, layer);

  const onDragEnd = (_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 650) onClose();
  };
  const hasBody = children !== undefined && children !== null && children !== false;

  return (
    <AnimatePresence>
      {open ? (
        <div key="sheet" className="absolute inset-0 z-30">
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={onDragEnd}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.5rem] border-t border-line bg-surface text-ink shadow-[0_-16px_48px_rgb(0_0_0/0.5)] outline-none"
          >
            <div
              aria-hidden="true"
              className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1.5 active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <span className="h-1.5 w-10 rounded-full bg-[color-mix(in_oklab,var(--line),var(--ink)_28%)]" />
            </div>
            <div
              className="flex shrink-0 items-start gap-3 px-5 pb-3"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button, a, input, video')) return;
                dragControls.start(e);
              }}
            >
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id={titleId} className="font-display text-xl leading-tight font-semibold text-balance">
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="mt-1.5 text-[0.9375rem] leading-snug text-muted">
                    {description}
                  </p>
                ) : null}
              </div>
              {headerAction}
            </div>
            {hasBody ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div> : null}
            {footer ? (
              <div
                className={cn(
                  'shrink-0 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]',
                  hasBody && 'border-t border-line/70',
                )}
              >
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export interface ClipReviewSheetProps {
  open: boolean;
  clips: RecordedClip[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onDone: () => void;
}

/** List of the recorded clips: duration, size, playback, delete (with an inline confirmation). */
export function ClipReviewSheet({ open, clips, onClose, onDelete, onDone }: ClipReviewSheetProps) {
  const { t, n, locale } = useI18n();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setPlayingId(null);
    setConfirmId(null);
  }, [open]);

  const nameOf = (index: number) => t('camera.review.item', { index: n(index + 1) });
  const playingIndex = clips.findIndex((c) => c.id === playingId);
  const playing = playingIndex >= 0 ? clips[playingIndex] : null;

  return (
    <CameraSheet
      open={open}
      onClose={onClose}
      title={
        <>
          {t('camera.review.title')} <span className="text-muted tabular-nums">({n(clips.length)})</span>
        </>
      }
      headerAction={
        <IconButton aria-label={t('camera.review.close')} icon={<X />} size="sm" onClick={onClose} className="-mt-0.5 -mr-2" />
      }
      footer={
        // side by side on phones, stacked when the labels do not fit (≈ 320 px screens)
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" size="lg" leftIcon={<Plus />} onClick={onClose} className="min-w-fit flex-1">
            {t('camera.review.recordMore')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            leftIcon={<Check />}
            disabled={clips.length === 0}
            onClick={onDone}
            className="min-w-fit flex-1"
          >
            {t('camera.action.done', { count: n(clips.length) })}
          </Button>
        </div>
      }
    >
      {playing ? (
        <video
          key={playing.id}
          src={playing.url}
          controls
          playsInline
          autoPlay
          muted // clips have no sound track; muted lets iOS start playback without another tap
          aria-label={t('camera.review.player', { name: nameOf(playingIndex) })}
          className="mb-2 max-h-[42dvh] w-full rounded-2xl bg-black object-contain"
        />
      ) : null}
      <ul className="divide-y divide-line/70 pb-2">
        {clips.map((clip, index) => {
          const name = nameOf(index);
          const confirming = confirmId === clip.id;
          const isPlaying = playingId === clip.id;
          return (
            <li key={clip.id} className="py-3">
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  aria-label={t('camera.review.play', { name })}
                  aria-pressed={isPlaying}
                  onClick={() => setPlayingId(clip.id)}
                  className={cn(
                    'relative size-16 shrink-0 overflow-hidden rounded-xl bg-black ring-1 transition-shadow',
                    isPlaying ? 'ring-2 ring-accent' : 'ring-line',
                  )}
                >
                  {clip.thumbnail ? (
                    <img src={clip.thumbnail} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
                      <Play className="ml-0.5 size-3.5" fill="currentColor" aria-hidden="true" />
                    </span>
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name}</p>
                  <p className="mt-0.5 text-sm text-muted tabular-nums">
                    {formatClock(clip.durationSec)} · {formatBytes(clip.file.size, locale)}
                  </p>
                </div>
                <IconButton
                  aria-label={t('camera.review.delete', { name })}
                  aria-expanded={confirming}
                  icon={<Trash2 />}
                  variant="danger"
                  onClick={() => setConfirmId(confirming ? null : clip.id)}
                />
              </div>
              {confirming ? (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 py-2 pr-2 pl-3.5">
                  <p className="min-w-0 flex-1 text-sm font-medium">{t('camera.review.deleteQuestion')}</p>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    {t('camera.review.deleteCancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setConfirmId(null);
                      if (playingId === clip.id) setPlayingId(null);
                      onDelete(clip.id);
                    }}
                  >
                    {t('camera.review.deleteConfirm')}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </CameraSheet>
  );
}

export interface DiscardSheetProps {
  open: boolean;
  count: number;
  onDiscard: () => void;
  onCancel: () => void;
}

/** "Discard your clips?" before closing with unsent recordings. */
export function DiscardSheet({ open, count, onDiscard, onCancel }: DiscardSheetProps) {
  const { t, tp } = useI18n();
  return (
    <CameraSheet
      open={open}
      onClose={onCancel}
      title={t('camera.discard.title')}
      description={tp('camera.discard.body', count)}
      footer={
        <div className="flex flex-col gap-2.5">
          <Button variant="danger" size="lg" fullWidth leftIcon={<Trash2 />} onClick={onDiscard}>
            {t('camera.discard.confirm')}
          </Button>
          <Button variant="secondary" size="lg" fullWidth onClick={onCancel} data-autofocus>
            {t('camera.discard.cancel')}
          </Button>
        </div>
      }
    />
  );
}

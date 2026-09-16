'use client';

/**
 * Presentational camera screen (no media logic): live preview, top bar (close · timer · torch / switch),
 * framing guidance, notices, bottom bar (clip tray · shutter · Kész) and the fallback screen.
 * Driven by the state of useCameraSession, so it can be server-rendered in tests with any state.
 */
import { Check, CircleAlert, Info, SwitchCamera, X, Zap, ZapOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useMediaQuery } from '@/components/ui/hooks';
import { Spinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { formatClock, isNearLimit, limitProgress, type Platform } from './camera';
import { CameraButton, ClipTrayButton, ShutterButton, TimerPill } from './CameraControls';
import { CameraFallback } from './CameraFallback';
import { AnotherShelfHint, GuidanceCard, ThirdsGrid } from './CameraGuidance';
import type { CameraSessionState, NoticeKind } from './useCameraSession';

export interface CameraScreenActions {
  attachVideo: (video: HTMLVideoElement | null) => void;
  onVideoReady: () => void;
  onClose: () => void;
  onShutter: () => void;
  onToggleTorch: () => void;
  onSwitchCamera: () => void;
  onOpenReview: () => void;
  onDone: () => void;
  onRetry: () => void;
  onNativeFiles: (files: File[]) => void;
  onUseClips: () => void;
}

export interface CameraScreenProps {
  state: CameraSessionState;
  maxDurationSec: number;
  platform: Platform;
  iosApp: string;
  actions: CameraScreenActions;
  /** a sheet is open above the screen */
  inert?: boolean;
}

const NOTICE_ICON: Record<NoticeKind, typeof Info> = {
  tooShort: Info,
  limit: Info,
  interrupted: Info,
  failed: CircleAlert,
};

function StartingIndicator() {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-10 text-center">
      <Spinner size="lg" decorative className="text-white/80" />
      <p className="text-[0.9375rem] font-medium text-white/85">{t('camera.starting')}</p>
      <p className={cn('max-w-[16rem] text-sm text-white/55 transition-opacity duration-500', slow ? 'opacity-100' : 'opacity-0')}>
        {t('camera.starting.hint')}
      </p>
    </div>
  );
}

export function CameraScreen({ state, maxDurationSec, platform, iosApp, actions, inert = false }: CameraScreenProps) {
  const { t, tp, n } = useI18n();
  const shortLandscape = useMediaQuery('(orientation: landscape) and (max-height: 540px)');
  const live = state.status === 'live';
  const recording = state.phase !== 'idle';
  const clipCount = state.clips.length;
  const lastClip = clipCount > 0 ? state.clips[clipCount - 1] : null;
  const warning = recording && isNearLimit(state.elapsedSec, maxDurationSec);
  const showGuide = live && !recording && clipCount === 0;
  const showAnother = live && !recording && clipCount > 0;
  const failedProblem = state.status === 'failed' ? state.problem : null;
  const covered = failedProblem !== null;
  const doneLabel = t('camera.action.done', { count: n(clipCount) });
  const notice = state.notice;
  const NoticeIcon = notice ? NOTICE_ICON[notice.kind] : Info;

  return (
    <div className="absolute inset-0" inert={inert}>
      {/* live preview */}
      <video
        ref={actions.attachVideo}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        onPlaying={actions.onVideoReady}
        onLoadedData={actions.onVideoReady}
        className={cn(
          'pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300',
          live && state.videoReady ? 'opacity-100' : 'opacity-0',
          state.mirrored && '-scale-x-100',
        )}
      />
      {state.freezeFrame ? (
        <img
          src={state.freezeFrame}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full scale-110 object-cover blur-2xl brightness-75"
        />
      ) : null}
      {live && state.videoReady && !recording ? <ThirdsGrid /> : null}

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/65 via-black/25 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {(state.status === 'starting' || state.status === 'suspended') && !state.freezeFrame ? <StartingIndicator /> : null}

      {/* top bar (unreachable while the fallback screen covers the camera) */}
      <div
        inert={covered}
        className="absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 pt-[max(env(safe-area-inset-top),0.875rem)] pr-[max(env(safe-area-inset-right),1rem)] pl-[max(env(safe-area-inset-left),1rem)]"
      >
        <div className="justify-self-start">
          <CameraButton label={t('camera.action.close')} icon={<X />} onClick={actions.onClose} />
        </div>
        <div className="justify-self-center">
          {recording ? <TimerPill elapsedSec={state.elapsedSec} warning={warning} /> : null}
        </div>
        <div className="flex items-center gap-2.5 justify-self-end">
          {state.torchSupported ? (
            <CameraButton
              label={state.torchOn ? t('camera.action.torchOff') : t('camera.action.torchOn')}
              aria-pressed={state.torchOn}
              active={state.torchOn}
              icon={state.torchOn ? <Zap /> : <ZapOff />}
              onClick={actions.onToggleTorch}
            />
          ) : null}
          {state.canSwitch && !recording ? (
            <CameraButton
              label={t('camera.action.switch')}
              icon={<SwitchCamera />}
              disabled={!live}
              onClick={actions.onSwitchCamera}
            />
          ) : null}
        </div>
      </div>

      {/* notices (persistent live region, animated content) */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-[calc(max(env(safe-area-inset-top),0.875rem)+3.75rem)] z-10 flex justify-center px-4"
      >
        <AnimatePresence>
          {notice ? (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="flex max-w-[22rem] items-start gap-2.5 rounded-2xl bg-black/70 py-2.5 pr-4 pl-3 text-[0.875rem] leading-snug text-white shadow-[0_8px_28px_rgb(0_0_0/0.35)] ring-1 ring-white/10 backdrop-blur-xl"
            >
              <NoticeIcon
                aria-hidden="true"
                className={cn('mt-px size-[1.125rem] shrink-0', notice.kind === 'failed' ? 'text-[#ff8a80]' : 'text-[#f2d48a]')}
              />
              <span>
                {notice.kind === 'limit'
                  ? t('camera.notice.limit', { time: formatClock(maxDurationSec) })
                  : t(`camera.notice.${notice.kind}`)}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* bottom: hints + controls */}
      <div
        inert={covered}
        className="absolute inset-x-0 bottom-0 z-10 pr-[max(env(safe-area-inset-right),1rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] pl-[max(env(safe-area-inset-left),1rem)]"
      >
        {showGuide ? (
          <div className={shortLandscape ? 'mb-4' : 'mb-6'}>
            <GuidanceCard compact={shortLandscape} />
          </div>
        ) : null}
        {showAnother ? (
          <div className={shortLandscape ? 'mb-4' : 'mb-6'}>
            <AnotherShelfHint />
          </div>
        ) : null}
        {/* equal side columns keep the shutter centred whatever sits beside it */}
        <div className="mx-auto grid max-w-md grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="flex min-w-0 justify-self-start">
            <AnimatePresence>
              {lastClip ? (
                <motion.div
                  key="tray"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                >
                  <ClipTrayButton
                    count={clipCount}
                    thumbnail={lastClip.thumbnail}
                    thumbnailKey={lastClip.id}
                    label={tp('camera.tray.open', clipCount)}
                    disabled={recording}
                    onClick={actions.onOpenReview}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <ShutterButton
            recording={recording}
            disabled={!live || state.phase === 'finalizing'}
            progress={limitProgress(state.elapsedSec, maxDurationSec)}
            warning={warning}
            label={recording ? t('camera.action.stop') : t('camera.action.start')}
            onClick={actions.onShutter}
          />
          {/* size container: "Kész (N)" when the column has room, only the count on narrow phones */}
          <div className="@container flex min-w-0 justify-end">
            {/* neutral until there is something to hand over, then it lights up */}
            <Button
              variant={clipCount > 0 ? 'primary' : 'secondary'}
              size="md"
              leftIcon={<Check />}
              aria-label={doneLabel}
              disabled={clipCount === 0 || recording}
              onClick={actions.onDone}
            >
              <span className="@max-[7.5rem]:hidden">{doneLabel}</span>
              <span className="tabular-nums @min-[7.5rem]:hidden">{n(clipCount)}</span>
            </Button>
          </div>
        </div>
      </div>

      {failedProblem ? (
        <CameraFallback
          problem={failedProblem}
          platform={platform}
          iosApp={iosApp}
          clipCount={clipCount}
          onRetry={actions.onRetry}
          onNativeFiles={actions.onNativeFiles}
          onCancel={actions.onClose}
          onUseClips={actions.onUseClips}
        />
      ) : null}
    </div>
  );
}

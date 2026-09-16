'use client';

/**
 * In-app shelf recorder: a full-screen, native-camera-like overlay (getUserMedia + MediaRecorder).
 *
 *   <CameraRecorder open={open} onClose={() => setOpen(false)} onDone={(files) => { setOpen(false); upload(files); }} />
 *
 * - Portal above everything (z-index 100), black, safe-area aware, page scroll locked, Esc closes (desktop),
 *   focus trapped and restored.
 * - Several clips per session (one per shelf); "Kész (N)" hands all of them to `onDone`.
 * - Closing with clips asks first; `onClose` / `onDone` end the session: the overlay hides at once and the camera,
 *   recorder and wake lock are released even before the parent sets `open` to false.
 * - Plain http, missing APIs, denied permission, no / busy camera → CameraFallback with the phone's own camera app
 *   (`<input capture>`), so the flow never dead-ends.
 * Use `isInAppRecordingSupported()` from './camera' to decide up front whether to offer in-app recording.
 */
import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useEscape, useFocusTrap, useLayer, useScrollLock } from '@/components/ui/hooks';
import { Portal } from '@/components/ui/Portal';
import { useI18n } from '@/i18n/client';
import { clockParts, DEFAULT_MAX_DURATION_SEC, detectPlatform, iosSettingsApp, MIN_CLIP_SEC } from './camera';
import { CameraKeyframes } from './CameraGuidance';
import { CameraScreen, type CameraScreenActions } from './CameraScreen';
import { ClipReviewSheet, DiscardSheet } from './CameraSheets';
import { useCameraSession } from './useCameraSession';

export interface CameraRecorderProps {
  open: boolean;
  /** user closed without finishing (also after the fallback was cancelled) */
  onClose: () => void;
  /** one or more recorded clips (or files from the native capture fallback) */
  onDone: (files: File[]) => void;
  /** per clip; default 180 */
  maxDurationSec?: number;
}

export function CameraRecorder({
  open,
  onClose,
  onDone,
  maxDurationSec = DEFAULT_MAX_DURATION_SEC,
}: CameraRecorderProps): React.JSX.Element | null {
  if (!open) return null;
  // guard against 0 / NaN limits (a clip needs at least MIN_CLIP_SEC)
  const limit =
    Number.isFinite(maxDurationSec) && maxDurationSec > 0
      ? Math.max(MIN_CLIP_SEC + 1, maxDurationSec)
      : DEFAULT_MAX_DURATION_SEC;
  return (
    <Portal>
      <RecorderSession onClose={onClose} onDone={onDone} maxDurationSec={limit} />
    </Portal>
  );
}

interface RecorderSessionProps {
  onClose: () => void;
  onDone: (files: File[]) => void;
  maxDurationSec: number;
}

/** One open → close cycle (mounted on the client only, inside the portal). */
function RecorderSession({ onClose, onDone, maxDurationSec }: RecorderSessionProps) {
  const { t, tp } = useI18n();
  const session = useCameraSession({ maxDurationSec });
  const { stopRecording, shutdown, deleteClip } = session;
  const [ended, setEnded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const callbacksRef = useRef({ onClose, onDone });
  useEffect(() => {
    callbacksRef.current = { onClose, onDone };
  }, [onClose, onDone]);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const platform = useMemo(
    () => (typeof navigator === 'undefined' ? 'other' : detectPlatform(navigator.userAgent, navigator.maxTouchPoints)),
    [],
  );
  const iosApp = useMemo(() => (typeof navigator === 'undefined' ? 'Safari' : iosSettingsApp(navigator.userAgent)), []);

  const closeNow = useCallback(() => {
    shutdown();
    setEnded(true);
    callbacksRef.current.onClose();
  }, [shutdown]);

  const finish = useCallback(
    (extra: File[] = []) => {
      const files = [...shutdown(), ...extra];
      setEnded(true);
      if (files.length > 0) callbacksRef.current.onDone(files);
      else callbacksRef.current.onClose();
    },
    [shutdown],
  );

  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // a running recording is kept (stopped first), then we ask before throwing clips away
    void stopRecording('close').then((clips) => {
      closingRef.current = false;
      if (!aliveRef.current) return;
      if (clips.length > 0) setDiscardOpen(true);
      else closeNow();
    });
  }, [closeNow, stopRecording]);

  const active = !ended;
  const layer = useLayer(active);
  useEscape(active, layer, requestClose);
  useFocusTrap(rootRef, active, layer);
  useScrollLock(active);

  // reloading or closing the tab would silently lose clips that were not handed over yet
  const unsaved = active && (session.clips.length > 0 || session.phase !== 'idle');
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  if (ended) return null;

  const actions: CameraScreenActions = {
    attachVideo: session.attachVideo, // stable callback ref
    onVideoReady: session.onVideoReady,
    onClose: requestClose,
    onShutter: session.toggleRecording,
    onToggleTorch: session.toggleTorch,
    onSwitchCamera: session.switchCamera,
    onOpenReview: () => setReviewOpen(true),
    onDone: () => {
      if (session.phase === 'idle' && session.clips.length > 0) finish();
    },
    onRetry: session.retry,
    onNativeFiles: (files) => finish(files),
    onUseClips: () => finish(),
  };

  const announcement = session.announcement;
  let announcementText = '';
  if (announcement?.kind === 'started') {
    announcementText = t('camera.announce.started');
  } else if (announcement) {
    const { minutes, seconds } = clockParts(announcement.durationSec);
    const secondsText = tp('camera.duration.seconds', seconds);
    const duration = minutes > 0 ? `${tp('camera.duration.minutes', minutes)} ${secondsText}` : secondsText;
    announcementText = t('camera.announce.stopped', { duration });
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-theme="dark"
      data-camera-status={session.status}
      data-camera-phase={session.phase}
      tabIndex={-1}
      className="exl-cam-in fixed inset-0 z-[100] touch-manipulation overflow-hidden overscroll-none bg-black text-white outline-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
    >
      <CameraKeyframes />
      <h2 id={titleId} className="sr-only">
        {t('camera.title')}
      </h2>
      <CameraScreen
        state={session}
        maxDurationSec={maxDurationSec}
        platform={platform}
        iosApp={iosApp}
        actions={actions}
        inert={reviewOpen || discardOpen}
      />
      <ClipReviewSheet
        open={reviewOpen}
        clips={session.clips}
        onClose={() => setReviewOpen(false)}
        onDelete={(id) => {
          if (session.clips.length <= 1) setReviewOpen(false);
          deleteClip(id);
        }}
        onDone={() => {
          setReviewOpen(false);
          finish();
        }}
      />
      <DiscardSheet
        open={discardOpen}
        count={session.clips.length}
        onCancel={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          closeNow();
        }}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement ? <span key={announcement.id}>{announcementText}</span> : null}
      </p>
    </div>
  );
}

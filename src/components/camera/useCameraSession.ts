'use client';

/**
 * State machine of one recorder session (mounted while the recorder is open):
 *
 *   camera   starting ─► live ◄─► suspended (page hidden)          failed (problem) ─ retry ─► starting
 *   recorder idle ─► recording ─► finalizing ─► idle (+ clip when ≥ 1 s and non-empty)
 *
 * The camera is released whenever it is not needed: page hidden (a running recording is stopped first and its
 * clip kept), shutdown (done / close) and unmount. Imperative objects live in refs; `stateRef` mirrors the
 * rendered state synchronously so async callbacks never act on stale values.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  baseMimeType,
  browserRecordingEnvironment,
  classifyMediaError,
  extensionForMime,
  isRetryableOnReturn,
  detectPlatform,
  isUsableClip,
  mediaStreamConstraints,
  mimeForContainer,
  nextDeviceId,
  pickRecorderMimeType,
  RECORDER_TIMESLICE_MS,
  recordingFileName,
  recordingSupportProblem,
  sniffContainer,
  VIDEO_BITS_PER_SECOND,
  type CameraFacing,
  type CameraProblem,
  type Platform,
} from './camera';
import {
  captureVideoFrame,
  firstVideoTrack,
  listVideoInputIds,
  readBlobHead,
  requestScreenWakeLock,
  setTorch,
  stopStream,
  tick,
  trackMayHaveTorch,
  trackSupportsTorch,
} from './media';

export type CameraStatus = 'starting' | 'live' | 'suspended' | 'failed' | 'closed';
export type RecorderPhase = 'idle' | 'recording' | 'finalizing';
export type NoticeKind = 'tooShort' | 'limit' | 'interrupted' | 'failed' | 'torchUnavailable';
/** why a recording ended */
export type StopReason = 'user' | 'limit' | 'hidden' | 'interrupted' | 'failed' | 'close' | 'done';

export interface RecordedClip {
  id: string;
  file: File;
  /** object URL of `file` for playback (revoked on delete / unmount) */
  url: string;
  /** small JPEG data URL grabbed from the preview */
  thumbnail: string | null;
  durationSec: number;
}

export interface CameraSessionState {
  status: CameraStatus;
  problem: CameraProblem | null;
  /** front camera preview is mirrored like a native camera app */
  mirrored: boolean;
  /** the preview shows frames (fade-in) */
  videoReady: boolean;
  /** blurred last frame shown while the camera changes */
  freezeFrame: string | null;
  canSwitch: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  phase: RecorderPhase;
  elapsedSec: number;
  clips: RecordedClip[];
  notice: { id: number; kind: NoticeKind } | null;
  /** screen-reader read-out, only on start / stop */
  announcement: { id: number; kind: 'started' | 'stopped'; durationSec: number } | null;
}

export interface CameraSession extends CameraSessionState {
  /** callback ref for the preview <video> */
  attachVideo: (video: HTMLVideoElement | null) => void;
  /** call from the video's playing / loadeddata events */
  onVideoReady: () => void;
  startRecording: () => void;
  /** stops a running recording; resolves with the clips once it is finalized (immediately when idle) */
  stopRecording: (reason?: StopReason) => Promise<RecordedClip[]>;
  /** shutter: start when idle, stop when recording (reads the live state, safe for rapid taps) */
  toggleRecording: () => void;
  toggleTorch: () => void;
  switchCamera: () => void;
  retry: () => void;
  deleteClip: (id: string) => void;
  /** releases camera, recorder and wake lock for good and returns the recorded files */
  shutdown: () => File[];
}

interface ActiveRecording {
  recorder: MediaRecorder;
  chunks: Blob[];
  requestedMime: string;
  startedAtMs: number;
  t0: number;
  stoppedAt: number | null;
  reason: StopReason | null;
  thumbnail: string | null;
  finalized: boolean;
  safetyTimer: number | null;
  done: Promise<RecordedClip[]>;
  resolve: (clips: RecordedClip[]) => void;
}

interface AcquireRequest {
  facing: CameraFacing;
  deviceId?: string;
}

const INITIAL_STATE: CameraSessionState = {
  status: 'starting',
  problem: null,
  mirrored: false,
  videoReady: false,
  freezeFrame: null,
  canSwitch: false,
  torchSupported: false,
  torchOn: false,
  phase: 'idle',
  elapsedSec: 0,
  clips: [],
  notice: null,
  announcement: null,
};

const TIMER_INTERVAL_MS = 200;
const NOTICE_MS = 4500;
/** MediaRecorder must fire "stop" within this time, otherwise we finalize with the chunks we have */
const STOP_SAFETY_MS = 3000;
/** a second unexpected camera loss within this window shows the error screen instead of restarting */
const AUTO_RESTART_WINDOW_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** the torch capability is looked at again this long after the camera started (some phones report it late) */
const TORCH_RECHECK_MS = [600, 2000];

function currentPlatform(): Platform {
  return typeof navigator === 'undefined' ? 'other' : detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export function useCameraSession({ maxDurationSec }: { maxDurationSec: number }): CameraSession {
  const [state, setState] = useState<CameraSessionState>(INITIAL_STATE);
  const stateRef = useRef<CameraSessionState>(INITIAL_STATE);
  const update = useCallback((patch: Partial<CameraSessionState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);

  const mountedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** bumped whenever the current stream becomes obsolete; async work compares its own generation */
  const genRef = useRef(0);
  const facingRef = useRef<CameraFacing>('environment');
  const deviceIdRef = useRef<string | null>(null);
  const videoInputIdsRef = useRef<string[]>([]);
  const recRef = useRef<ActiveRecording | null>(null);
  const seqRef = useRef(0);
  const lastAutoRestartRef = useRef(0);
  const maxDurationRef = useRef(maxDurationSec);
  useEffect(() => {
    maxDurationRef.current = maxDurationSec;
  }, [maxDurationSec]);

  const nextId = () => {
    seqRef.current += 1;
    return seqRef.current;
  };

  const showNotice = useCallback((kind: NoticeKind) => update({ notice: { id: nextId(), kind } }), [update]);

  /* ---------------------------------------------------------------- camera */

  const releaseStream = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    const ids = await listVideoInputIds();
    if (!mountedRef.current) return;
    videoInputIdsRef.current = ids;
    if (stateRef.current.canSwitch !== ids.length > 1) update({ canSwitch: ids.length > 1 });
  }, [update]);

  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, []);

  // `acquire` and `handleTrackEnded` call each other – late-bound through a ref
  const handleTrackEndedRef = useRef<(gen: number) => void>(() => undefined);

  const acquire = useCallback(
    async (request: AcquireRequest): Promise<boolean> => {
      genRef.current += 1;
      const gen = genRef.current;
      releaseStream();
      facingRef.current = request.facing;
      update({ status: 'starting', problem: null, videoReady: false, torchOn: false, torchSupported: false });

      const unsupported = recordingSupportProblem(browserRecordingEnvironment());
      if (unsupported) {
        update({ status: 'failed', problem: unsupported, freezeFrame: null });
        return false;
      }

      let stream: MediaStream | null = null;
      let problem: CameraProblem = 'unknown';
      try {
        stream = await navigator.mediaDevices.getUserMedia(mediaStreamConstraints(request.facing, request.deviceId));
      } catch (err) {
        problem = classifyMediaError(err);
      }
      if (!stream && problem === 'not_found' && gen === genRef.current && mountedRef.current) {
        // nothing matched the preferred settings – take whatever camera there is
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (err) {
          problem = classifyMediaError(err);
        }
      }
      if (gen !== genRef.current || !mountedRef.current) {
        stopStream(stream); // superseded (closed, hidden, retried) while the browser was asking
        return false;
      }
      if (!stream) {
        update({ status: 'failed', problem, freezeFrame: null });
        return false;
      }

      streamRef.current = stream;
      const track = firstVideoTrack(stream);
      const settings = track?.getSettings?.() ?? {};
      deviceIdRef.current = settings.deviceId ?? null;
      track?.addEventListener('ended', () => handleTrackEndedRef.current(gen), { once: true });
      const video = videoRef.current;
      if (video) {
        video.muted = true;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      }
      update({
        status: 'live',
        problem: null,
        mirrored: settings.facingMode === 'user' || (!settings.facingMode && request.facing === 'user' && !request.deviceId),
        torchSupported: trackMayHaveTorch(track, currentPlatform(), request.facing),
        torchOn: false,
      });
      void refreshDevices();
      for (const delay of TORCH_RECHECK_MS) {
        window.setTimeout(() => {
          if (gen !== genRef.current || !mountedRef.current || stateRef.current.status !== 'live') return;
          const may = trackMayHaveTorch(firstVideoTrack(streamRef.current), currentPlatform(), facingRef.current);
          if (may !== stateRef.current.torchSupported) update({ torchSupported: may });
        }, delay);
      }
      return true;
    },
    [refreshDevices, releaseStream, update],
  );

  const onVideoReady = useCallback(() => {
    if (stateRef.current.status !== 'live') return;
    // some Android builds report the torch only once frames flow
    const torchSupported = trackMayHaveTorch(firstVideoTrack(streamRef.current), currentPlatform(), facingRef.current);
    const s = stateRef.current;
    if (!s.videoReady || s.freezeFrame || s.torchSupported !== torchSupported) {
      update({ videoReady: true, freezeFrame: null, torchSupported });
    }
  }, [update]);

  /** releases the camera while the page is hidden (no-op unless it is running or starting) */
  const suspend = useCallback(() => {
    const status = stateRef.current.status;
    if (status !== 'live' && status !== 'starting') return;
    genRef.current += 1;
    releaseStream();
    update({ status: 'suspended', videoReady: false, torchOn: false });
  }, [releaseStream, update]);

  /* -------------------------------------------------------------- recorder */

  const finalize = useCallback(
    async (rec: ActiveRecording) => {
      if (rec.finalized) return;
      rec.finalized = true;
      if (rec.safetyTimer !== null) window.clearTimeout(rec.safetyTimer);
      const reason = rec.reason ?? 'interrupted';
      const durationSec = ((rec.stoppedAt ?? performance.now()) - rec.t0) / 1000;
      const recordedType = rec.recorder.mimeType || rec.requestedMime;
      const blob = new Blob(rec.chunks, { type: baseMimeType(recordedType) });

      let clip: RecordedClip | null = null;
      if (isUsableClip(durationSec, blob.size)) {
        // label the file by its real container (the server sniffs magic bytes too)
        const container = sniffContainer(await readBlobHead(blob)) ?? extensionForMime(recordedType);
        const type = mimeForContainer(container);
        const file = new File([blob], recordingFileName(new Date(rec.startedAtMs), type), {
          type,
          lastModified: rec.startedAtMs,
        });
        clip = { id: `clip-${nextId()}`, file, url: URL.createObjectURL(file), thumbnail: rec.thumbnail, durationSec };
      }
      if (recRef.current === rec) recRef.current = null;
      if (!mountedRef.current || stateRef.current.status === 'closed') {
        if (clip) URL.revokeObjectURL(clip.url);
        rec.resolve(stateRef.current.clips);
        return;
      }

      const clips = clip ? [...stateRef.current.clips, clip] : stateRef.current.clips;
      let notice: NoticeKind | null = null;
      if (reason === 'failed') notice = clip ? 'interrupted' : 'failed';
      else if (!clip && (reason === 'user' || reason === 'limit')) notice = 'tooShort';
      else if (clip && reason === 'limit') notice = 'limit';
      else if (clip && (reason === 'hidden' || reason === 'interrupted')) notice = 'interrupted';

      update({
        clips,
        phase: 'idle',
        elapsedSec: 0,
        announcement: { id: nextId(), kind: 'stopped', durationSec },
        ...(notice ? { notice: { id: nextId(), kind: notice } } : {}),
      });
      rec.resolve(clips);
    },
    [update],
  );

  const requestStop = useCallback(
    (rec: ActiveRecording, reason: StopReason): Promise<RecordedClip[]> => {
      if (rec.reason !== null || rec.finalized) return rec.done;
      rec.reason = reason;
      rec.stoppedAt = performance.now();
      rec.thumbnail = captureVideoFrame(videoRef.current) ?? rec.thumbnail;
      if (reason === 'user' || reason === 'limit') tick();
      update({ phase: 'finalizing', elapsedSec: (rec.stoppedAt - rec.t0) / 1000 });
      rec.safetyTimer = window.setTimeout(() => void finalize(rec), STOP_SAFETY_MS);
      try {
        if (rec.recorder.state !== 'inactive') rec.recorder.stop();
        else void finalize(rec);
      } catch {
        void finalize(rec);
      }
      return rec.done;
    },
    [finalize, update],
  );

  const stopRecording = useCallback(
    (reason: StopReason = 'user'): Promise<RecordedClip[]> => {
      const rec = recRef.current;
      return rec ? requestStop(rec, reason) : Promise.resolve(stateRef.current.clips);
    },
    [requestStop],
  );

  const startRecording = useCallback(() => {
    const s = stateRef.current;
    const stream = streamRef.current;
    if (s.status !== 'live' || s.phase !== 'idle' || !stream || recRef.current) return;

    const isTypeSupported = (type: string) =>
      typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type);
    const requestedMime = pickRecorderMimeType(isTypeSupported);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(requestedMime ? { mimeType: requestedMime } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        showNotice('failed');
        return;
      }
    }

    let resolve: (clips: RecordedClip[]) => void = () => undefined;
    const done = new Promise<RecordedClip[]>((r) => {
      resolve = r;
    });
    const rec: ActiveRecording = {
      recorder,
      chunks: [],
      requestedMime,
      startedAtMs: Date.now(),
      t0: performance.now(),
      stoppedAt: null,
      reason: null,
      thumbnail: null,
      finalized: false,
      safetyTimer: null,
      done,
      resolve,
    };
    recorder.addEventListener('dataavailable', (e: BlobEvent) => {
      if (e.data && e.data.size > 0) rec.chunks.push(e.data);
    });
    recorder.addEventListener('stop', () => void finalize(rec));
    recorder.addEventListener('error', () => void requestStop(rec, 'failed'));
    try {
      recorder.start(RECORDER_TIMESLICE_MS);
    } catch {
      showNotice('failed');
      return;
    }
    recRef.current = rec;
    tick();
    update({
      phase: 'recording',
      elapsedSec: 0,
      notice: null,
      announcement: { id: nextId(), kind: 'started', durationSec: 0 },
    });
  }, [finalize, requestStop, showNotice, update]);

  const toggleRecording = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase === 'recording') void stopRecording('user');
    else if (phase === 'idle') startRecording();
  }, [startRecording, stopRecording]);

  // clock, thumbnail and the per-clip limit
  useEffect(() => {
    if (state.phase !== 'recording') return;
    const timer = window.setInterval(() => {
      const rec = recRef.current;
      if (!rec || rec.reason !== null) return;
      const elapsed = (performance.now() - rec.t0) / 1000;
      if (!rec.thumbnail && elapsed >= 1) rec.thumbnail = captureVideoFrame(videoRef.current);
      if (elapsed >= maxDurationRef.current) {
        void requestStop(rec, 'limit');
        return;
      }
      update({ elapsedSec: elapsed });
    }, TIMER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state.phase, requestStop, update]);

  useEffect(() => {
    handleTrackEndedRef.current = (gen: number) => {
      if (gen !== genRef.current || !mountedRef.current) return;
      // the camera went away (unplugged, permission revoked, taken over by another app); MediaRecorder stops by itself
      void stopRecording('interrupted').then(() => {
        if (gen !== genRef.current || !mountedRef.current) return;
        if (document.visibilityState === 'hidden') {
          suspend();
          return;
        }
        const now = Date.now();
        if (now - lastAutoRestartRef.current < AUTO_RESTART_WINDOW_MS) {
          genRef.current += 1;
          releaseStream();
          update({ status: 'failed', problem: 'in_use', videoReady: false, torchOn: false });
          return;
        }
        lastAutoRestartRef.current = now;
        void acquire({ facing: facingRef.current });
      });
    };
  }, [acquire, releaseStream, stopRecording, suspend, update]);

  /* --------------------------------------------------------------- actions */

  const toggleTorch = useCallback(() => {
    const s = stateRef.current;
    if (!s.torchSupported || s.status !== 'live') return;
    const next = !s.torchOn;
    const gen = genRef.current;
    update({ torchOn: next });
    const track = firstVideoTrack(streamRef.current);
    void setTorch(track, next).then((ok) => {
      if (ok || gen !== genRef.current || !mountedRef.current) return;
      if (next && !trackSupportsTorch(track)) {
        // the camera does not have a torch after all: say so and stop offering it
        update({ torchOn: false, torchSupported: false, notice: { id: nextId(), kind: 'torchUnavailable' } });
      } else {
        update({ torchOn: !next });
      }
    });
  }, [update]);

  const switchCamera = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'live' || s.phase !== 'idle' || !s.canSwitch) return;
    const previousId = deviceIdRef.current;
    const facing: CameraFacing = facingRef.current === 'environment' ? 'user' : 'environment';
    facingRef.current = facing;
    genRef.current += 1;
    const gen = genRef.current;
    // keep the last frame (blurred) on screen while the other camera starts
    update({
      freezeFrame: captureVideoFrame(videoRef.current, 480),
      status: 'starting',
      videoReady: false,
      torchOn: false,
      torchSupported: false,
    });
    releaseStream();
    void (async () => {
      await sleep(80); // phones need a moment before the other camera can be opened
      if (gen !== genRef.current || !mountedRef.current) return; // hidden or closed meanwhile
      const ok = await acquire({ facing });
      if (ok && previousId && deviceIdRef.current === previousId) {
        // facingMode could not tell the cameras apart (e.g. two webcams): pick the next device explicitly
        const next = nextDeviceId(videoInputIdsRef.current, previousId);
        if (next) await acquire({ facing, deviceId: next });
      }
    })();
  }, [acquire, releaseStream, update]);

  const retry = useCallback(() => {
    void acquire({ facing: 'environment' });
  }, [acquire]);

  const deleteClip = useCallback(
    (id: string) => {
      const clip = stateRef.current.clips.find((c) => c.id === id);
      if (!clip) return;
      URL.revokeObjectURL(clip.url);
      update({ clips: stateRef.current.clips.filter((c) => c.id !== id) });
    },
    [update],
  );

  const shutdown = useCallback((): File[] => {
    genRef.current += 1;
    const rec = recRef.current;
    if (rec) {
      // an unfinished recording is discarded
      rec.finalized = true;
      if (rec.safetyTimer !== null) window.clearTimeout(rec.safetyTimer);
      recRef.current = null;
      try {
        if (rec.recorder.state !== 'inactive') rec.recorder.stop();
      } catch {
        // already stopped
      }
      rec.resolve(stateRef.current.clips);
    }
    releaseStream();
    update({ status: 'closed', phase: 'idle', videoReady: false, torchOn: false });
    return stateRef.current.clips.map((c) => c.file);
  }, [releaseStream, update]);

  /* ------------------------------------------------------------- lifecycle */

  useEffect(() => {
    mountedRef.current = true;
    void acquire({ facing: 'environment' });
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      const rec = recRef.current;
      if (rec) {
        rec.finalized = true;
        if (rec.safetyTimer !== null) window.clearTimeout(rec.safetyTimer);
        recRef.current = null;
        try {
          if (rec.recorder.state !== 'inactive') rec.recorder.stop();
        } catch {
          // already stopped
        }
      }
      releaseStream();
    };
  }, [acquire, releaseStream]);

  // object URLs of the clips die with the session (the File objects stay valid for the caller)
  useEffect(
    () => () => {
      for (const clip of stateRef.current.clips) URL.revokeObjectURL(clip.url);
    },
    [],
  );

  // release the camera while the page is hidden; come back when visible again
  useEffect(() => {
    let token = 0;
    const onVisibility = () => {
      token += 1;
      const mine = token;
      if (document.visibilityState === 'hidden') {
        void stopRecording('hidden').then(() => {
          if (mine === token && document.visibilityState === 'hidden') suspend();
        });
        return;
      }
      const { status, problem } = stateRef.current;
      if (status === 'suspended' || (status === 'failed' && isRetryableOnReturn(problem))) {
        void acquire({ facing: facingRef.current });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [acquire, stopRecording, suspend]);

  // camera plugged in / removed → show or hide the switch button
  useEffect(() => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media || typeof media.addEventListener !== 'function') return;
    const onChange = () => void refreshDevices();
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  // keep the screen awake while the camera is open
  const closed = state.status === 'closed';
  useEffect(() => {
    if (closed) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const lock = async () => {
      if (sentinel && !sentinel.released) return;
      const next = await requestScreenWakeLock();
      if (disposed) void next?.release().catch(() => undefined);
      else sentinel = next;
    };
    void lock();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void lock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [closed]);

  // notices fade away by themselves
  useEffect(() => {
    if (!state.notice) return;
    const timer = window.setTimeout(() => update({ notice: null }), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [state.notice, update]);

  return {
    ...state,
    attachVideo,
    onVideoReady,
    startRecording,
    stopRecording,
    toggleRecording,
    toggleTorch,
    switchCamera,
    retry,
    deleteClip,
    shutdown,
  };
}

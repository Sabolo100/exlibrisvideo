'use client';

/**
 * Small imperative browser helpers of the recorder (camera tracks, frames, haptics, wake lock).
 * Every function tolerates missing APIs – they are feature-detected, never assumed.
 */
import { isTorchSupported, type CameraFacing, type Platform } from './camera';

/** MediaTrackConstraintSet with the Image Capture `torch` member (not in lib.dom yet). */
interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  }
}

export function firstVideoTrack(stream: MediaStream | null | undefined): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null;
}

export function trackSupportsTorch(track: MediaStreamTrack | null): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  try {
    return isTorchSupported(track.getCapabilities());
  } catch {
    return false;
  }
}

/**
 * Whether to offer the torch button: the camera says it has a torch, or – on Android, back camera – it may
 * still have one (Chrome on some phones lists the torch late or not at all; `setTorch` then tells).
 */
export function trackMayHaveTorch(track: MediaStreamTrack | null, platform: Platform, facing: CameraFacing): boolean {
  if (trackSupportsTorch(track)) return true;
  return platform === 'android' && facing === 'environment' && !!track && typeof track.applyConstraints === 'function';
}

/** Switches the torch; resolves false when the camera refused it or silently ignored it. */
export async function setTorch(track: MediaStreamTrack | null, on: boolean): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== 'function') return false;
  const torch: TorchConstraintSet = { torch: on };
  try {
    await track.applyConstraints({ advanced: [torch] });
  } catch {
    return false;
  }
  // an advanced constraint the camera cannot meet is skipped without an error: check what really happened
  const settings = (typeof track.getSettings === 'function' ? track.getSettings() : {}) as MediaTrackSettings & { torch?: unknown };
  if (typeof settings.torch === 'boolean') return settings.torch === on;
  return !on || trackSupportsTorch(track);
}

/** Ids of the video inputs ('' ids before permission is granted are kept – only the count matters then). */
export async function listVideoInputIds(): Promise<string[]> {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return (devices ?? []).filter((d) => d.kind === 'videoinput').map((d) => d.deviceId);
  } catch {
    return [];
  }
}

/** Current frame of a playing <video> as a small JPEG data URL (null when nothing is decoded yet). */
export function captureVideoFrame(video: HTMLVideoElement | null, maxEdge = 240): string | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

/** Short haptic tick where supported (Android; iOS Safari has no Vibration API). */
export function tick(ms = 15): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // blocked (no user activation) – purely cosmetic
  }
}

/** Keeps the screen awake; resolves null when the Wake Lock API is missing or refused. */
export async function requestScreenWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return null;
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}

/** First bytes of a blob (container sniffing). */
export async function readBlobHead(blob: Blob, bytes = 12): Promise<Uint8Array> {
  try {
    return new Uint8Array(await blob.slice(0, bytes).arrayBuffer());
  } catch {
    return new Uint8Array(0);
  }
}

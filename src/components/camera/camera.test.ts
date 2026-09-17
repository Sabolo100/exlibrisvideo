import { describe, expect, it } from 'vitest';
import {
  baseMimeType,
  canRetry,
  classifyMediaError,
  clockParts,
  detectPlatform,
  extensionForMime,
  formatClock,
  iosSettingsApp,
  isInAppRecordingSupported,
  isNearLimit,
  isRetryableOnReturn,
  isTorchSupported,
  isUsableClip,
  limitProgress,
  mediaStreamConstraints,
  mimeForContainer,
  nextDeviceId,
  pickRecorderMimeType,
  RECORDER_MIME_CANDIDATES,
  recordingFileName,
  recordingSupportProblem,
  sniffContainer,
  videoConstraints,
} from './camera';
import { setTorch, trackMayHaveTorch } from './media';

describe('pickRecorderMimeType', () => {
  it('prefers H.264 MP4 (iOS Safari, recent Chrome)', () => {
    expect(pickRecorderMimeType(() => true)).toBe('video/mp4;codecs=avc1.640028');
    expect(pickRecorderMimeType((t) => t === 'video/mp4')).toBe('video/mp4');
  });

  it('falls back to WebM in candidate order', () => {
    const chrome = new Set(['video/webm', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9']);
    expect(pickRecorderMimeType((t) => chrome.has(t))).toBe('video/webm;codecs=vp9');
    expect(pickRecorderMimeType((t) => t === 'video/webm')).toBe('video/webm');
  });

  it('asks in the documented order and returns "" when nothing is supported', () => {
    const asked: string[] = [];
    expect(
      pickRecorderMimeType((t) => {
        asked.push(t);
        return false;
      }),
    ).toBe('');
    expect(asked).toEqual([...RECORDER_MIME_CANDIDATES]);
  });

  it('treats a throwing isTypeSupported as unsupported', () => {
    expect(
      pickRecorderMimeType((t) => {
        if (t.includes('avc1')) throw new Error('bad codec string');
        return t === 'video/mp4';
      }),
    ).toBe('video/mp4');
  });
});

describe('MIME and extension helpers', () => {
  it('maps recorder types to mp4 / webm', () => {
    expect(extensionForMime('video/mp4;codecs=avc1.640028')).toBe('mp4');
    expect(extensionForMime('Video/MP4')).toBe('mp4');
    expect(extensionForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionForMime('video/x-matroska;codecs=avc1')).toBe('webm');
    expect(extensionForMime('')).toBe('webm');
  });

  it('strips parameters from MIME types', () => {
    expect(baseMimeType('video/webm; codecs="vp8, opus"')).toBe('video/webm');
    expect(mimeForContainer('mp4')).toBe('video/mp4');
    expect(mimeForContainer('webm')).toBe('video/webm');
  });

  it('sniffs the container from the first bytes', () => {
    const mp4 = [0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
    const webm = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81];
    expect(sniffContainer(Uint8Array.from(mp4))).toBe('mp4');
    expect(sniffContainer(webm)).toBe('webm');
    expect(sniffContainer([0x1a, 0x45])).toBeNull();
    expect(sniffContainer(new Uint8Array(12))).toBeNull();
  });
});

describe('recordingFileName', () => {
  it('uses local date and time with zero padding', () => {
    const date = new Date(2026, 8, 6, 7, 5, 9); // 6 Sep 2026 07:05:09 local
    expect(recordingFileName(date, 'video/mp4;codecs=avc1')).toBe('polc-20260906-070509.mp4');
    expect(recordingFileName(date, 'video/webm;codecs=vp9')).toBe('polc-20260906-070509.webm');
  });

  it('handles the end of the year', () => {
    expect(recordingFileName(new Date(2026, 11, 31, 23, 59, 58), 'video/webm')).toBe('polc-20261231-235958.webm');
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(7.9)).toBe('00:07');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(180)).toBe('03:00');
    expect(formatClock(599.99)).toBe('09:59');
  });

  it('adds hours past 60 minutes and guards invalid input', () => {
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-3)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('00:00');
  });

  it('splits minutes and seconds for read-outs', () => {
    expect(clockParts(65.4)).toEqual({ minutes: 1, seconds: 5 });
    expect(clockParts(42)).toEqual({ minutes: 0, seconds: 42 });
    expect(clockParts(-1)).toEqual({ minutes: 0, seconds: 0 });
  });
});

describe('limit helpers', () => {
  it('turns amber in the last 15 seconds', () => {
    expect(isNearLimit(164.9, 180)).toBe(false);
    expect(isNearLimit(165, 180)).toBe(true);
    expect(isNearLimit(179, 180)).toBe(true);
  });

  it('clamps the progress share', () => {
    expect(limitProgress(45, 180)).toBe(0.25);
    expect(limitProgress(200, 180)).toBe(1);
    expect(limitProgress(-1, 180)).toBe(0);
    expect(limitProgress(10, 0)).toBe(0);
  });

  it('drops empty and sub-second recordings', () => {
    expect(isUsableClip(0.6, 120_000)).toBe(false);
    expect(isUsableClip(3, 0)).toBe(false);
    expect(isUsableClip(1, 1)).toBe(true);
    expect(isUsableClip(Number.NaN, 10)).toBe(false);
  });
});

describe('videoConstraints', () => {
  it('asks for the rear camera in Full HD at 30 fps without audio', () => {
    expect(videoConstraints('environment')).toEqual({
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
    expect(mediaStreamConstraints('user')).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    });
  });

  it('pins an exact device instead of a facing mode when given', () => {
    const c = videoConstraints('environment', 'cam-2');
    expect(c.deviceId).toEqual({ exact: 'cam-2' });
    expect(c.facingMode).toBeUndefined();
  });
});

describe('classifyMediaError', () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it('recognises denied permissions', () => {
    expect(classifyMediaError(new DOMException('Permission denied', 'NotAllowedError'))).toBe('denied');
    expect(classifyMediaError(named('PermissionDeniedError'))).toBe('denied');
  });

  it('recognises missing or unsuitable cameras', () => {
    expect(classifyMediaError(new DOMException('Requested device not found', 'NotFoundError'))).toBe('not_found');
    expect(classifyMediaError(named('DevicesNotFoundError'))).toBe('not_found');
    expect(classifyMediaError({ name: 'OverconstrainedError', constraint: 'width' })).toBe('not_found');
    expect(classifyMediaError(named('ConstraintNotSatisfiedError'))).toBe('not_found');
  });

  it('recognises a camera held by another app', () => {
    expect(classifyMediaError(new DOMException('Could not start video source', 'NotReadableError'))).toBe('in_use');
    expect(classifyMediaError(named('TrackStartError'))).toBe('in_use');
    expect(classifyMediaError(new DOMException('Starting videoinput failed', 'AbortError'))).toBe('in_use');
  });

  it('recognises insecure and unsupported environments', () => {
    expect(classifyMediaError(new DOMException('The operation is insecure.', 'SecurityError'))).toBe('insecure');
    expect(classifyMediaError(new TypeError("Cannot read properties of undefined (reading 'getUserMedia')"))).toBe('unsupported');
    expect(classifyMediaError(new DOMException('mimeType not supported', 'NotSupportedError'))).toBe('unsupported');
  });

  it('falls back to unknown', () => {
    expect(classifyMediaError(new Error('boom'))).toBe('unknown');
    expect(classifyMediaError(null)).toBe('unknown');
    expect(classifyMediaError('NotAllowedError')).toBe('unknown');
    expect(classifyMediaError({ name: 42 })).toBe('unknown');
  });

  it('tells which problems can be retried', () => {
    expect(canRetry('denied')).toBe(true);
    expect(canRetry('unknown')).toBe(true);
    expect(canRetry('insecure')).toBe(false);
    expect(canRetry('unsupported')).toBe(false);
    expect(isRetryableOnReturn('denied')).toBe(true);
    expect(isRetryableOnReturn('in_use')).toBe(true);
    expect(isRetryableOnReturn('not_found')).toBe(false);
    expect(isRetryableOnReturn(null)).toBe(false);
  });
});

describe('recordingSupportProblem', () => {
  const recorder = function MediaRecorder() {};
  const gum = () => Promise.resolve();

  it('accepts a secure context with getUserMedia and MediaRecorder', () => {
    expect(recordingSupportProblem({ isSecureContext: true, getUserMedia: gum, MediaRecorder: recorder })).toBeNull();
  });

  it('reports plain http as insecure even though the APIs are missing there', () => {
    expect(recordingSupportProblem({ isSecureContext: false })).toBe('insecure');
    expect(recordingSupportProblem({ isSecureContext: false, getUserMedia: gum, MediaRecorder: recorder })).toBe('insecure');
  });

  it('reports missing APIs as unsupported', () => {
    expect(recordingSupportProblem({ isSecureContext: true, MediaRecorder: recorder })).toBe('unsupported');
    expect(recordingSupportProblem({ isSecureContext: true, getUserMedia: gum })).toBe('unsupported');
    expect(recordingSupportProblem({})).toBe('unsupported');
  });

  it('is false on the server', () => {
    expect(isInAppRecordingSupported()).toBe(false);
  });
});

describe('device helpers', () => {
  it('reads torch capabilities', () => {
    expect(isTorchSupported({ torch: true })).toBe(true);
    expect(isTorchSupported({ torch: [true, false] })).toBe(true);
    expect(isTorchSupported({ torch: false })).toBe(false);
    expect(isTorchSupported({ width: { max: 1920 } })).toBe(false);
    expect(isTorchSupported(undefined)).toBe(false);
  });

  it('cycles through camera device ids', () => {
    expect(nextDeviceId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextDeviceId(['a', 'b', 'c'], 'c')).toBe('a');
    expect(nextDeviceId(['a', 'b'], 'unknown')).toBe('a');
    expect(nextDeviceId(['a'], 'a')).toBeNull();
    expect(nextDeviceId(['', 'b'], 'b')).toBeNull();
  });

  it('detects the phone platform', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
    expect(detectPlatform(iphone, 5)).toBe('ios');
    expect(detectPlatform(ipad, 5)).toBe('ios');
    expect(detectPlatform(ipad, 0)).toBe('other');
    expect(detectPlatform(android, 5)).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
  });

  it('names the iOS browser that holds the camera permission', () => {
    expect(iosSettingsApp('Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari');
    expect(iosSettingsApp('Mozilla/5.0 (iPhone) CriOS/140.0 Mobile/15E148 Safari/604.1')).toBe('Chrome');
    expect(iosSettingsApp('Mozilla/5.0 (iPhone) FxiOS/140.0 Mobile/15E148 Safari/605.1.15')).toBe('Firefox');
  });
});

describe('torch', () => {
  const fakeTrack = (over: Record<string, unknown> = {}) =>
    ({ applyConstraints: async () => {}, getCapabilities: () => ({}), getSettings: () => ({}), ...over }) as unknown as MediaStreamTrack;

  it('is offered when the camera lists it, or for an Android back camera that may have one', () => {
    expect(trackMayHaveTorch(fakeTrack({ getCapabilities: () => ({ torch: true }) }), 'ios', 'environment')).toBe(true);
    expect(trackMayHaveTorch(fakeTrack(), 'android', 'environment')).toBe(true);
    expect(trackMayHaveTorch(fakeTrack(), 'android', 'user')).toBe(false);
    expect(trackMayHaveTorch(fakeTrack(), 'ios', 'environment')).toBe(false);
    expect(trackMayHaveTorch(null, 'android', 'environment')).toBe(false);
  });

  it('checks that the torch really changed', async () => {
    let torch = false;
    const working = fakeTrack({
      getCapabilities: () => ({ torch: true }),
      applyConstraints: async (c: { advanced: { torch: boolean }[] }) => {
        torch = c.advanced[0].torch;
      },
      getSettings: () => ({ torch }),
    });
    expect(await setTorch(working, true)).toBe(true);
    expect(torch).toBe(true);
    expect(await setTorch(working, false)).toBe(true);
    // no torch anywhere: the advanced constraint is skipped without an error
    const withoutTorch = fakeTrack();
    expect(await setTorch(withoutTorch, true)).toBe(false);
    expect(await setTorch(withoutTorch, false)).toBe(true);
    const refusing = fakeTrack({
      applyConstraints: async () => {
        throw new Error('OverconstrainedError');
      },
    });
    expect(await setTorch(refusing, true)).toBe(false);
    expect(await setTorch(null, true)).toBe(false);
  });
});

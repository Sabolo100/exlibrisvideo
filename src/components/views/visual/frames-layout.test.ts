import { describe, expect, it } from 'vitest';
import type { FrameDTO, VideoDTO } from '@/lib/types';
import {
  fitFrame,
  formatDuration,
  formatTimestamp,
  groupFramesByVideo,
  indexDetections,
  labelOrientation,
  scaleBBox,
  stepFrame,
} from './frames-layout';

const video = (id: string, sortOrder: number, createdAt = '2026-09-01T10:00:00Z'): VideoDTO => ({
  id,
  kind: 'video',
  sortOrder,
  originalFilename: `${id}.mp4`,
  sizeBytes: 1000,
  uploadStatus: 'uploaded',
  status: 'done',
  stage: 'done',
  progress: 100,
  durationSec: 9.4,
  framesTotal: 3,
  framesAnalyzed: 3,
  booksFound: 5,
  error: null,
  createdAt,
  processedAt: null,
});

const frame = (id: string, videoId: string, idx: number): FrameDTO => ({
  id,
  videoId,
  idx,
  timeSec: idx * 0.33,
  width: 1080,
  height: 1920,
  image: `/api/media/x/${id}.jpg`,
  thumb: null,
});

describe('groupFramesByVideo', () => {
  it('orders groups by collection.videos (sortOrder, createdAt) and frames by idx', () => {
    const videos = [video('b', 1), video('a', 0), video('c', 1, '2026-08-01T00:00:00Z')];
    const frames = [frame('f3', 'a', 2), frame('f1', 'a', 0), frame('g1', 'b', 0), frame('h1', 'c', 0), frame('x1', 'gone', 0)];
    const groups = groupFramesByVideo(frames, videos);
    expect(groups.map((g) => g.videoId)).toEqual(['a', 'c', 'b', 'gone']);
    expect(groups[0].frames.map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(groups[3].video).toBeNull();
  });

  it('skips videos without frames', () => {
    expect(groupFramesByVideo([], [video('a', 0)])).toEqual([]);
  });
});

describe('indexDetections', () => {
  it('groups by frame id preserving order', () => {
    const map = indexDetections([
      { frameId: 'f1', bookId: 'b1', bbox: null },
      { frameId: 'f2', bookId: null, bbox: null },
      { frameId: 'f1', bookId: 'b2', bbox: null },
    ]);
    expect(map.get('f1')!.map((d) => d.bookId)).toEqual(['b1', 'b2']);
    expect(map.get('f2')).toHaveLength(1);
    expect(map.get('f3')).toBeUndefined();
  });
});

describe('fitFrame', () => {
  it('fits portrait and landscape frames into the box', () => {
    expect(fitFrame(1080, 1920, 800, 600)).toEqual({ width: 337, height: 600, scale: 600 / 1920 });
    const land = fitFrame(1920, 1080, 800, 600);
    expect(land.width).toBe(800);
    expect(land.height).toBe(450);
  });

  it('caps upscaling at 2x and rejects invalid input', () => {
    expect(fitFrame(100, 100, 1000, 1000)).toEqual({ width: 200, height: 200, scale: 2 });
    expect(fitFrame(0, 100, 100, 100)).toEqual({ width: 0, height: 0, scale: 0 });
  });
});

describe('scaleBBox', () => {
  const f = { width: 1000, height: 2000 };

  it('scales from frame pixels to the rendered size', () => {
    expect(scaleBBox({ x0: 100, y0: 200, x1: 200, y1: 1200 }, f, { width: 500, height: 1000 })).toEqual({
      left: 50,
      top: 100,
      width: 50,
      height: 500,
    });
    // rounded to 1/100 px: no float noise in inline styles (192 × 0.3 = 57.599999999999994)
    expect(scaleBBox({ x0: 108, y0: 192, x1: 216, y1: 1728 }, { width: 1080, height: 1920 }, { width: 324, height: 576 })).toEqual({
      left: 32.4,
      top: 57.6,
      width: 32.4,
      height: 460.8,
    });
  });

  it('normalises swapped corners, clamps and drops degenerate boxes', () => {
    expect(scaleBBox({ x0: 200, y0: 1200, x1: 100, y1: 200 }, f, f)).toEqual({ left: 100, top: 200, width: 100, height: 1000 });
    expect(scaleBBox({ x0: -50, y0: -10, x1: 1200, y1: 2500 }, f, f)).toEqual({ left: 0, top: 0, width: 1000, height: 2000 });
    expect(scaleBBox({ x0: 10, y0: 10, x1: 10.5, y1: 400 }, f, f)).toBeNull();
    expect(scaleBBox(null, f, f)).toBeNull();
    expect(scaleBBox({ x0: Number.NaN, y0: 0, x1: 1, y1: 1 }, f, f)).toBeNull();
    expect(scaleBBox({ x0: 0, y0: 0, x1: 10, y1: 10 }, { width: 0, height: 0 }, f)).toBeNull();
  });
});

describe('formatting & stepping', () => {
  it('formats durations and time stamps', () => {
    expect(formatDuration(9.4)).toBe('0:09');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
    expect(formatTimestamp(4.53)).toBe('0:04.5');
    expect(formatTimestamp(61.96, ',')).toBe('1:02,0');
    expect(formatTimestamp(-1)).toBe('');
  });

  it('steps through frames with clamping', () => {
    const order = ['a', 'b', 'c'];
    expect(stepFrame(order, 'b', 1)).toBe('c');
    expect(stepFrame(order, 'c', 1)).toBe('c');
    expect(stepFrame(order, 'a', -1)).toBe('a');
    expect(stepFrame(order, 'zzz', 1)).toBe('a');
    expect(stepFrame([], 'a', 1)).toBeNull();
  });

  it('chooses the label orientation from the box shape', () => {
    expect(labelOrientation({ left: 0, top: 0, width: 30, height: 200 })).toBe('vertical');
    expect(labelOrientation({ left: 0, top: 0, width: 10, height: 200 })).toBe('none');
    expect(labelOrientation({ left: 0, top: 0, width: 200, height: 30 })).toBe('horizontal');
    expect(labelOrientation({ left: 0, top: 0, width: 36, height: 30 })).toBe('none');
  });
});

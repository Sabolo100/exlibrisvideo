import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import type { VideoDTO } from '@/lib/types';
import {
  appearingBooks,
  estimateProgress,
  finishedUploadPhase,
  focusStep,
  interruptedUploads,
  isVideoErrorCode,
  latestBooks,
  newBookIds,
  overallPhase,
  shelfOrder,
  sortSources,
  sourceCounts,
  sourceErrorKind,
  sourcePhase,
  stageSteps,
  uploadTotals,
} from './model';

function video(p: Partial<VideoDTO> = {}): VideoDTO {
  return {
    id: p.id ?? 'v1',
    kind: 'video',
    sortOrder: 0,
    originalFilename: 'shelf.mp4',
    sizeBytes: 1000,
    uploadStatus: 'uploaded',
    status: 'processing',
    stage: 'vision',
    progress: 40,
    durationSec: 12,
    framesTotal: 40,
    framesAnalyzed: 12,
    booksFound: 0,
    error: null,
    createdAt: '2026-09-13T10:00:00.000Z',
    processedAt: null,
    ...p,
  };
}

const states = (v: VideoDTO, phase = sourcePhase(v, 'processing', false)) => stageSteps(v, phase).map((s) => `${s.stage}:${s.state}`);

describe('sourcePhase', () => {
  it('maps upload and processing states', () => {
    expect(sourcePhase(video({ uploadStatus: 'uploading', status: 'pending', stage: null }), 'draft', true)).toBe('uploading');
    expect(sourcePhase(video({ uploadStatus: 'uploading', status: 'pending', stage: null }), 'draft', false)).toBe('interrupted');
    expect(sourcePhase(video({ status: 'queued', stage: null }), 'processing', false)).toBe('queued');
    expect(sourcePhase(video(), 'processing', false)).toBe('processing');
    expect(sourcePhase(video({ status: 'done', stage: 'done' }), 'processing', false)).toBe('waiting_enrich');
    expect(sourcePhase(video({ status: 'done', stage: 'enrich' }), 'processing', false)).toBe('enriching');
    expect(sourcePhase(video({ status: 'done', stage: 'done' }), 'ready', false)).toBe('done');
    expect(sourcePhase(video({ status: 'error', error: 'no_books' }), 'processing', false)).toBe('error');
    expect(sourcePhase(video({ uploadStatus: 'failed', status: 'error' }), 'draft', false)).toBe('error');
  });
});

describe('finishedUploadPhase', () => {
  const done = { status: 'done', videoId: 'v1' };

  it('follows what the server reports about a source uploaded from this tab', () => {
    const at = (p: Partial<VideoDTO>, collection: 'draft' | 'processing' | 'ready' | 'error' = 'processing') =>
      finishedUploadPhase(done, { status: collection, videos: [video({ id: 'v2' }), video({ id: 'v1', ...p })] });
    expect(at({ status: 'pending', stage: null }, 'draft')).toBe('queued');
    expect(at({ status: 'queued', stage: null })).toBe('queued');
    expect(at({ status: 'processing', stage: 'vision' })).toBe('processing');
    expect(at({ status: 'done', stage: 'done' })).toBe('waiting_enrich');
    expect(at({ status: 'done', stage: 'enrich' })).toBe('enriching');
    expect(at({ status: 'done', stage: 'done' }, 'ready')).toBe('done');
    expect(at({ status: 'error', stage: 'merge', error: 'no_books' }, 'error')).toBe('error');
    expect(at({ uploadStatus: 'failed', status: 'error', stage: null })).toBe('error');
  });

  it('says nothing until the server lists the finished upload as uploaded', () => {
    const status = { status: 'processing' as const, videos: [video({ id: 'v1', uploadStatus: 'uploading', status: 'pending', stage: null })] };
    // the last poll still lists it as uploading (it lags one poll behind the local upload)
    expect(finishedUploadPhase(done, status)).toBeNull();
    // not listed at all yet
    expect(finishedUploadPhase({ status: 'done', videoId: 'other' }, status)).toBeNull();
    // not finished here, or never got a server id
    expect(finishedUploadPhase({ status: 'uploading', videoId: 'v1' }, { status: 'processing', videos: [video({ id: 'v1' })] })).toBeNull();
    expect(finishedUploadPhase({ status: 'done' }, { status: 'processing', videos: [video({ id: 'v1' })] })).toBeNull();
  });
});

describe('stageSteps', () => {
  it('marks steps before the current stage done', () => {
    expect(states(video())).toEqual(['probe:done', 'frames:done', 'vision:active', 'merge:pending', 'crops:pending', 'enrich:pending']);
    expect(states(video({ stage: null }))).toEqual(['probe:active', 'frames:pending', 'vision:pending', 'merge:pending', 'crops:pending', 'enrich:pending']);
  });

  it('handles waiting, enriching, done and failed sources', () => {
    const done = video({ status: 'done', stage: 'done' });
    expect(states(done, 'waiting_enrich').slice(-2)).toEqual(['crops:done', 'enrich:pending']);
    expect(states(video({ status: 'done', stage: 'enrich' }), 'enriching').slice(-1)).toEqual(['enrich:active']);
    expect(states(done, 'done').every((s) => s.endsWith(':done'))).toBe(true);
    const failed = video({ status: 'error', stage: 'merge', error: 'no_books' });
    expect(states(failed, 'error')).toEqual(['probe:done', 'frames:done', 'vision:done', 'merge:error', 'crops:pending', 'enrich:pending']);
    expect(states(video({ uploadStatus: 'failed', status: 'error', stage: null }), 'error')[0]).toBe('probe:error');
    expect(states(video({ status: 'queued', stage: null }), 'queued').every((s) => s.endsWith(':pending'))).toBe(true);
  });

  it('focuses the failed or active step', () => {
    const steps = stageSteps(video({ status: 'error', stage: 'vision' }), 'error');
    expect(focusStep(steps)).toEqual({ stage: 'vision', index: 2 });
    expect(focusStep(stageSteps(video({ stage: 'crops' }), 'processing'))).toEqual({ stage: 'crops', index: 4 });
    expect(focusStep(stageSteps(video({ status: 'queued' }), 'queued'))).toBeNull();
  });
});

describe('overallPhase', () => {
  it('derives the headline phase', () => {
    expect(overallPhase({ status: 'ready', videos: [] }, 0)).toBe('ready');
    expect(overallPhase({ status: 'draft', videos: [] }, 0)).toBe('empty');
    expect(overallPhase({ status: 'draft', videos: [] }, 2)).toBe('uploading');
    expect(overallPhase({ status: 'draft', videos: [video({ uploadStatus: 'uploading', status: 'pending', stage: null })] }, 1)).toBe('uploading');
    expect(overallPhase({ status: 'draft', videos: [video({ uploadStatus: 'uploading', status: 'pending', stage: null })] }, 0)).toBe('interrupted');
    expect(overallPhase({ status: 'processing', videos: [video(), video({ id: 'v2', uploadStatus: 'uploading', status: 'pending' })] }, 1)).toBe('processing');
    expect(overallPhase({ status: 'processing', videos: [video({ status: 'done', stage: 'enrich' })] }, 0)).toBe('enriching');
    expect(overallPhase({ status: 'processing', videos: [video({ status: 'done', stage: 'done' })] }, 0)).toBe('enriching');
    expect(overallPhase({ status: 'error', videos: [video({ status: 'error', error: 'too_long' })] }, 0)).toBe('error');
    expect(overallPhase({ status: 'error', videos: [video({ status: 'error', error: 'too_long' })] }, 1)).toBe('uploading');
    expect(
      overallPhase({ status: 'processing', videos: [video({ status: 'error' }), video({ id: 'v2', status: 'done', stage: 'done' })] }, 0),
    ).toBe('enriching');
  });
});

describe('estimateProgress', () => {
  it('mirrors the API formula', () => {
    expect(estimateProgress('draft', [])).toBe(0);
    expect(estimateProgress('ready', [])).toBe(100);
    expect(estimateProgress('processing', [video({ progress: 40 }), video({ id: 'v2', status: 'done', progress: 100 })])).toBe(70);
    expect(estimateProgress('processing', [video({ status: 'done', progress: 100 })])).toBe(99);
    expect(estimateProgress('processing', [video({ status: 'queued', progress: 0 }), video({ id: 'x', uploadStatus: 'uploading' })])).toBe(0);
  });
});

describe('book helpers', () => {
  const a = makeSampleBook({ id: 'a', title: 'A', shelfPosition: 3, createdAt: '2026-09-13T10:00:03.000Z' });
  const b = makeSampleBook({ id: 'b', title: 'B', shelfPosition: 1, createdAt: '2026-09-13T10:00:05.000Z' });
  const c = makeSampleBook({ id: 'c', title: 'C', shelfPosition: 2, createdAt: '2026-09-13T10:00:01.000Z' });

  it('orders by shelf position and picks the most recent books', () => {
    expect(shelfOrder([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(appearingBooks([a, b, c], 5)).toEqual({ shown: [b, c, a], hidden: 0 });
    const res = appearingBooks([a, b, c], 2);
    expect(res.shown.map((x) => x.id)).toEqual(['b', 'a']);
    expect(res.hidden).toBe(1);
    expect(latestBooks([a, b, c], 2).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('finds new ids and interrupted uploads', () => {
    expect(newBookIds(new Set(['a']), [a, b, c])).toEqual(['b', 'c']);
    const vids = [video({ id: 'x', uploadStatus: 'uploading' }), video({ id: 'y', uploadStatus: 'uploading' }), video({ id: 'z' })];
    expect(interruptedUploads(vids, new Set(['x'])).map((v) => v.id)).toEqual(['y']);
  });

  it('recognises pipeline error codes', () => {
    expect(isVideoErrorCode('no_books')).toBe(true);
    expect(isVideoErrorCode('Ezt a fájltípust nem tudjuk feldolgozni.')).toBe(false);
    expect(isVideoErrorCode(null)).toBe(false);
  });
});

describe('source helpers', () => {
  it('maps failures to localizable kinds', () => {
    expect(sourceErrorKind(video())).toBeNull();
    expect(sourceErrorKind(video({ status: 'error', error: 'too_long' }))).toBe('too_long');
    expect(sourceErrorKind(video({ status: 'error', error: 'ai_failed' }))).toBe('ai_failed');
    // legacy free-text messages and missing codes fall back to the generic guidance
    expect(sourceErrorKind(video({ status: 'error', error: 'ffmpeg exploded' }))).toBe('internal');
    expect(sourceErrorKind(video({ status: 'error', error: null }))).toBe('internal');
    expect(sourceErrorKind(video({ uploadStatus: 'failed', status: 'pending', error: null }))).toBe('upload_failed');
  });

  it('sorts sources in upload order and counts finished ones', () => {
    const a = video({ id: 'a', sortOrder: 2 });
    const b = video({ id: 'b', sortOrder: 0, status: 'done' });
    const c = video({ id: 'c', sortOrder: 1, status: 'error' });
    const d = video({ id: 'd', sortOrder: 3, uploadStatus: 'uploading', status: 'pending' });
    expect(sortSources([a, b, c, d]).map((v) => v.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sourceCounts([a, b, c, d])).toEqual({ done: 2, total: 3 });
    expect(sourceCounts([])).toEqual({ done: 0, total: 0 });
  });

  it('totals local uploads by bytes', () => {
    expect(uploadTotals([])).toEqual({ percent: 0, done: 0, total: 0 });
    const totals = uploadTotals([
      { size: 100, bytesSent: 100, status: 'done' },
      { size: 300, bytesSent: 100, status: 'uploading' },
      { size: 500, bytesSent: 0, status: 'canceled' },
    ]);
    expect(totals.done).toBe(1);
    expect(totals.total).toBe(2);
    expect(totals.percent).toBeCloseTo(50);
    // bytesSent beyond the size never exceeds 100 %
    expect(uploadTotals([{ size: 10, bytesSent: 25, status: 'finalizing' }]).percent).toBe(100);
    expect(uploadTotals([{ size: 0, bytesSent: 0, status: 'done' }])).toEqual({ percent: 100, done: 1, total: 1 });
  });
});

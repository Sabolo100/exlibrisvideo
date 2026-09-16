import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/enrich', () => ({ enrichCollection: vi.fn() }));

const { classifySources, completionDecision, computeCollectionStatus } = await import('./finalize');

const now = Date.parse('2026-09-13T12:00:00Z');
const src = (status: string, uploadStatus: string, minutesAgo = 0, activityMinutesAgo?: number) => ({
  id: Math.random().toString(36),
  status: status as 'pending',
  uploadStatus: uploadStatus as 'uploaded',
  storagePath: null,
  createdAt: new Date(now - minutesAgo * 60_000),
  ...(activityMinutesAgo !== undefined ? { lastActivityMs: now - activityMinutesAgo * 60_000 } : {}),
});

describe('classifySources', () => {
  it('counts uploaded sources by status and live uploads by recent activity', () => {
    const a = classifySources(
      [
        src('done', 'uploaded'),
        src('error', 'uploaded'),
        src('queued', 'uploaded'),
        src('processing', 'uploaded'),
        src('pending', 'uploading', 5),
        src('pending', 'uploading', 120, 10), // old row, but bytes arrived 10 min ago
        src('pending', 'uploading', 120, 45), // abandoned
        src('error', 'failed'),
      ],
      now,
    );
    expect(a).toEqual({ processing: 2, aliveUploads: 2, done: 1, error: 1, uploaded: 4 });
  });
});

describe('completionDecision', () => {
  it('waits for processing, then for live uploads, then enriches', () => {
    expect(completionDecision({ processing: 1, aliveUploads: 1, done: 1, error: 0, uploaded: 2 })).toBe('wait_processing');
    expect(completionDecision({ processing: 0, aliveUploads: 1, done: 1, error: 0, uploaded: 1 })).toBe('wait_uploads');
    expect(completionDecision({ processing: 0, aliveUploads: 0, done: 1, error: 3, uploaded: 4 })).toBe('enrich');
    expect(completionDecision({ processing: 0, aliveUploads: 0, done: 0, error: 1, uploaded: 1 })).toBe('enrich');
  });
});

describe('computeCollectionStatus', () => {
  const base = { processing: 0, aliveUploads: 0, done: 0, error: 0, uploaded: 0 };
  it('follows SPEC §2 / §4.7', () => {
    expect(computeCollectionStatus({ ...base, processing: 1, done: 2, uploaded: 3 }, 10)).toBe('processing');
    expect(computeCollectionStatus({ ...base, done: 1, error: 2, uploaded: 3 }, 10)).toBe('ready');
    expect(computeCollectionStatus({ ...base, error: 2, uploaded: 2 }, 0)).toBe('error');
    expect(computeCollectionStatus({ ...base }, 0)).toBe('draft');
    expect(computeCollectionStatus({ ...base, aliveUploads: 1 }, 3)).toBe('ready');
  });
});

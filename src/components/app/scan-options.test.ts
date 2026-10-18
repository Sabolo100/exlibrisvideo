import { describe, expect, it } from 'vitest';
import type { VideoDTO } from '@/lib/types';
import { scanOptions } from './AppScanPicker';

function video(id: string, createdAt: string, p: Partial<VideoDTO> = {}): VideoDTO {
  return {
    id,
    kind: 'video',
    sortOrder: 0,
    originalFilename: `${id}.mp4`,
    sizeBytes: 1,
    uploadStatus: 'uploaded',
    status: 'done',
    stage: null,
    progress: 100,
    durationSec: 10,
    framesTotal: 10,
    framesAnalyzed: 10,
    booksFound: 0,
    tags: [],
    error: null,
    createdAt,
    processedAt: null,
    ...p,
  };
}

describe('scanOptions', () => {
  it('lists uploaded recordings newest first with the books each brought in', () => {
    const videos = [
      video('old', '2026-10-15T13:29:31.000Z'),
      video('new', '2026-10-18T08:25:25.000Z'),
      video('broken', '2026-10-18T09:00:00.000Z', { uploadStatus: 'failed' }),
    ];
    const options = scanOptions(videos, ['old', 'old', 'new', null, 'gone']);
    expect(options.map((o) => [o.video.id, o.books])).toEqual([
      ['new', 1],
      ['old', 2],
    ]);
  });
});

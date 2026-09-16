import { describe, expect, it } from 'vitest';
import { fileKey } from '@/lib/client/upload-store';
import { etaParts, formatBytes, formatDuration } from './format';
import { DEFAULT_UPLOAD_LIMITS, maxUploadBytes } from './limits';
import { fileProblem, isPlausibleEmail, validateFiles } from './validate';

const f = (name: string, size: number, type: string, lastModified = 1) => ({ name, size, type, lastModified });
const MAX_UPLOAD_BYTES = maxUploadBytes(DEFAULT_UPLOAD_LIMITS);

describe('fileProblem', () => {
  it('accepts phone videos and web images', () => {
    expect(fileProblem(f('VID_20260912.mp4', 5e7, 'video/mp4'))).toBeNull();
    expect(fileProblem(f('IMG_0001.MOV', 5e7, 'video/quicktime'))).toBeNull();
    expect(fileProblem(f('clip.mov', 5e7, ''))).toBeNull();
    expect(fileProblem(f('clip.webm', 5e7, 'video/webm'))).toBeNull();
    expect(fileProblem(f('shelf.jpg', 3e6, 'image/jpeg'))).toBeNull();
    expect(fileProblem(f('shelf.webp', 3e6, 'image/webp'))).toBeNull();
  });

  it('rejects unsupported types with a specific reason for HEIC', () => {
    expect(fileProblem(f('IMG_0002.HEIC', 3e6, 'image/heic'))).toBe('heic');
    expect(fileProblem(f('IMG_0002.heic', 3e6, ''))).toBe('heic');
    expect(fileProblem(f('old.avi', 3e6, 'video/x-msvideo'))).toBe('type');
    expect(fileProblem(f('anim.gif', 3e6, 'image/gif'))).toBe('type');
    expect(fileProblem(f('notes.pdf', 3e6, 'application/pdf'))).toBe('type');
    expect(fileProblem(f('folder', 0, ''))).toBe('type');
  });

  it('rejects empty and oversized files', () => {
    expect(fileProblem(f('a.mp4', 0, 'video/mp4'))).toBe('empty');
    expect(fileProblem(f('a.mp4', MAX_UPLOAD_BYTES, 'video/mp4'))).toBeNull();
    expect(fileProblem(f('a.mp4', MAX_UPLOAD_BYTES + 1, 'video/mp4'))).toBe('size');
  });

  it('applies the size limit the server reports', () => {
    const maxBytes = maxUploadBytes({ maxUploadMb: 5 });
    expect(fileProblem(f('a.mp4', maxBytes, 'video/mp4'), maxBytes)).toBeNull();
    expect(fileProblem(f('a.mp4', maxBytes + 1, 'video/mp4'), maxBytes)).toBe('size');
    // a larger server limit lets files through that the old hard-coded 1 GB rejected
    const big = maxUploadBytes({ maxUploadMb: 4096 });
    expect(fileProblem(f('long.mov', 3 * 1024 ** 3, 'video/quicktime'), big)).toBeNull();
  });
});

describe('validateFiles', () => {
  it('skips duplicates, bad files and files beyond the slot limit', () => {
    const existing = f('a.mp4', 10, 'video/mp4');
    const res = validateFiles(
      [
        f('a.mp4', 10, 'video/mp4'),
        f('b.mp4', 10, 'video/mp4'),
        f('b.mp4', 10, 'video/mp4'),
        f('c.heic', 10, 'image/heic'),
        f('d.jpg', 10, 'image/jpeg'),
        f('e.jpg', 10, 'image/jpeg'),
      ],
      { existingKeys: new Set([fileKey(existing)]), slotsLeft: 2 },
    );
    expect(res.accepted.map((x) => x.name)).toEqual(['b.mp4', 'd.jpg']);
    expect(res.rejected.map((r) => `${r.name}:${r.reason}`)).toEqual([
      'a.mp4:duplicate',
      'b.mp4:duplicate',
      'c.heic:heic',
      'e.jpg:count',
    ]);
  });

  it('treats a negative slot count as zero', () => {
    const res = validateFiles([f('a.mp4', 1, 'video/mp4')], { slotsLeft: -3 });
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0].reason).toBe('count');
  });

  it('uses the given size limit and falls back to the default slot count', () => {
    const res = validateFiles([f('a.mp4', 6 * 1024 * 1024, 'video/mp4'), f('b.mp4', 1024, 'video/mp4')], {
      maxBytes: maxUploadBytes({ maxUploadMb: 5 }),
    });
    expect(res.accepted.map((x) => x.name)).toEqual(['b.mp4']);
    expect(res.rejected.map((r) => `${r.name}:${r.reason}`)).toEqual(['a.mp4:size']);
    const many = Array.from({ length: DEFAULT_UPLOAD_LIMITS.maxSourcesPerCollection + 1 }, (_, i) => f(`${i}.jpg`, 10, 'image/jpeg'));
    expect(validateFiles(many).rejected.map((r) => r.reason)).toEqual(['count']);
  });
});

describe('isPlausibleEmail', () => {
  it('matches typical addresses only', () => {
    expect(isPlausibleEmail('anna.kovacs@example.hu')).toBe(true);
    expect(isPlausibleEmail(' anna@example.co.uk ')).toBe(true);
    expect(isPlausibleEmail('anna@example')).toBe(false);
    expect(isPlausibleEmail('anna example@x.hu')).toBe(false);
    expect(isPlausibleEmail('a@b.hu, c@d.hu')).toBe(false);
    expect(isPlausibleEmail('')).toBe(false);
  });
});

describe('format helpers', () => {
  it('formats byte sizes per locale', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(2048, 'hu')).toBe('2 KB');
    expect(formatBytes(12.5 * 1024 * 1024, 'hu')).toBe('12,5 MB');
    expect(formatBytes(12.5 * 1024 * 1024, 'en')).toBe('12.5 MB');
    expect(formatBytes(250 * 1024 * 1024, 'en')).toBe('250 MB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024, 'hu')).toBe('1,5 GB');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42.4)).toBe('0:42');
    expect(formatDuration(187)).toBe('3:07');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('buckets remaining time', () => {
    expect(etaParts(null)).toBeNull();
    expect(etaParts(3)).toEqual({ unit: 'seconds', count: 5 });
    expect(etaParts(22)).toEqual({ unit: 'seconds', count: 25 });
    expect(etaParts(130)).toEqual({ unit: 'minutes', count: 2 });
    expect(etaParts(5400)).toEqual({ unit: 'hours', count: 1.5 });
  });
});

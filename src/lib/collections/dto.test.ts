import { describe, expect, it } from 'vitest';
import type { BookRow, CollectionRow, FrameRow, VideoRow } from '@/db/schema';
import { toBookDTO, toCollectionDTO, toFrameDTO, toVideoDTO } from './dto';
import { computeCollectionProgress } from './queries';
import { resolveViewer } from './access';
import { ownerCookieValue, pinCookieValue, sha256Hex } from '@/lib/security/tokens';

const now = new Date('2026-09-13T10:00:00Z');

function book(over: Partial<BookRow> = {}): BookRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    collectionId: '123456789',
    title: 'Harmonia caelestis',
    subtitle: null,
    author: 'Esterházy Péter',
    spineAuthor: 'Esterházy',
    spineTitle: 'Harmonia caelestis',
    authorSort: 'esterhazy peter',
    titleSort: 'harmonia caelestis',
    originalTitle: null,
    series: null,
    publisher: 'Magvető',
    language: 'hu',
    originalLanguage: 'hu',
    authorCountry: 'HU',
    firstPublishedYear: 2000,
    editionYear: null,
    isbn: null,
    pageCount: 720,
    category: 'hungarian_literature',
    topics: ['literary_fiction'],
    tags: [],
    descriptionHu: null,
    descriptionEn: null,
    coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
    coverPath: null,
    enrichment: null,
    enrichedAt: null,
    source: 'video',
    confidence: 0.92,
    needsReview: false,
    reviewed: false,
    spinePath: 'spines/123456789/11111111-1111-4111-8111-111111111111.jpg',
    spineColor: '#aa3322',
    bestFrameId: null,
    bestBbox: { x0: 1, y0: 2, x1: 30, y1: 400 },
    firstVideoId: null,
    firstTimeSec: 1.5,
    shelfPosition: 3,
    detectionCount: 4,
    readingStatus: 'read',
    rating: 5,
    favorite: true,
    notes: 'secret note',
    lentTo: 'Anna',
    lentAt: '2026-01-02',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function video(over: Partial<VideoRow> = {}): VideoRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    collectionId: '123456789',
    kind: 'video',
    sortOrder: 0,
    originalFilename: 'polc.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1000,
    bytesReceived: 1000,
    uploadStatus: 'uploaded',
    storagePath: 'uploads/123456789/x.mp4',
    status: 'processing',
    stage: 'vision',
    progress: 40,
    durationSec: 9.5,
    width: 1080,
    height: 1920,
    framesTotal: 20,
    framesAnalyzed: 8,
    booksFound: 3,
    error: null,
    createdAt: now,
    processedAt: null,
    sourceDeletedAt: null,
    ...over,
  };
}

function collection(over: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: '123456789',
    ownerTokenHash: sha256Hex('tok'),
    title: 'Otthoni könyvtár',
    description: null,
    ownerName: 'Kata',
    email: 'kata@example.com',
    locale: 'hu',
    visibility: 'link',
    pinHash: null,
    status: 'ready',
    usage: {},
    viewCount: 0,
    emailSentAt: null,
    lastViewedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('toBookDTO', () => {
  it('maps media URLs and hides owner-only fields from viewers', () => {
    const viewer = toBookDTO(book(), { isOwner: false });
    expect(viewer.spineImage).toBe('/api/media/spines/123456789/11111111-1111-4111-8111-111111111111.jpg');
    expect(viewer.coverImage).toBe('https://covers.openlibrary.org/b/id/1-L.jpg');
    expect(viewer.notes).toBeNull();
    expect(viewer.lentTo).toBeNull();
    expect(viewer.lentAt).toBeNull();
    expect(viewer.enriched).toBe(false);
    expect(viewer.createdAt).toBe('2026-09-13T10:00:00.000Z');

    const owner = toBookDTO(book({ coverPath: 'covers/123456789/a.jpg', enrichedAt: now }), { isOwner: true });
    expect(owner.coverImage).toBe('/api/media/covers/123456789/a.jpg');
    expect(owner.notes).toBe('secret note');
    expect(owner.lentTo).toBe('Anna');
    expect(owner.lentAt).toBe('2026-01-02');
    expect(owner.enriched).toBe(true);
  });

  it('never exposes non-http cover URLs and sanitises jsonb', () => {
    const dto = toBookDTO(book({ coverUrl: 'javascript:alert(1)', spinePath: null, bestBbox: { x0: 'a' } as never, topics: 'x' as never }), {
      isOwner: false,
    });
    expect(dto.coverImage).toBeNull();
    expect(dto.spineImage).toBeNull();
    expect(dto.bestBbox).toBeNull();
    expect(dto.topics).toEqual([]);
  });
});

describe('toCollectionDTO / toVideoDTO / toFrameDTO', () => {
  it('hides e-mail from non-owners and sorts videos', () => {
    const v1 = video({ id: 'b', sortOrder: 1 });
    const v0 = video({ id: 'a', sortOrder: 0 });
    const dto = toCollectionDTO(collection(), { isOwner: false, bookCount: 7, videos: [v1, v0] });
    expect(dto.email).toBeNull();
    expect(dto.publicUrl).toMatch(/\/123456789$/);
    expect(dto.videos.map((v) => v.id)).toEqual(['a', 'b']);
    expect(dto.bookCount).toBe(7);
    expect(toCollectionDTO(collection(), { isOwner: true, bookCount: 0, videos: [] }).email).toBe('kata@example.com');
  });

  it('video + frame DTOs', () => {
    expect(toVideoDTO(video({ progress: 250 })).progress).toBe(100);
    const frame: FrameRow = {
      id: 'f',
      videoId: 'v',
      collectionId: '123456789',
      idx: 3,
      timeSec: 1.25,
      sharpness: 10,
      storagePath: 'frames/123456789/v/0003.jpg',
      thumbPath: null,
      width: 1080,
      height: 1920,
      analyzed: true,
    };
    expect(toFrameDTO(frame)).toEqual({
      id: 'f',
      videoId: 'v',
      idx: 3,
      timeSec: 1.25,
      width: 1080,
      height: 1920,
      image: '/api/media/frames/123456789/v/0003.jpg',
      thumb: null,
    });
  });
});

describe('computeCollectionProgress', () => {
  const s = (status: VideoRow['status'], progress = 0, uploadStatus: VideoRow['uploadStatus'] = 'uploaded') => ({
    status,
    progress,
    uploadStatus,
  });

  it('averages uploaded sources; error counts as 100; none = 0', () => {
    expect(computeCollectionProgress('draft', [])).toBe(0);
    expect(computeCollectionProgress('draft', [s('pending', 0, 'uploading')])).toBe(0);
    expect(computeCollectionProgress('processing', [s('processing', 50), s('queued')])).toBe(25);
    expect(computeCollectionProgress('processing', [s('error'), s('processing', 50)])).toBe(75);
    expect(computeCollectionProgress('ready', [s('done'), s('error')])).toBe(100);
    expect(computeCollectionProgress('ready', [s('done'), s('pending', 0, 'uploading')])).toBe(100);
  });

  it('caps at 99 while the collection is still processing (enrichment)', () => {
    expect(computeCollectionProgress('processing', [s('done'), s('done')])).toBe(99);
  });
});

describe('resolveViewer', () => {
  const tokenHash = sha256Hex('owner-token-abcdefghijklmnop');

  it('owner via cookie or bearer token', () => {
    const c = collection({ ownerTokenHash: tokenHash });
    const cookie = ownerCookieValue(c.id, tokenHash);
    expect(resolveViewer(c, (n) => (n === `exl_own_${c.id}` ? cookie : undefined), null)).toEqual({ isOwner: true, canView: true });
    expect(resolveViewer(c, () => undefined, 'Bearer owner-token-abcdefghijklmnop')).toEqual({ isOwner: true, canView: true });
    expect(resolveViewer(c, () => undefined, 'Bearer owner-token-abcdefghijklmnoX')).toEqual({ isOwner: false, canView: true });
    expect(resolveViewer(c, () => 'forged', null)).toEqual({ isOwner: false, canView: true });
  });

  it('PIN collections need a cookie bound to the current PIN hash', () => {
    const c = collection({ visibility: 'pin', pinHash: 'aa:bb' });
    expect(resolveViewer(c, () => undefined, null)).toEqual({ isOwner: false, canView: false });
    const good = pinCookieValue(c.id, 'aa:bb');
    expect(resolveViewer(c, (n) => (n === `exl_pin_${c.id}` ? good : undefined), null)).toEqual({ isOwner: false, canView: true });
    const rotated = collection({ visibility: 'pin', pinHash: 'cc:dd' });
    expect(resolveViewer(rotated, (n) => (n === `exl_pin_${c.id}` ? good : undefined), null).canView).toBe(false);
    expect(resolveViewer(collection({ visibility: 'pin', pinHash: null }), () => good, null).canView).toBe(false);
  });
});

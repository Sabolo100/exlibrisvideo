import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/text', () => ({
  titleSimilarity: vi.fn(() => {
    throw new Error('not implemented: titleSimilarity');
  }),
  authorsCompatible: vi.fn(() => {
    throw new Error('not implemented: authorsCompatible');
  }),
}));

import * as text from '@/lib/pipeline/text';
import {
  DEMO_BOOKS,
  fixtureObservations,
  isVisibleAt,
  legibilityConfidence,
  mockClassify,
  mockSameBook,
  MockTextProvider,
  MockVisionProvider,
  parseGroundTruth,
  stripBBox,
  videoIdFromFilename,
  type FixtureVideo,
} from './mock';
import type { VisionContext, VisionFrame } from './types';

const frame = (index: number, timeSec: number): VisionFrame => ({
  index,
  frameId: `f${index}`,
  jpeg: Buffer.alloc(0),
  width: 1080,
  height: 1920,
  timeSec,
});

const ctx = (originalFilename: string, sourceSha1: string | null = null): VisionContext => ({
  collectionId: '123456789',
  videoId: 'v',
  originalFilename,
  sourceSha1,
  batchIndex: 0,
  totalBatches: 1,
  locale: 'hu',
});

const VIDEO: FixtureVideo = {
  video: '20260912_212903',
  books: [
    { author: 'FERRANTE', title: 'Az új név története', canonical_author: 'Elena Ferrante', canonical_title: 'Az új név története', legibility: 'clear', best_frame: 3, x_center: 0.6 },
    { author: 'Asimov', title: 'Az Alapítvány barátai', canonical_author: 'Isaac Asimov', canonical_title: null, legibility: 'partial', best_frame: 3, x_center: 0.2 },
    { author: null, title: 'Tanulmány vérvörösben', canonical_author: null, canonical_title: null, legibility: 'guess', best_frame: 9, x_center: 0.5 },
  ],
};

describe('fixture replay', () => {
  it('uses the ±1.25 s visibility window around (best_frame − 1) × 0.5 s', () => {
    // best_frame 3 → t = 1.0 s
    expect(isVisibleAt({ best_frame: 3 }, 1.0)).toBe(true);
    expect(isVisibleAt({ best_frame: 3 }, 2.25)).toBe(true);
    expect(isVisibleAt({ best_frame: 3 }, -0.25)).toBe(true);
    expect(isVisibleAt({ best_frame: 3 }, 2.26)).toBe(false);
    expect(isVisibleAt({ best_frame: 3 }, -0.3)).toBe(false);
  });

  it('orders by x_center, synthesises strips and maps legibility to confidence', () => {
    const out = fixtureObservations(VIDEO, [frame(1, 1.0), frame(2, 3.5)]);
    expect(out).toEqual([
      {
        frame: 1,
        order: 1,
        author: 'Asimov',
        title: 'Az Alapítvány barátai',
        canonicalAuthor: 'Isaac Asimov',
        canonicalTitle: null,
        publisher: null,
        confidence: 0.7,
        bbox: { x0: 167, y0: 96, x1: 265, y1: 1824 },
      },
      expect.objectContaining({ frame: 1, order: 2, author: 'FERRANTE', canonicalAuthor: 'Elena Ferrante', confidence: 0.95 }),
      // best_frame 9 → t = 4.0 s, visible at 3.5 s
      expect.objectContaining({ frame: 2, order: 1, title: 'Tanulmány vérvörösben', author: null, confidence: 0.45 }),
    ]);
  });

  it('clamps strips at the frame border', () => {
    expect(stripBBox(0, 1000, 1000)).toEqual({ x0: 0, y0: 50, x1: 45, y1: 950 });
    expect(stripBBox(1.2, 1000, 1000)).toEqual({ x0: 955, y0: 50, x1: 1000, y1: 950 });
    expect(legibilityConfidence('whatever')).toBe(0.45);
  });

  it('parses the fixture defensively', () => {
    expect(parseGroundTruth(null)).toBeNull();
    expect(parseGroundTruth({ videos: 'x' })).toBeNull();
    const gt = parseGroundTruth({ videos: [{ video: 'a', books: [{ title: 'ok', best_frame: 1, x_center: 0.5 }, { title: 'bad' }] }, { nope: 1 }] });
    expect(gt!.videos).toHaveLength(1);
    expect(gt!.videos[0].books).toEqual([
      { author: null, title: 'ok', canonical_author: null, canonical_title: null, legibility: 'clear', best_frame: 1, x_center: 0.5 },
    ]);
  });

  it('derives the video id from the original filename', () => {
    expect(videoIdFromFilename('20260912_212903.mp4')).toBe('20260912_212903');
    expect(videoIdFromFilename('C:\\Users\\me\\20260912_212903.MOV')).toBe('20260912_212903');
    expect(videoIdFromFilename('clips/shelf.one.mp4')).toBe('shelf.one');
  });
});

describe('MockVisionProvider with a project root', () => {
  let root: string;
  const sample = Buffer.from('fake sample video bytes');

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'exl-ai-mock-'));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('serves the demo shelf while the fixture is missing, then picks it up lazily', async () => {
    const provider = new MockVisionProvider({ rootDir: root, latency: false });
    const before = await provider.readSpines([frame(1, 0), frame(2, 0.5)], ctx('20260912_212903.mp4'));
    expect(before.observations.length).toBeGreaterThan(0);
    expect(before.observations.every((o) => DEMO_BOOKS.some((b) => b.title === o.title))).toBe(true);
    expect(before.usage).toEqual({ provider: 'mock', model: 'mock-fixture', inputTokens: 0, outputTokens: 0, estCostUsd: 0 });

    await fs.mkdir(path.join(root, 'fixtures', 'sample-shelf'), { recursive: true });
    await fs.writeFile(path.join(root, 'fixtures', 'sample-shelf', 'ground-truth.json'), JSON.stringify({ videos: [VIDEO] }));
    await fs.mkdir(path.join(root, 'Mintavideok'), { recursive: true });
    await fs.writeFile(path.join(root, 'Mintavideok', `${VIDEO.video}.mp4`), sample);

    const after = await provider.readSpines([frame(1, 1.0)], ctx('20260912_212903.mp4'));
    expect(after.observations.map((o) => o.title)).toEqual(['Az Alapítvány barátai', 'Az új név története']);
  });

  it('matches renamed uploads by the sha1 of the first 4 MiB', async () => {
    const provider = new MockVisionProvider({ rootDir: root, latency: false });
    const sha1 = createHash('sha1').update(sample).digest('hex');
    const res = await provider.readSpines([frame(1, 4.0)], ctx('IMG_0042.mp4', sha1));
    expect(res.observations.map((o) => o.title)).toEqual(['Tanulmány vérvörösben']);
    const other = await provider.readSpines([frame(1, 4.0)], ctx('IMG_0042.mp4', 'f'.repeat(40)));
    expect(other.observations.every((o) => DEMO_BOOKS.some((b) => b.title === o.title))).toBe(true);
  });

  it('spreads the demo books along the video deterministically', async () => {
    const provider = new MockVisionProvider({ rootDir: root, latency: false });
    const a = await provider.readSpines([frame(1, 3), frame(2, 3.5)], ctx('unknown.mp4'));
    const b = await provider.readSpines([frame(1, 3), frame(2, 3.5)], ctx('unknown.mp4'));
    expect(a).toEqual(b);
    for (const f of [1, 2]) {
      const orders = a.observations.filter((o) => o.frame === f).map((o) => o.order);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
    const late = await provider.readSpines([frame(1, 60)], ctx('unknown.mp4'));
    expect(late.observations).toEqual([]);
  });

  it('simulates 200–600 ms latency by default', async () => {
    const provider = new MockVisionProvider({ rootDir: root });
    const t0 = Date.now();
    await provider.readSpines([frame(1, 0)], ctx('unknown.mp4'));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('MockTextProvider', () => {
  const book = (id: string, author: string | null, title: string, publisher: string | null = null) => ({
    id,
    author,
    title,
    spineAuthor: author,
    spineTitle: title,
    publisher,
  });

  it('classifies by keywords and never invents facts', async () => {
    const provider = new MockTextProvider({ latency: false });
    const { results, usage } = await provider.classifyBooks(
      [
        book('1', 'Isaac Asimov', 'Az Alapítvány barátai', 'Galaktika Könyvek'),
        book('2', 'Móricz Zsigmond', 'Rokonok'),
        book('3', 'Rejtő Jenő', 'A tizennégy karátos autó'),
        book('4', null, 'Xyzzy'),
        book('4', null, 'duplicate id'),
        book('5', 'Desmond Morris', 'The Naked Ape'),
      ],
      { locale: 'hu' },
    );
    expect(results.map((r) => [r.id, r.category])).toEqual([
      ['1', 'scifi'],
      ['2', 'hungarian_literature'],
      ['3', 'humor'],
      ['4', 'other'],
      ['5', 'other'],
    ]);
    expect(results[2].topics).toContain('hungarian_literature');
    expect(results[1]).toMatchObject({ authorCountry: 'HU', language: 'hu', firstPublishedYear: null, descriptionHu: null, descriptionEn: null, author: null });
    expect(results[4].language).toBe('en');
    expect(usage.provider).toBe('mock');
    expect(mockClassify(book('x', null, 'Magyar–angol szótár')).category).toBe('reference');
  });

  it('judges duplicates with the text helpers, falling back to folded comparison', async () => {
    const provider = new MockTextProvider({ latency: false });
    const questions = [
      { id: 'q1', a: { author: 'Szabó Magda', title: 'AZ AJTÓ' }, b: { author: null, title: 'Az ajtó' } },
      { id: 'q2', a: { author: null, title: 'A Gyűrűk Ura I' }, b: { author: null, title: 'A Gyűrűk Ura II' } },
      { id: 'q3', a: { author: 'Szabó Magda', title: 'Abigél' }, b: { author: 'Szabó Magda', title: 'Az ajtó' } },
    ];
    // text helpers throw (stub) → exact folded compare
    expect((await provider.judgeDuplicates(questions)).same).toEqual({ q1: true, q2: false, q3: false });

    vi.mocked(text.titleSimilarity).mockImplementation((a: string, b: string) => (a.toLowerCase().slice(0, 5) === b.toLowerCase().slice(0, 5) ? 0.9 : 0.1));
    vi.mocked(text.authorsCompatible).mockImplementation(() => true);
    expect(mockSameBook({ author: null, title: 'Az elveszett gyerek' }, { author: 'Elena Ferrante', title: 'Az elvesztett gyerek' })).toBe(true);
    expect(mockSameBook({ author: null, title: 'A Gyűrűk Ura 1' }, { author: null, title: 'A Gyűrűk Ura 2' })).toBe(false);
  });
});

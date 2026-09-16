import { describe, expect, it, vi } from 'vitest';
import type { SpineReading, SpineToRead, VisionContext, VisionProvider } from '@/lib/ai/types';
import {
  betterReadings,
  duplicateNeighbours,
  illegibleRuns,
  joinCandidates,
  needsSecondChance,
  planSpineBatches,
  readCandidates,
  readingsAgree,
  sameBookReading,
  settleReading,
  type ChosenCandidate,
} from './recognize';
import type { SpineCandidate, SpineView } from './tracking';

vi.mock('@/db', () => ({ db: () => ({}) }));

const reading = (over: Partial<SpineReading> = {}): SpineReading => ({
  id: 1,
  part: 1,
  status: 'book',
  author: 'Szabó Magda',
  title: 'Abigél',
  canonicalAuthor: null,
  canonicalTitle: null,
  publisher: null,
  confidence: 0.9,
  ...over,
});

const view = (frame: number, left: number, right: number, width = 1000): SpineView => ({
  frame,
  band: { y0: 500, y1: 1000 },
  left: { xc: left, deg: 0 },
  right: { xc: right, deg: 0 },
  centrality: Math.max(0, 1 - Math.abs((left + right) / 2 - width / 2) / (width / 2)),
});

const candidate = (position: number, views: SpineView[], chain = 0): SpineCandidate => ({ chain, position, views });

const chosen = (views: number, wide = false): ChosenCandidate => ({
  candidate: candidate(0, []),
  read: Array.from({ length: views }, () => ({
    view: view(0, 0, 10),
    upright: Buffer.alloc(0),
    sharpness: 1,
    reading: { jpeg: Buffer.from([0xff, 0xd8]), width: 10, height: 10 },
  })),
  wide,
});

const CTX: Omit<VisionContext, 'batchIndex' | 'totalBatches'> = {
  collectionId: '123456789',
  videoId: 'v1',
  originalFilename: 'polc.mp4',
  sourceSha1: null,
  locale: 'hu',
};

describe('reading helpers', () => {
  it('plans batches by picture count without splitting a spine', () => {
    expect(planSpineBatches([chosen(2), chosen(2), chosen(1), chosen(2), chosen(2)], 5)).toEqual([[0, 1, 2], [3, 4]]);
    expect(planSpineBatches([chosen(2)], 1)).toEqual([[0]]);
  });

  it('gives a second chance only to spines without a trustworthy reading', () => {
    expect(needsSecondChance(undefined)).toBe(true);
    expect(needsSecondChance([reading({ status: 'illegible', title: '' })])).toBe(true);
    expect(needsSecondChance([reading({ confidence: 0.5 })])).toBe(true);
    expect(needsSecondChance([reading({ confidence: 0.8 })])).toBe(false);
    expect(needsSecondChance([reading({ status: 'not_book', title: '' })])).toBe(false);
  });

  it('prefers a legible book, then the more confident reading', () => {
    const illegible = [reading({ status: 'illegible', title: '' })];
    const weak = [reading({ confidence: 0.55 })];
    const strong = [reading({ title: 'Az ajtó', confidence: 0.9 })];
    expect(betterReadings(illegible, weak)[0].confidence).toBe(0.55);
    expect(betterReadings(strong, weak)[0].title).toBe('Az ajtó');
    expect(betterReadings(undefined, illegible)[0].status).toBe('illegible');
  });

  it('recognises one book read twice, even partly, but not two volumes', () => {
    expect(sameBookReading(reading(), reading({ author: null, title: 'Abigél', confidence: 0.6 }))).toBe(true);
    expect(sameBookReading(reading({ title: 'A Gyűrűk Ura I' }), reading({ title: 'A Gyűrűk Ura II' }))).toBe(false);
    expect(sameBookReading(reading(), reading({ author: 'Kertész Imre', title: 'Abigél' }))).toBe(false);
    expect(readingsAgree(reading({ title: 'The Hundred-Year-Old Man' }), reading({ title: 'The Hundred-Year-Old Man Who Climbed Out of the Window' }))).toBe(true);
  });

  it('drops the weaker of two neighbouring candidates that read the same book', () => {
    const cands = [candidate(0, []), candidate(1, []), candidate(2, []), candidate(0, [], 1)];
    const readings = new Map<number, SpineReading[]>([
      [0, [reading({ confidence: 0.7 })]],
      [1, [reading({ confidence: 0.9 })]],
      [2, [reading({ title: 'Az ajtó' })]],
      [3, [reading()]],
    ]);
    expect([...duplicateNeighbours(cands, readings)]).toEqual([0]);
  });
});

describe('settleReading (independent second reading)', () => {
  it('raises the confidence when both readings agree', () => {
    const { reading: r, outcome } = settleReading(reading({ confidence: 0.65 }), [reading({ confidence: 0.7 })]);
    expect(outcome).toBe('confirmed');
    expect(r!.confidence).toBeCloseTo(0.8, 6);
  });

  it('drops a guess that the second reading could not see', () => {
    const guess = reading({ author: 'Szabó Magda', title: 'Az ajtó', confidence: 0.55 });
    expect(settleReading(guess, [reading({ status: 'illegible', title: '' })])).toEqual({ reading: null, outcome: 'dropped' });
    expect(settleReading(guess, undefined).outcome).toBe('dropped');
  });

  it('keeps a contradicted reading for review with a low confidence', () => {
    const first = reading({ title: 'The Raven and Other Favorite Poems', author: null, confidence: 0.75 });
    const { reading: r, outcome } = settleReading(first, [reading({ title: 'Games People Play', author: 'Eric Berne', confidence: 0.6 })]);
    expect(outcome).toBe('disputed');
    expect(r!.title).toBe('The Raven and Other Favorite Poems');
    expect(r!.confidence).toBe(0.5);
    const unseen = settleReading(reading({ confidence: 0.7 }), []);
    expect(unseen.outcome).toBe('disputed');
  });
});

describe('slices of one spine', () => {
  it('finds runs of neighbouring illegible candidates on one chain', () => {
    const cands = [0, 1, 2, 3, 4, 5].map((p) => candidate(p, []));
    cands.push(candidate(0, [], 1), candidate(1, [], 1));
    const ill = [reading({ status: 'illegible', title: '' })];
    const readings = new Map<number, SpineReading[]>([
      [0, ill],
      [1, ill],
      [2, [reading()]],
      [3, ill],
      [5, ill],
      [6, ill],
      [7, ill],
    ]);
    // 3 and 5 are not neighbours (4 has no reading); 6-7 are a run on chain 1
    expect(illegibleRuns(cands, readings)).toEqual([[0, 1], [6, 7]]);
  });

  it('joins a run into one candidate over the frames that show all of it', () => {
    const a = candidate(0, [view(0, 100, 140), view(1, 60, 100), view(2, 20, 60)]);
    const b = candidate(1, [view(0, 140, 190), view(2, 60, 110)]);
    const c = candidate(2, [view(0, 190, 260), view(1, 150, 220), view(2, 110, 180)]);
    const joined = joinCandidates([a, b, c], [1000, 1000, 1000])!;
    expect(joined.views.map((v) => [v.frame, v.left.xc, v.right.xc])).toEqual([
      [0, 100, 260],
      [1, 60, 220],
      [2, 20, 180],
    ]);
    expect(joinCandidates([a, c], [1000, 1000, 1000], 0.1)).toBeNull();
  });
});

describe('readCandidates', () => {
  function provider(impl: (spines: SpineToRead[]) => Promise<SpineReading[]>): VisionProvider & { calls: SpineToRead[][] } {
    const calls: SpineToRead[][] = [];
    return {
      name: 'deepseek',
      model: 'deepseek-flash',
      calls,
      readSpines: async () => {
        throw new Error('not used');
      },
      readSpineImages: async (spines) => {
        calls.push(spines);
        return { readings: await impl(spines), usage: { provider: 'deepseek', model: 'deepseek-flash', inputTokens: 100, outputTokens: 10, estCostUsd: 0.001 } };
      },
    };
  }

  it('maps readings of every batch back to the candidates and sums the usage', async () => {
    const list = [chosen(2), chosen(2, true), chosen(1), chosen(2)];
    const p = provider(async (spines) => spines.map((s) => reading({ id: s.id, title: `T${s.views.length}${s.wide ? 'w' : ''}` })));
    const res = await readCandidates(list, p, CTX, { batchImages: 4, concurrency: 1 });
    expect(p.calls.map((c) => c.length)).toEqual([2, 2]);
    expect(p.calls[0][1].wide).toBe(true);
    expect([...res.readings.entries()].map(([i, r]) => [i, r[0].title])).toEqual([
      [0, 'T2'],
      [1, 'T2w'],
      [2, 'T1'],
      [3, 'T2'],
    ]);
    expect(res.usage).toMatchObject({ inputTokens: 200, outputTokens: 20 });
    expect(res.batches).toBe(2);
    expect(res.failedBatches).toBe(0);
  });

  it('retries a failing batch and counts batches that keep failing', async () => {
    let attempts = 0;
    const p = provider(async (spines) => {
      attempts++;
      if (attempts < 3) throw new Error('503');
      if (spines.some((sp) => sp.views.length === 2)) throw new Error('always');
      return spines.map((s) => reading({ id: s.id }));
    });
    const res = await readCandidates([chosen(1), chosen(1), chosen(2)], p, CTX, { batchImages: 1, concurrency: 1, retries: 2, retryDelayMs: () => 0 });
    expect(res.readings.has(0)).toBe(true);
    expect(res.readings.has(2)).toBe(false);
    expect(res.failedBatches).toBe(1);
  });

  it('stops at once when the API key is rejected', async () => {
    const p = provider(async () => {
      throw Object.assign(new Error('key rejected'), { name: 'AiConfigError' });
    });
    await expect(readCandidates([chosen(1), chosen(1)], p, CTX, { batchImages: 1, retryDelayMs: () => 0 })).rejects.toMatchObject({ code: 'ai_failed' });
  });
});

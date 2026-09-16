import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  row: null as null | { usage: unknown },
  forArg: undefined as string | undefined,
  updates: [] as unknown[],
  transactions: 0,
}));

vi.mock('@/db', () => {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async (mode: string) => {
            state.forArg = mode;
            return state.row ? [state.row] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: { usage: unknown }) => ({
        where: async () => {
          state.updates.push(values.usage);
          if (state.row) state.row.usage = values.usage;
        },
      }),
    }),
  };
  return {
    db: () => ({
      transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
        state.transactions++;
        return fn(tx);
      },
    }),
  };
});

import { CACHE_READ_MULTIPLIER, estimate, priceFor } from './cost';
import { accumulateUsage, recordUsage } from './usage';

beforeEach(() => {
  state.row = null;
  state.forArg = undefined;
  state.updates = [];
  state.transactions = 0;
});

describe('estimate', () => {
  it('prices known Claude models per million tokens', () => {
    expect(estimate('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(30);
    expect(estimate('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(12);
    expect(estimate('claude-haiku-4-5', { inputTokens: 2_000_000, outputTokens: 0 })).toBe(2);
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 });
  });

  it('applies prompt-cache multipliers to the cached part of the input', () => {
    const usd = estimate('claude-opus-5', { inputTokens: 10_000, outputTokens: 0, cacheReadInputTokens: 8_000, cacheCreationInputTokens: 2_000 });
    expect(usd).toBeCloseTo((8_000 * 5 * CACHE_READ_MULTIPLIER + 2_000 * 5 * 1.25) / 1e6, 9);
  });

  it('returns 0 for unknown models and bad numbers', () => {
    expect(estimate('deepseek-flash', { inputTokens: 5000, outputTokens: 5000 })).toBe(0);
    expect(estimate('mock-fixture', { inputTokens: 1, outputTokens: 1 })).toBe(0);
    expect(estimate('claude-opus-5', { inputTokens: Number.NaN, outputTokens: -5 })).toBe(0);
  });
});

describe('accumulateUsage', () => {
  it('adds tokens, cost and per-model calls without mutating the previous value', () => {
    const prev = { inputTokens: 100, outputTokens: 10, estCostUsd: 0.5, byModel: { 'claude-opus-5': { inputTokens: 100, outputTokens: 10, calls: 1 } } };
    const next = accumulateUsage(prev, { provider: 'anthropic', model: 'claude-opus-5', inputTokens: 50, outputTokens: 5, estCostUsd: 0.25 });
    expect(next).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      estCostUsd: 0.75,
      byModel: { 'claude-opus-5': { inputTokens: 150, outputTokens: 15, calls: 2 } },
    });
    expect(prev.inputTokens).toBe(100);
    const other = accumulateUsage(next, { provider: 'deepseek', model: 'deepseek-flash', inputTokens: 7, outputTokens: 3, estCostUsd: 0 });
    expect(other.byModel).toEqual({
      'claude-opus-5': { inputTokens: 150, outputTokens: 15, calls: 2 },
      'deepseek-flash': { inputTokens: 7, outputTokens: 3, calls: 1 },
    });
  });

  it('starts from an empty object and sanitises garbage', () => {
    expect(accumulateUsage({}, { provider: 'mock', model: '', inputTokens: -1, outputTokens: Number.NaN, estCostUsd: Number.POSITIVE_INFINITY })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: 0,
      byModel: { mock: { inputTokens: 0, outputTokens: 0, calls: 1 } },
    });
  });
});

describe('recordUsage', () => {
  it('locks the collection row and writes the accumulated totals in one transaction', async () => {
    state.row = { usage: { inputTokens: 1, outputTokens: 1, estCostUsd: 0.1, byModel: {} } };
    await recordUsage('123456789', { provider: 'anthropic', model: 'claude-opus-5', inputTokens: 9, outputTokens: 4, estCostUsd: 0.2 });
    expect(state.transactions).toBe(1);
    expect(state.forArg).toBe('update');
    expect(state.updates).toEqual([
      { inputTokens: 10, outputTokens: 5, estCostUsd: 0.3, byModel: { 'claude-opus-5': { inputTokens: 9, outputTokens: 4, calls: 1 } } },
    ]);
  });

  it('does nothing for a deleted collection', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await recordUsage('999999999', { provider: 'mock', model: 'mock', inputTokens: 1, outputTokens: 1, estCostUsd: 0 });
    expect(state.updates).toEqual([]);
  });
});

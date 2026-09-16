/**
 * Token price table (USD per million tokens) and cost estimation for AI usage tracking.
 * Figures are list prices; they only feed `collections.usage.estCostUsd` (admin overview),
 * never billing.
 */

export interface ModelPrice {
  /** USD per 1M uncached input tokens */
  input: number;
  /** USD per 1M output tokens (thinking tokens are billed as output) */
  output: number;
}

export const PRICES_PER_MTOK: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5': { input: 5, output: 25 },
  // Opus 4.8 is the server-side refusal fallback target of Opus 5 (same list price).
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // DeepSeek models (deepseek-flash, deepseek-v4-pro) are intentionally absent: their current
  // per-token prices are not part of our contract, so they estimate to 0 rather than a guess.
};

/** Prompt-cache multipliers relative to the base input price (5-minute ephemeral cache). */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export interface TokenCounts {
  /**
   * ALL input tokens of the request (uncached + cache read + cache write). When the cache
   * breakdown is given, the uncached part is derived as the remainder.
   */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** Price entry for a model id: exact match, else the longest known id the model starts with
 * (e.g. dated snapshots "claude-haiku-4-5-20251001"). Unknown models → undefined. */
export function priceFor(model: string): ModelPrice | undefined {
  const id = model.trim().toLowerCase();
  const exact = PRICES_PER_MTOK[id];
  if (exact) return exact;
  let best: { key: string; price: ModelPrice } | undefined;
  for (const [key, price] of Object.entries(PRICES_PER_MTOK)) {
    if (id.startsWith(`${key}-`) && (!best || key.length > best.key.length)) best = { key, price };
  }
  return best?.price;
}

const nonNegative = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Estimated cost in USD, rounded to 9 decimals (nano-dollars, so tiny calls still add up).
 * Unknown models (e.g. DeepSeek, mock) return 0 – we would rather under-report than invent prices.
 */
export function estimate(model: string, tokens: TokenCounts): number {
  const price = priceFor(model);
  if (!price) return 0;
  const input = nonNegative(tokens.inputTokens);
  const output = nonNegative(tokens.outputTokens);
  const cacheRead = Math.min(nonNegative(tokens.cacheReadInputTokens), input);
  const cacheWrite = Math.min(nonNegative(tokens.cacheCreationInputTokens), input - cacheRead);
  const uncached = input - cacheRead - cacheWrite;
  const usd =
    (uncached * price.input +
      cacheRead * price.input * CACHE_READ_MULTIPLIER +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
      output * price.output) /
    1_000_000;
  return Math.round(usd * 1e9) / 1e9;
}

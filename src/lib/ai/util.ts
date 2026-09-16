/**
 * Small helpers shared by the AI providers.
 */
import type { AiProviderName } from '@/lib/types';
import type { AiUsage } from './types';

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Splits a list into two halves (first half gets the extra element). */
export function halves<T>(items: readonly T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

/** Runs `fn` over `items` with at most `limit` concurrent calls, preserving result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Accumulates token usage over several API calls that together answer one provider call. */
export class UsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cost = 0;
  private servedModel: string | undefined;

  constructor(
    private readonly provider: AiProviderName,
    private readonly configuredModel: string,
  ) {}

  add(part: { model?: string | null; inputTokens: number; outputTokens: number; estCostUsd: number }): void {
    this.inputTokens += finiteOrZero(part.inputTokens);
    this.outputTokens += finiteOrZero(part.outputTokens);
    this.cost += finiteOrZero(part.estCostUsd);
    if (part.model) this.servedModel = part.model;
  }

  total(): AiUsage {
    return {
      provider: this.provider,
      model: this.servedModel ?? this.configuredModel,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estCostUsd: Math.round(this.cost * 1e9) / 1e9,
    };
  }
}

function finiteOrZero(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Error text safe for logs: message only, truncated, never request bodies/headers. */
export function describeError(err: unknown, max = 300): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
}

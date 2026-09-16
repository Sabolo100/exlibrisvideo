/**
 * Adds token usage + estimated cost to collections.usage (jsonb).
 * The row is locked with SELECT … FOR UPDATE inside a transaction, so concurrent vision batches
 * of the same collection never lose increments.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { collections } from '@/db/schema';
import type { UsageTotals } from '@/lib/types';
import type { AiUsage } from './types';

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
const usd = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const roundNano = (n: number) => Math.round(n * 1e9) / 1e9;

/** Pure accumulation used by recordUsage (exported for tests). Never mutates `prev`. */
export function accumulateUsage(prev: UsageTotals | null | undefined, usage: AiUsage): UsageTotals {
  const base: UsageTotals = prev && typeof prev === 'object' ? prev : {};
  const inputTokens = count(usage.inputTokens);
  const outputTokens = count(usage.outputTokens);
  const model = usage.model?.trim() || usage.provider || 'unknown';

  const byModel: NonNullable<UsageTotals['byModel']> = {};
  if (base.byModel && typeof base.byModel === 'object') {
    for (const [k, v] of Object.entries(base.byModel)) {
      byModel[k] = { inputTokens: count(v?.inputTokens), outputTokens: count(v?.outputTokens), calls: count(v?.calls) };
    }
  }
  const current = byModel[model] ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
  byModel[model] = {
    inputTokens: current.inputTokens + inputTokens,
    outputTokens: current.outputTokens + outputTokens,
    calls: current.calls + 1,
  };

  return {
    ...base,
    inputTokens: count(base.inputTokens) + inputTokens,
    outputTokens: count(base.outputTokens) + outputTokens,
    estCostUsd: roundNano(usd(base.estCostUsd) + usd(usage.estCostUsd)),
    byModel,
  };
}

export async function recordUsage(collectionId: string, usage: AiUsage): Promise<void> {
  if (!collectionId || !usage) return;
  await db().transaction(async (tx) => {
    const rows = await tx
      .select({ usage: collections.usage })
      .from(collections)
      .where(eq(collections.id, collectionId))
      .for('update');
    if (rows.length === 0) {
      // collection deleted while processing – nothing to record
      console.info('[ai] recordUsage: collection not found', { collectionId });
      return;
    }
    const next = accumulateUsage(rows[0].usage, usage);
    await tx.update(collections).set({ usage: next }).where(eq(collections.id, collectionId));
  });
}

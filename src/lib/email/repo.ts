/** Database access used by the e-mail job (kept separate so the handler is easy to test). */
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { books, collections, emailLog, type CollectionRow } from '@/db/schema';
import type { EmailKind } from '@/lib/types';

export type EmailLogStatus = 'sent' | 'failed' | 'skipped';

export async function loadCollectionRow(id: string): Promise<CollectionRow | null> {
  const rows = await db().select().from(collections).where(eq(collections.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Collections registered with this address (case-insensitive), newest first. */
export async function findCollectionsByEmail(email: string, limit: number): Promise<CollectionRow[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  return db()
    .select()
    .from(collections)
    .where(sql`lower(${collections.email}) = ${normalized}`)
    .orderBy(desc(collections.createdAt))
    .limit(limit);
}

export async function countBooksByCollection(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await db()
    .select({ collectionId: books.collectionId, n: count() })
    .from(books)
    .where(inArray(books.collectionId, ids))
    .groupBy(books.collectionId);
  for (const r of rows) out.set(r.collectionId, Number(r.n));
  return out;
}

export async function insertEmailLog(entry: {
  collectionId: string | null;
  to: string;
  kind: EmailKind;
  status: EmailLogStatus;
  error?: string | null;
}): Promise<void> {
  await db()
    .insert(emailLog)
    .values({
      collectionId: entry.collectionId,
      toAddress: entry.to,
      kind: entry.kind,
      status: entry.status,
      error: entry.error ? entry.error.slice(0, 1000) : null,
    });
}

export async function markEmailSent(collectionId: string, at: Date): Promise<void> {
  await db().update(collections).set({ emailSentAt: at }).where(eq(collections.id, collectionId));
}

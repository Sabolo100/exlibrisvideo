/**
 * Hourly housekeeping (SPEC §4.8 `cleanup` job):
 *  - stale sources whose upload never completed (> 24 h without new bytes) → file + row removed
 *  - empty draft collections untouched for DRAFT_RETENTION_DAYS → rows + files removed
 *  - exports/ temp files older than 1 day
 *  - old rate_limits rows, finished jobs older than 30 days
 *  - orphaned key-frame temp dirs of crashed workers
 */
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { collections, videos } from '@/db/schema';
import { env } from '@/lib/env';
import { describeError } from '@/lib/jobs/errors';
import { purgeFinishedJobs } from '@/lib/jobs/queue';
import { abs, removeCollectionFiles } from '@/lib/storage';
import { scheduleCollectionCompletion } from './finalize';
import { FRAME_TEMP_PREFIX } from './frames';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const STALE_UPLOAD_MS = DAY;
export const EXPORT_MAX_AGE_MS = DAY;
export const RATE_LIMIT_MAX_AGE_DAYS = 2;
export const FINISHED_JOB_MAX_AGE_DAYS = 30;
export const TEMP_DIR_MAX_AGE_MS = DAY;

export interface CleanupResult {
  staleUploads: number;
  drafts: number;
  exportFiles: number;
  rateLimitRows: number;
  jobs: number;
  tempDirs: number;
  errors: string[];
}

async function mtimeMs(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return null;
  }
}

/** Sources stuck in `uploading` for more than 24 h without new bytes. */
export async function purgeStaleUploads(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - STALE_UPLOAD_MS);
  const candidates = await db()
    .select({ id: videos.id, collectionId: videos.collectionId, storagePath: videos.storagePath, uploadStatus: videos.uploadStatus })
    .from(videos)
    .where(and(eq(videos.uploadStatus, 'uploading'), lt(videos.createdAt, cutoff)));

  const affected = new Set<string>();
  let removed = 0;
  for (const v of candidates) {
    const file = v.storagePath ? abs(v.storagePath) : null;
    if (file) {
      const m = await mtimeMs(file);
      if (m !== null && now - m < STALE_UPLOAD_MS) continue; // still receiving bytes
    }
    const res = await db()
      .delete(videos)
      .where(and(eq(videos.id, v.id), eq(videos.uploadStatus, 'uploading')))
      .returning({ id: videos.id });
    if (res.length === 0) continue; // completed meanwhile
    removed++;
    affected.add(v.collectionId);
    if (file) await fs.rm(file, { force: true }).catch(() => {});
    await fs.rm(abs(`frames/${v.collectionId}/${v.id}`), { recursive: true, force: true }).catch(() => {});
  }

  // A purged upload may have been the last thing a processing collection was waiting for.
  if (affected.size > 0) {
    const cols = await db()
      .select({ id: collections.id })
      .from(collections)
      .where(and(inArray(collections.id, [...affected]), eq(collections.status, 'processing')));
    for (const c of cols) await scheduleCollectionCompletion(c.id);
  }
  return removed;
}

/** Draft collections without any source or book, untouched for DRAFT_RETENTION_DAYS. */
export async function purgeOldDrafts(now = Date.now()): Promise<number> {
  const days = Math.max(1, env().DRAFT_RETENTION_DAYS);
  const cutoff = new Date(now - days * DAY);
  const res = await db().execute<{ id: string }>(sql`
    DELETE FROM collections c
     WHERE c.status = 'draft'
       AND c.created_at < ${cutoff.toISOString()}::timestamptz
       AND c.updated_at < ${cutoff.toISOString()}::timestamptz
       AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.collection_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM books b WHERE b.collection_id = c.id)
    RETURNING c.id`);
  for (const row of res.rows) {
    await removeCollectionFiles(row.id).catch(() => {});
  }
  return res.rows.length;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** exports/<collectionId>/<file> older than one day; empty collection dirs are removed. */
export async function purgeOldExports(now = Date.now()): Promise<number> {
  const root = abs('exports');
  let removed = 0;
  for (const dir of await readDirSafe(root)) {
    const dirPath = path.join(root, dir.name);
    if (!dir.isDirectory()) {
      const m = await mtimeMs(dirPath);
      if (m !== null && now - m > EXPORT_MAX_AGE_MS) {
        await fs.rm(dirPath, { force: true }).catch(() => {});
        removed++;
      }
      continue;
    }
    const entries = await readDirSafe(dirPath);
    let left = entries.length;
    for (const f of entries) {
      const p = path.join(dirPath, f.name);
      const m = await mtimeMs(p);
      if (m !== null && now - m > EXPORT_MAX_AGE_MS) {
        await fs.rm(p, { recursive: true, force: true }).catch(() => {});
        removed++;
        left--;
      }
    }
    if (left === 0) await fs.rmdir(dirPath).catch(() => {});
  }
  return removed;
}

export async function purgeRateLimits(): Promise<number> {
  const res = await db().execute<{ key: string }>(sql`
    DELETE FROM rate_limits
     WHERE window_start < now() - make_interval(days => ${RATE_LIMIT_MAX_AGE_DAYS})
    RETURNING key`);
  return res.rows.length;
}

/** exlibris-frames-* temp dirs left behind by a killed worker. */
export async function purgeFrameTempDirs(now = Date.now()): Promise<number> {
  const tmp = os.tmpdir();
  let removed = 0;
  for (const d of await readDirSafe(tmp)) {
    if (!d.isDirectory() || !d.name.startsWith(FRAME_TEMP_PREFIX)) continue;
    const p = path.join(tmp, d.name);
    const m = await mtimeMs(p);
    if (m !== null && now - m > TEMP_DIR_MAX_AGE_MS) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

export async function runCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    staleUploads: 0,
    drafts: 0,
    exportFiles: 0,
    rateLimitRows: 0,
    jobs: 0,
    tempDirs: 0,
    errors: [],
  };
  const step = async <K extends keyof Omit<CleanupResult, 'errors'>>(key: K, fn: () => Promise<number>) => {
    try {
      result[key] = await fn();
    } catch (err) {
      const msg = `${key}: ${describeError(err, 300)}`;
      result.errors.push(msg);
      console.error('[pipeline] cleanup step failed', { step: key, error: describeError(err, 300) });
    }
  };
  // stale uploads first, so drafts they belonged to become purgeable in the same run
  await step('staleUploads', () => purgeStaleUploads());
  await step('drafts', () => purgeOldDrafts());
  await step('exportFiles', () => purgeOldExports());
  await step('rateLimitRows', () => purgeRateLimits());
  await step('jobs', () => purgeFinishedJobs(FINISHED_JOB_MAX_AGE_DAYS));
  await step('tempDirs', () => purgeFrameTempDirs());
  console.info('[pipeline] cleanup done', result);
  if (result.errors.length > 0 && result.errors.length === 6) {
    throw new Error(`cleanup failed: ${result.errors.join('; ')}`);
  }
  return result;
}

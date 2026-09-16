/**
 * File-system layout under STORAGE_DIR (shared bind mount between web + worker):
 *
 *   uploads/<collectionId>/<videoId>.<ext>          original upload (deleted after processing by default)
 *   frames/<collectionId>/<videoId>/<idx>.jpg       analysed key frame (full res, long edge FRAME_MAX_EDGE)
 *   frames/<collectionId>/<videoId>/<idx>_t.jpg     thumbnail (long edge 480)
 *   spines/<collectionId>/<bookId>.jpg              cropped spine photo
 *   covers/<collectionId>/<bookId>.jpg              cached cover image
 *   exports/<collectionId>/<name>                   temporary export files for e-mail attachments
 *
 * DB columns store paths RELATIVE to STORAGE_DIR with forward slashes.
 * Browsers load them via /api/media/<relative path> (access-checked).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { storageRoot } from './env';

export const rel = {
  upload: (collectionId: string, videoId: string, ext: string) => `uploads/${collectionId}/${videoId}${ext}`,
  frame: (collectionId: string, videoId: string, idx: number) =>
    `frames/${collectionId}/${videoId}/${String(idx).padStart(4, '0')}.jpg`,
  frameThumb: (collectionId: string, videoId: string, idx: number) =>
    `frames/${collectionId}/${videoId}/${String(idx).padStart(4, '0')}_t.jpg`,
  spine: (collectionId: string, bookId: string) => `spines/${collectionId}/${bookId}.jpg`,
  cover: (collectionId: string, bookId: string) => `covers/${collectionId}/${bookId}.jpg`,
  exportFile: (collectionId: string, name: string) => `exports/${collectionId}/${name}`,
  collectionDirs: (collectionId: string) =>
    ['uploads', 'frames', 'spines', 'covers', 'exports'].map((d) => `${d}/${collectionId}`),
};

/** Absolute path for a relative storage path; throws on traversal attempts. */
export function abs(relativePath: string): string {
  const root = storageRoot();
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Path escapes storage root');
  }
  return full;
}

export async function ensureDirFor(relativePath: string): Promise<string> {
  const full = abs(relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  return full;
}

/** Public URL for a stored file (served by src/app/api/media/[...path]/route.ts). */
export function mediaUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return `/api/media/${relativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

export async function removeCollectionFiles(collectionId: string): Promise<void> {
  await Promise.all(
    rel.collectionDirs(collectionId).map((d) => fs.rm(abs(d), { recursive: true, force: true }).catch(() => {})),
  );
}

/**
 * Per-key in-process mutex (owner: api). Serialises chunk writes, completion and deletion of one
 * upload inside this Node.js process. Stored on globalThis so every route bundle (and dev hot
 * reloads) share the same lock table.
 */

declare global {
  // eslint-disable-next-line no-var
  var __exlUploadLocks: Map<string, Promise<void>> | undefined;
}

function table(): Map<string, Promise<void>> {
  if (!globalThis.__exlUploadLocks) globalThis.__exlUploadLocks = new Map();
  return globalThis.__exlUploadLocks;
}

/** Runs `fn` after every previously queued holder of `key` has finished. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = table();
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  locks.set(key, tail);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export const uploadLockKey = (videoId: string) => `upload:${videoId}`;

/** Number of keys currently held or waited on (tests / diagnostics). */
export function activeLockCount(): number {
  return table().size;
}

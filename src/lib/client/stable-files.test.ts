import { describe, expect, it } from 'vitest';
import { copyPickedFiles, pickedFilesNeedCopies, releaseStableCopy, stableCopyError, stableCopyKind } from './stable-files';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 7) % 256);
const picked = (name = 'VID_20260916.mp4', n = 3000) => new File([bytes(n)], name, { type: 'video/mp4', lastModified: 1_758_000_000_000 });

/** A picked file whose content cannot be read any more (what Chrome on Android does after a moment). */
function unreadable(name = 'gone.mp4'): File {
  const file = picked(name);
  Object.defineProperty(file, 'stream', {
    value: () =>
      new ReadableStream({
        pull() {
          throw new DOMException('The requested file could not be read', 'NotReadableError');
        },
      }),
  });
  return file;
}

/** In-memory stand-in for the origin-private file system. */
function fakeOpfs() {
  const stored = new Map<string, Uint8Array<ArrayBuffer>>();
  const folder = {
    async getFileHandle(name: string) {
      return {
        async createWritable() {
          const chunks: Uint8Array[] = [];
          return new WritableStream<Uint8Array>({
            write(chunk) {
              chunks.push(chunk);
            },
            close() {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const all = new Uint8Array(total);
              let at = 0;
              for (const c of chunks) {
                all.set(c, at);
                at += c.length;
              }
              stored.set(name, all);
            },
          });
        },
        async getFile() {
          return new File([stored.get(name) ?? new Uint8Array()], name);
        },
      };
    },
    async removeEntry(name: string) {
      stored.delete(name);
    },
    async *entries() {
      for (const name of stored.keys()) yield [name, {}] as [string, unknown];
    },
  };
  const root = { getDirectoryHandle: async () => folder };
  return { stored, getDirectory: async () => root as never };
}

describe('pickedFilesNeedCopies', () => {
  it('copies only on Android', () => {
    expect(pickedFilesNeedCopies('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/152.0.0.0 Mobile Safari/537.36')).toBe(true);
    expect(pickedFilesNeedCopies('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)')).toBe(false);
    expect(pickedFilesNeedCopies('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0')).toBe(false);
  });
});

describe('copyPickedFiles', () => {
  it('keeps the originals where picked files stay readable', async () => {
    const file = picked();
    const [same] = await copyPickedFiles([file]);
    expect(same).toBe(file);
    expect(stableCopyKind(same)).toBe('original');
  });

  it('copies into the origin-private file system and deletes the copy when released', async () => {
    const opfs = fakeOpfs();
    const file = picked();
    const [copy] = await copyPickedFiles([file], { force: true, getDirectory: opfs.getDirectory });
    expect(copy).not.toBe(file);
    expect(stableCopyKind(copy)).toBe('opfs');
    expect([copy.name, copy.type, copy.lastModified, copy.size]).toEqual([file.name, file.type, file.lastModified, file.size]);
    expect(new Uint8Array(await copy.arrayBuffer())).toEqual(bytes(3000));
    expect(opfs.stored.size).toBe(1);
    await releaseStableCopy(copy, { getDirectory: opfs.getDirectory });
    expect(opfs.stored.size).toBe(0);
  });

  it('copies into memory without OPFS, but not beyond the memory limit', async () => {
    const [small, big] = await copyPickedFiles([picked('a.mp4', 500), picked('b.mp4', 2000)], {
      force: true,
      getDirectory: null,
      memoryMaxBytes: 1000,
    });
    expect(stableCopyKind(small)).toBe('memory');
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(bytes(500));
    expect(stableCopyKind(big)).toBe('original');
    expect(big.name).toBe('b.mp4');
  });

  it('hands back the original with the reason when the file cannot be read', async () => {
    const opfs = fakeOpfs();
    const bad = unreadable();
    const good = picked('ok.mp4');
    const [first, second] = await copyPickedFiles([bad, good], { force: true, getDirectory: opfs.getDirectory });
    expect(first).toBe(bad);
    expect(stableCopyError(bad)).toContain('NotReadableError');
    expect(stableCopyKind(second)).toBe('opfs');
    // the half-written copy of the unreadable file is not left behind
    expect(opfs.stored.size).toBe(1);
  });

  it('removes copies left behind by closed tabs after a day', async () => {
    const opfs = fakeOpfs();
    opfs.stored.set(`${Date.now() - 2 * 24 * 3600 * 1000}-old`, new Uint8Array(3));
    opfs.stored.set(`${Date.now() - 60 * 1000}-recent`, new Uint8Array(3));
    await copyPickedFiles([picked()], { force: true, getDirectory: opfs.getDirectory });
    await new Promise((r) => setTimeout(r, 10));
    const names = [...opfs.stored.keys()];
    expect(names.some((n) => n.endsWith('-old'))).toBe(false);
    expect(names.some((n) => n.endsWith('-recent'))).toBe(true);
    expect(names).toHaveLength(2);
  });
});

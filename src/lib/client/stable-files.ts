/**
 * Stable copies of picked files (client-only).
 *
 * Chrome on Android loses read access to a file picked from the gallery / photo picker a few moments after
 * the pick: reading it at once works, reading it after the catalogue and the upload session were created
 * fails with NotReadableError ("…permission problems that have occurred after a reference to a file was
 * acquired", ERR_UPLOAD_FILE_CHANGED – crbug.com/40123366). So every picked file is opened in the event that
 * delivered it and copied into the origin-private file system (OPFS), or into memory when OPFS is missing
 * and the file is small enough; the upload reads the copy. Copies are deleted when their upload is finished,
 * canceled or removed, and leftovers of closed tabs after a day.
 */

const DIR = 'exl-picked';
/** without OPFS, files up to this size are copied into memory */
export const MEMORY_COPY_MAX_BYTES = 200 * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;

export type StableCopyKind = 'opfs' | 'memory' | 'original';

const kinds = new WeakMap<Blob, StableCopyKind>();
const opfsNames = new WeakMap<Blob, string>();
const copyErrors = new WeakMap<Blob, string>();

/** How the upload source of a picked file was made ('original' when no copy was made). */
export function stableCopyKind(file: Blob): StableCopyKind {
  return kinds.get(file) ?? 'original';
}

/** Why the copy of a picked file failed, when it did (diagnostics). */
export function stableCopyError(file: Blob): string | undefined {
  return copyErrors.get(file);
}

/** Only Chrome on Android drops access to picked files; elsewhere the original is uploaded directly. */
export function pickedFilesNeedCopies(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android/i.test(userAgent);
}

type DirectoryHandle = Pick<FileSystemDirectoryHandle, 'getFileHandle' | 'removeEntry'> & {
  entries?: () => AsyncIterable<[string, unknown]>;
};

export interface CopyOptions {
  /** copy even when pickedFilesNeedCopies() says no (tests) */
  force?: boolean;
  /** OPFS root provider (default navigator.storage.getDirectory) – null disables OPFS */
  getDirectory?: (() => Promise<DirectoryHandle>) | null;
  memoryMaxBytes?: number;
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && 'message' in err) {
    return `${String((err as Error).name)}: ${String((err as Error).message)}`.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

async function pickedDir(opts: CopyOptions): Promise<DirectoryHandle | null> {
  try {
    const getRoot =
      opts.getDirectory === undefined
        ? typeof navigator !== 'undefined' && navigator.storage?.getDirectory
          ? () => navigator.storage.getDirectory()
          : null
        : opts.getDirectory;
    if (!getRoot) return null;
    const root = (await getRoot()) as unknown as FileSystemDirectoryHandle;
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return null;
  }
}

/** A stream of the file whose first read has already started (the file is opened in the current task). */
function openNow(file: File): ReadableStream<Uint8Array> {
  const reader = file.stream().getReader();
  const first = reader.read();
  // an unobserved rejection would be reported before the copy awaits it
  first.catch(() => undefined);
  let firstTaken = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = firstTaken ? await reader.read() : await first;
      firstTaken = true;
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function copyOne(file: File, stream: ReadableStream<Uint8Array>, dir: Promise<DirectoryHandle | null>, opts: CopyOptions): Promise<File> {
  const folder = await dir;
  if (folder) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const handle = await folder.getFileHandle(name, { create: true });
    if (typeof handle.createWritable === 'function') {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        writable = await handle.createWritable();
        await stream.pipeTo(writable);
        const stored = await handle.getFile();
        const stable = new File([stored], file.name, { type: file.type, lastModified: file.lastModified });
        kinds.set(stable, 'opfs');
        opfsNames.set(stable, name);
        return stable;
      } catch (err) {
        await writable?.abort().catch(() => undefined);
        await folder.removeEntry(name).catch(() => undefined);
        throw err;
      }
    }
    await folder.removeEntry(name).catch(() => undefined);
  }
  if (file.size <= (opts.memoryMaxBytes ?? MEMORY_COPY_MAX_BYTES)) {
    const buffer = await new Response(stream).arrayBuffer();
    const stable = new File([buffer], file.name, { type: file.type, lastModified: file.lastModified });
    kinds.set(stable, 'memory');
    return stable;
  }
  await stream.cancel().catch(() => undefined);
  return file;
}

async function purgeStale(dir: Promise<DirectoryHandle | null>): Promise<void> {
  const folder = await dir;
  if (!folder?.entries) return;
  try {
    const stale: string[] = [];
    for await (const [name] of folder.entries()) {
      const createdAt = Number.parseInt(name.split('-')[0], 10);
      if (Number.isFinite(createdAt) && Date.now() - createdAt > STALE_MS) stale.push(name);
    }
    await Promise.all(stale.map((name) => folder.removeEntry(name).catch(() => undefined)));
  } catch {
    /* best effort */
  }
}

/**
 * Opens every picked file right away and resolves with the files to upload, in the same order: the stable
 * copy, or the original when no copy could be made (the upload then reports why it cannot read it).
 * Call it in the input's change handler, before anything else awaits.
 */
export function copyPickedFiles(files: readonly File[], opts: CopyOptions = {}): Promise<File[]> {
  if (files.length === 0 || (!opts.force && !pickedFilesNeedCopies())) return Promise.resolve([...files]);
  const streams = files.map((file) => {
    try {
      return openNow(file);
    } catch (err) {
      copyErrors.set(file, describe(err));
      return null;
    }
  });
  const dir = pickedDir(opts);
  void purgeStale(dir);
  return Promise.all(
    files.map((file, i) => {
      const stream = streams[i];
      if (!stream) return Promise.resolve(file);
      return copyOne(file, stream, dir, opts).catch((err: unknown) => {
        copyErrors.set(file, describe(err));
        return file;
      });
    }),
  );
}

/** Deletes the OPFS copy behind an upload source (no-op for other files). */
export async function releaseStableCopy(file: Blob, opts: Pick<CopyOptions, 'getDirectory'> = {}): Promise<void> {
  const name = opfsNames.get(file);
  if (!name) return;
  opfsNames.delete(file);
  const folder = await pickedDir(opts);
  await folder?.removeEntry(name).catch(() => undefined);
}

'use client';

/**
 * Lazy, module-level cache of GET /api/collections/:id/frames (frames + detection boxes), shared by
 * the book drawer, review mode and the merge flow. One request per collection "version" (changes
 * when a source finishes processing); stale data stays visible while a newer version loads.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/client/api';
import type { CollectionDTO, FrameDTO } from '@/lib/types';
import type { FramesPayload } from './book-form-utils';

export interface FramesData extends FramesPayload {
  byId: ReadonlyMap<string, FrameDTO>;
}

interface Entry {
  status: 'loading' | 'ready' | 'error';
  version: string;
  data: FramesData | null;
  error: unknown;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Version string of the frame set: changes whenever a source's processing state / frame count changes. */
export function framesVersion(collection: Pick<CollectionDTO, 'videos'>): string {
  return collection.videos
    .map((v) => `${v.id}:${v.status}:${v.framesTotal}`)
    .sort()
    .join('|');
}

function index(payload: FramesPayload): FramesData {
  return {
    frames: payload.frames ?? [],
    detections: payload.detections ?? [],
    byId: new Map((payload.frames ?? []).map((f) => [f.id, f])),
  };
}

/** Starts loading unless a request for this version is already done or in flight (`force` reloads). */
export function loadFrames(collectionId: string, version: string, opts: { force?: boolean } = {}): void {
  const current = entries.get(collectionId);
  if (current && current.version === version && !opts.force && current.status !== 'error') return;
  if (current && current.version === version && current.status === 'loading') return;
  const entry: Entry = { status: 'loading', version, data: current?.data ?? null, error: null };
  entries.set(collectionId, entry);
  emit();
  api
    .getFrames(collectionId)
    .then((payload) => {
      if (entries.get(collectionId) !== entry) return;
      entries.set(collectionId, { status: 'ready', version, data: index(payload), error: null });
      emit();
    })
    .catch((error: unknown) => {
      if (entries.get(collectionId) !== entry) return;
      console.info('[book] frames request failed', { collectionId, message: error instanceof Error ? error.message : String(error) });
      entries.set(collectionId, { status: 'error', version, data: entry.data, error });
      emit();
    });
}

/** Drops the cached frames (e.g. after a merge moved detections); mounted consumers reload. */
export function invalidateFrames(collectionId: string): void {
  if (!entries.delete(collectionId)) return;
  emit();
}

export interface FramesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: FramesData | null;
  retry: () => void;
}

/** Frames of a collection, fetched lazily the first time `enabled` is true. */
export function useCollectionFrames(collectionId: string, version: string, enabled = true): FramesState {
  const entry = useSyncExternalStore(
    subscribe,
    () => entries.get(collectionId),
    () => undefined,
  );
  const stale = !entry || entry.version !== version;
  useEffect(() => {
    if (enabled && stale) loadFrames(collectionId, version);
  }, [collectionId, version, enabled, stale]);
  const retry = useCallback(() => loadFrames(collectionId, version, { force: true }), [collectionId, version]);

  if (!entry) return { status: enabled ? 'loading' : 'idle', data: null, retry };
  // a newer version is on its way: keep showing the old frames meanwhile
  if (stale) return { status: entry.data ? 'ready' : enabled ? 'loading' : 'idle', data: entry.data, retry };
  return { status: entry.status, data: entry.data, retry };
}

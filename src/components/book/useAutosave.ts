'use client';

/**
 * Debounced autosave of one free-text book field (notes, lent to).
 * - typing updates a local draft; after `delay` ms of quiet the value is saved
 * - blur / switching to another book / unmount flush the pending value immediately
 * - server-side changes replace the draft only while the user has no unsaved edit, and only when
 *   they differ after normalisation (the API trims text: a trailing space or new line the user
 *   just typed must survive the save round trip)
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions {
  /** identity of the record – switching flushes the old draft to the old id */
  recordId: string;
  /** current value from the server / optimistic store ('' for null) */
  serverValue: string;
  /** persists the value; resolves true on success */
  save: (recordId: string, value: string) => Promise<boolean>;
  delay?: number;
  /** values equal after normalisation are not re-saved (default: trim) */
  normalize?: (value: string) => string;
}

export interface UseAutosaveResult {
  value: string;
  setValue: (value: string) => void;
  status: AutosaveStatus;
  /** save now (blur / Enter) */
  flush: () => void;
  /** retry after an error */
  retry: () => void;
  /** replace the draft and the saved baseline without saving (e.g. after a separate "clear" request) */
  reset: (value: string) => void;
}

const defaultNormalize = (v: string) => v.trim();

const STATUS_WEIGHT: Record<AutosaveStatus, number> = { idle: 0, saved: 1, pending: 2, saving: 3, error: 4 };

/** One indicator for several autosaved fields: the most important state wins (error > saving > pending > saved). */
export function combineAutosaveStatus(...statuses: AutosaveStatus[]): AutosaveStatus {
  return statuses.reduce<AutosaveStatus>((best, s) => (STATUS_WEIGHT[s] > STATUS_WEIGHT[best] ? s : best), 'idle');
}

export function useAutosave({ recordId, serverValue, save, delay = 800, normalize = defaultNormalize }: UseAutosaveOptions): UseAutosaveResult {
  const [value, setValueState] = useState(serverValue);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  // another record: show its value in this very render (no flash of the previous record's text);
  // the refs are switched – and the old draft flushed – in the layout effect below
  const [shownRecord, setShownRecord] = useState(recordId);
  if (shownRecord !== recordId) {
    setShownRecord(recordId);
    setValueState(serverValue);
    setStatus('idle');
  }

  const draftRef = useRef(serverValue);
  const savedRef = useRef(serverValue);
  const idRef = useRef(recordId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(0);
  const savedRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const commit = useCallback((id: string, next: string) => {
    clearTimer();
    if (normalizeRef.current(next) === normalizeRef.current(savedRef.current)) {
      if (mountedRef.current && id === idRef.current) setStatus((s) => (s === 'pending' ? 'idle' : s));
      return;
    }
    const request = ++inFlightRef.current;
    if (mountedRef.current && id === idRef.current) setStatus('saving');
    void saveRef
      .current(id, next)
      .then((ok) => ok, () => false)
      .then((ok) => {
        // an older answer arriving after a newer one must not move the baseline back
        if (id === idRef.current && ok && request > savedRequestRef.current) {
          savedRequestRef.current = request;
          savedRef.current = next;
        }
        // a newer save for the same record owns the status
        if (!mountedRef.current || id !== idRef.current || request !== inFlightRef.current) return;
        if (!ok) {
          setStatus('error');
          return;
        }
        if (draftRef.current !== next) {
          setStatus('pending');
          return;
        }
        setStatus('saved');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setStatus((s) => (s === 'saved' ? 'idle' : s));
        }, 2500);
      });
  }, []);

  // switching records: flush the previous record's pending draft to that record, then track the new one
  useIsoLayoutEffect(() => {
    if (idRef.current === recordId) return;
    const prevId = idRef.current;
    const prevDraft = draftRef.current;
    const prevSaved = savedRef.current;
    const hadPending = timerRef.current !== null;
    clearTimer();
    idRef.current = recordId;
    draftRef.current = serverValue;
    savedRef.current = serverValue;
    // fire and forget: the status shown belongs to the new record (a failure toasts in the provider)
    if (hadPending && normalizeRef.current(prevDraft) !== normalizeRef.current(prevSaved)) {
      void saveRef.current(prevId, prevDraft).catch(() => false);
    }
  }, [recordId, serverValue]);

  // server value changed (optimistic update, save answer, refresh): adopt it unless the user is editing
  useEffect(() => {
    if (idRef.current !== recordId) return;
    const norm = normalizeRef.current;
    const dirty = timerRef.current !== null || norm(draftRef.current) !== norm(savedRef.current);
    if (dirty) return;
    savedRef.current = serverValue;
    // same text after normalisation (e.g. the API trimmed "notes⏎" to "notes"): keep what the user sees
    if (norm(draftRef.current) === norm(serverValue)) return;
    draftRef.current = serverValue;
    setValueState(serverValue);
  }, [serverValue, recordId]);

  // unmount: flush
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const next = draftRef.current;
        if (normalizeRef.current(next) !== normalizeRef.current(savedRef.current)) void saveRef.current(idRef.current, next).catch(() => false);
      }
    };
  }, []);

  const setValue = useCallback(
    (next: string) => {
      draftRef.current = next;
      setValueState(next);
      clearTimer();
      setStatus('pending');
      const id = idRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        commit(id, draftRef.current);
      }, delay);
    },
    [commit, delay],
  );

  const flush = useCallback(() => {
    if (timerRef.current === null) return;
    commit(idRef.current, draftRef.current);
  }, [commit]);

  const retry = useCallback(() => commit(idRef.current, draftRef.current), [commit]);

  const reset = useCallback((next: string) => {
    clearTimer();
    draftRef.current = next;
    savedRef.current = next;
    setValueState(next);
    setStatus('idle');
  }, []);

  return { value, setValue, status, flush, retry, reset };
}

import { describe, expect, it } from 'vitest';
import { isAbortError, nextFullHour, payloadSummary } from './helpers';

describe('worker helpers', () => {
  it('nextFullHour rounds up to the next UTC hour', () => {
    expect(nextFullHour(new Date('2026-09-13T10:15:30.123Z')).toISOString()).toBe('2026-09-13T11:00:00.000Z');
    expect(nextFullHour(new Date('2026-09-13T10:00:00.000Z')).toISOString()).toBe('2026-09-13T11:00:00.000Z');
    expect(nextFullHour(new Date('2026-12-31T23:59:59.000Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('payloadSummary never includes recipient addresses', () => {
    const s = payloadSummary({ payload: { kind: 'export', to: 'someone@example.com', collectionId: '123', _dedupe: 'x' } });
    expect(s).toEqual({ kind: 'export', collectionId: '123' });
  });

  it('isAbortError', () => {
    const e = new Error('x');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

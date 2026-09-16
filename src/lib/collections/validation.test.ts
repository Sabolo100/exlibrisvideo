import { describe, expect, it } from 'vitest';
import { bookPatchSchema, claimSchema, collectionPatchSchema, emailExportSchema, mergeBooksSchema, normalizeEmail } from './validation';

describe('normalizeEmail', () => {
  it('trims, lower-cases and accepts common valid addresses', () => {
    expect(normalizeEmail('  Kata.Konyv+polc@Example.HU ')).toBe('kata.konyv+polc@example.hu');
    expect(normalizeEmail("o'brien@example.ie")).toBe("o'brien@example.ie");
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it('refuses malformed and header-injection attempts', () => {
    for (const bad of [
      'plain',
      'a@b',
      'a@@b.hu',
      'a b@c.hu',
      'a@b.hu, c@d.hu',
      'a@b.hu;c@d.hu',
      'a@b.hu\r\nBcc: x@y.hu',
      '"Kata" <kata@example.com>',
      `${'x'.repeat(250)}@example.com`,
    ]) {
      expect(normalizeEmail(bad), bad).toBe(false);
    }
  });
});

describe('schemas', () => {
  it('bookPatchSchema strips unknown keys and normalises text', () => {
    const parsed = bookPatchSchema.parse({ title: ' T ', subtitle: '  ', collectionId: '123456789', id: 'x', source: 'manual' });
    expect(parsed).toEqual({ title: 'T', subtitle: null });
  });

  it('collectionPatchSchema / claimSchema / mergeBooksSchema / emailExportSchema', () => {
    expect(collectionPatchSchema.safeParse({ visibility: 'public' }).success).toBe(false);
    expect(collectionPatchSchema.parse({ title: '', locale: 'en' })).toEqual({ title: null, locale: 'en' });
    expect(claimSchema.safeParse({}).success).toBe(false);
    expect(claimSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' });
    expect(claimSchema.parse({ recovery: '1.x' })).toEqual({ recovery: '1.x' });
    expect(mergeBooksSchema.safeParse({ keepId: 'x', mergeIds: [] }).success).toBe(false);
    expect(emailExportSchema.parse({ formats: ['pdf', 'pdf', 'xlsx'] })).toEqual({ formats: ['pdf', 'xlsx'] });
    expect(emailExportSchema.safeParse({ formats: [] }).success).toBe(false);
  });
});

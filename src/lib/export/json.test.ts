import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS } from '@/lib/types';
import { buildExport } from './index';
import type { JsonExport } from './json';
import { makeSampleCollection } from './testing/sample-collection';

describe('JSON export', () => {
  it('writes a pretty, versioned snapshot with absolute media URLs', async () => {
    const c = makeSampleCollection();
    const now = new Date('2026-09-13T08:00:00.000Z');
    const file = await buildExport(c, 'json', 'hu', { isOwner: true, now });
    expect(file.filename).toBe('exlibris-334345435.json');
    expect(file.contentType).toBe('application/json; charset=utf-8');
    const text = file.body.toString('utf8');
    expect(text).toContain('\n  "schema": "exlibrisvideo/1"');
    const data = JSON.parse(text) as JsonExport;
    expect(data.schema).toBe('exlibrisvideo/1');
    expect(data.exportedAt).toBe(now.toISOString());
    expect(data.collection).toMatchObject({ id: '334345435', url: 'https://www.exlibrisvideo.hu/334345435', bookCount: c.books.length });
    expect(data.books).toHaveLength(c.books.length);
    // shelf order
    expect(data.books.map((b) => b.shelfPosition)).toEqual([...data.books.map((b) => b.shelfPosition)].sort((a, b) => a - b));
    const local = data.books.find((b) => b.coverImage?.includes('/api/media/'));
    expect(local?.coverImage).toMatch(/^https:\/\/www\.exlibrisvideo\.hu\/api\/media\//);
    const first = data.books[0];
    expect(first.title).toBe('Az ajtó');
    expect(first.categoryLabel).toBe('Magyar irodalom');
    expect(first.authors).toEqual(['Szabó Magda']);
    expect('notes' in first).toBe(true);
  });

  it('omits owner-only fields for viewers', async () => {
    const c = makeSampleCollection({ isOwner: false });
    const data = JSON.parse((await buildExport(c, 'json', 'en')).body.toString('utf8')) as JsonExport;
    expect(data.books.some((b) => 'notes' in b || 'lentTo' in b || 'lentAt' in b)).toBe(false);
    expect(data.books[0].categoryLabel).toBe('Hungarian literature');
  });
});

describe('buildExport dispatch', () => {
  it('produces every format with the right name and type', async () => {
    const c = makeSampleCollection({ bookCount: 5 });
    const expected: Record<string, [string, string]> = {
      xlsx: ['exlibris-334345435.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      csv: ['exlibris-334345435.csv', 'text/csv; charset=utf-8'],
      json: ['exlibris-334345435.json', 'application/json; charset=utf-8'],
      pdf: ['exlibris-334345435.pdf', 'application/pdf'],
      goodreads: ['exlibris-334345435-goodreads.csv', 'text/csv; charset=utf-8'],
    };
    for (const format of EXPORT_FORMATS) {
      const file = await buildExport(c, format, 'en');
      expect([file.filename, file.contentType]).toEqual(expected[format]);
      expect(file.body.length).toBeGreaterThan(50);
    }
  });

  it('rejects unknown formats', async () => {
    const c = makeSampleCollection({ bookCount: 1 });
    await expect(buildExport(c, 'docx' as never, 'hu')).rejects.toThrow(/Unsupported export format/);
  });
});

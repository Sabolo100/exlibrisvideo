import { describe, expect, it } from 'vitest';
import { buildExport } from './index';
import { csvDelimiter, escapeCsvField, guardFormula, toCsv } from './csv';
import { makeSampleCollection } from './testing/sample-collection';

const BOM = '\uFEFF';

/** Minimal RFC 4180 parser used to verify the writer round-trips. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe('guardFormula', () => {
  it.each(['=SUM(A1)', '+36 1 234', '-2', '@cmd', '\tx', '\rx'])('prefixes %j with an apostrophe', (v) => {
    expect(guardFormula(v)).toBe(`'${v}`);
  });
  it('leaves normal text alone', () => {
    expect(guardFormula('Az ajtó')).toBe('Az ajtó');
    expect(guardFormula('1984')).toBe('1984');
    expect(guardFormula("it's = fine")).toBe("it's = fine");
  });
});

describe('escapeCsvField', () => {
  it('quotes fields with delimiter, quotes and line breaks (RFC 4180)', () => {
    expect(escapeCsvField('a;b', ';')).toBe('"a;b"');
    expect(escapeCsvField('a;b', ',')).toBe('a;b');
    expect(escapeCsvField('Piszkos Fred, a kapitány', ',')).toBe('"Piszkos Fred, a kapitány"');
    expect(escapeCsvField('say "hi"', ',')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2', ',')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2', ';')).toBe('"line1\r\nline2"');
  });
  it('renders numbers and empty values', () => {
    expect(escapeCsvField(1987, ';')).toBe('1987');
    expect(escapeCsvField(null, ';')).toBe('');
    expect(escapeCsvField(undefined, ';')).toBe('');
    expect(escapeCsvField(Number.NaN, ';')).toBe('');
  });
  it('guards formulas and still quotes when needed', () => {
    expect(escapeCsvField('=HYPERLINK("http://x";"y")', ';')).toBe('"\'=HYPERLINK(""http://x"";""y"")"');
  });
});

describe('toCsv', () => {
  it('writes a UTF-8 BOM and CRLF line endings', () => {
    const buf = toCsv(
      [
        ['a', 'b'],
        ['ő', 'ű'],
      ],
      { delimiter: ';' },
    );
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buf.toString('utf8')).toBe(`${BOM}a;b\r\nő;ű\r\n`);
  });
  it('can omit the BOM', () => {
    expect(toCsv([['x']], { delimiter: ',', bom: false }).toString('utf8')).toBe('x\r\n');
  });
});

describe('CSV export', () => {
  it('uses ";" for Hungarian and "," for English', () => {
    expect(csvDelimiter('hu')).toBe(';');
    expect(csvDelimiter('en')).toBe(',');
  });

  it('builds a Hungarian CSV that round-trips with accents, quoting and the injection guard', async () => {
    const c = makeSampleCollection();
    const file = await buildExport(c, 'csv', 'hu', { isOwner: true });
    expect(file.filename).toBe('exlibris-334345435.csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    const text = file.body.toString('utf8');
    expect(text.startsWith(BOM)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/(?<!")\n/);
    const rows = parseCsv(text.slice(1), ';');
    expect(rows).toHaveLength(c.books.length + 1);
    const header = rows[0];
    expect(header.slice(0, 3)).toEqual(['Szerző', 'Cím', 'Alcím']);
    expect(header).toContain('Jegyzetek');
    expect(header).toContain('Kölcsönvevő');
    expect(rows.every((r) => r.length === header.length)).toBe(true);

    const titleIdx = header.indexOf('Cím');
    const authorIdx = header.indexOf('Szerző');
    const titles = rows.slice(1).map((r) => r[titleIdx]);
    expect(titles).toContain('2001: Űrodüsszeia');
    expect(titles).toContain('Őrizetlenek');
    expect(titles).toContain('Piszkos Fred, a kapitány');
    expect(rows.slice(1).map((r) => r[authorIdx])).toContain('Kosztolányi Dezső');

    const notes = rows.slice(1).map((r) => r[header.indexOf('Jegyzetek')]).filter(Boolean);
    expect(notes[0]).toBe('Nagymamától kaptam; "dedikált" példány, =SUM(A1) nem képlet');

    const statusIdx = header.indexOf('Olvasottság');
    expect(new Set(rows.slice(1).map((r) => r[statusIdx]))).toEqual(
      new Set(['Elolvasva', '', 'Várólistán', 'Olvasás alatt', 'Félbehagyva']),
    );
  });

  it('guards cells that start with a formula character', async () => {
    const c = makeSampleCollection({ bookCount: 2 });
    c.books[0].title = '=cmd|" /C calc"!A0';
    c.books[1].title = '@SUM(1+1)';
    const file = await buildExport(c, 'csv', 'en', { isOwner: false });
    const rows = parseCsv(file.body.toString('utf8').slice(1), ',');
    const titleIdx = rows[0].indexOf('Title');
    const titles = rows.slice(1).map((r) => r[titleIdx]);
    expect(titles).toContain(`'=cmd|" /C calc"!A0`);
    expect(titles).toContain(`'@SUM(1+1)`);
  });

  it('omits owner-only columns for non-owners (English, comma separated)', async () => {
    const c = makeSampleCollection({ isOwner: false });
    const file = await buildExport(c, 'csv', 'en');
    const rows = parseCsv(file.body.toString('utf8').slice(1), ',');
    expect(rows[0]).toContain('Author');
    expect(rows[0]).not.toContain('Notes');
    expect(rows[0]).not.toContain('Lent to');
    expect(rows[0]).not.toContain('Lent on');
    expect(rows).toHaveLength(c.books.length + 1);
  });

  it('handles an empty collection', async () => {
    const c = makeSampleCollection({ bookCount: 0 });
    const file = await buildExport(c, 'csv', 'hu');
    const text = file.body.toString('utf8');
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});

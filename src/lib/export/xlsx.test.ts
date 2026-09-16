import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildExport } from './index';
import { makeSampleCollection } from './testing/sample-collection';

async function readBook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function rowValues(ws: ExcelJS.Worksheet, row: number): unknown[] {
  const values = ws.getRow(row).values as unknown[];
  return values.slice(1);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text);
  if (typeof v === 'object' && 'richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
  return String(v);
}

describe('XLSX export', () => {
  it('builds localized Hungarian sheets that re-read intact', async () => {
    const c = makeSampleCollection();
    const now = new Date('2026-09-13T08:00:00.000Z');
    const file = await buildExport(c, 'xlsx', 'hu', { isOwner: true, now });
    expect(file.filename).toBe('exlibris-334345435.xlsx');
    expect(file.body.subarray(0, 2).toString('latin1')).toBe('PK');

    const wb = await readBook(file.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Könyvek', 'Szerzők', 'Témák', 'Összegzés']);
    expect(wb.creator).toBe('Ex Libris Video');
    expect(wb.created?.toISOString()).toBe(now.toISOString());
    expect(wb.title).toBe(c.title);

    const books = wb.getWorksheet('Könyvek')!;
    const header = rowValues(books, 1);
    expect(header).toEqual([
      '#',
      'Szerző',
      'Cím',
      'Alcím',
      'Eredeti cím',
      'Sorozat',
      'Kiadó',
      'Első megjelenés',
      'Kiadás éve',
      'Nyelv',
      'Téma',
      'További témák',
      'Olvasottság',
      'Értékelés',
      'Kedvenc',
      'Jegyzetek',
      'Kölcsönvevő',
      'Kölcsönadás napja',
      'ISBN',
      'Oldalszám',
      'Borítókép (URL)',
      'Felismerés biztossága (%)',
      'Ellenőrizendő',
      'Forrás',
      'Felvéve',
    ]);
    expect(books.actualRowCount).toBe(c.books.length + 1);

    // header styling, frozen pane, autofilter
    const h1 = books.getCell('A1');
    expect((h1.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F4D3A');
    expect(h1.font?.color?.argb).toBe('FFFBF6EC');
    expect(h1.font?.bold).toBe(true);
    expect(books.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(books.autoFilter).toBeTruthy();

    // Hungarian characters intact
    const titles = new Set<string>();
    const authors = new Set<string>();
    for (let r = 2; r <= books.actualRowCount; r++) {
      titles.add(cellText(books.getCell(r, 3).value));
      authors.add(cellText(books.getCell(r, 2).value));
    }
    expect(titles.has('2001: Űrodüsszeia')).toBe(true);
    expect(titles.has('Őrizetlenek')).toBe(true);
    expect(titles.has('A Négyszögletű Kerek Erdő')).toBe(true);
    expect(authors.has('Kosztolányi Dezső')).toBe(true);

    // number formats and typed values
    const second = books.getRow(2);
    expect(second.getCell(1).value).toBe(1);
    expect(typeof second.getCell(22).value).toBe('number');
    expect(second.getCell(22).numFmt).toBe('0%');
    expect(second.getCell(25).value).toBeInstanceOf(Date);
    expect(second.getCell(10).value).toBe('magyar');

    // hyperlinks for covers
    let links = 0;
    for (let r = 2; r <= books.actualRowCount; r++) {
      const v = books.getCell(r, 21).value;
      if (v && typeof v === 'object' && 'hyperlink' in v) {
        links++;
        expect((v as ExcelJS.CellHyperlinkValue).hyperlink).toMatch(/^https:\/\//);
      }
    }
    expect(links).toBeGreaterThan(0);

    const topics = wb.getWorksheet('Témák')!;
    expect(rowValues(topics, 1)).toEqual(['Téma', 'Könyvek száma', 'Arány', 'További témaként']);
    const lastRow = topics.actualRowCount;
    expect(topics.getCell(lastRow, 1).value).toBe('Összesen');
    expect(topics.getCell(lastRow, 2).value).toBe(c.books.length);

    const authorsWs = wb.getWorksheet('Szerzők')!;
    expect(rowValues(authorsWs, 1)).toEqual(['Szerző', 'Könyvek száma', 'Címek']);
    expect(authorsWs.getCell(2, 1).value).toMatch(/Szabó Magda|Kosztolányi Dezső/);

    const summary = wb.getWorksheet('Összegzés')!;
    const texts: string[] = [];
    summary.eachRow((row) => row.eachCell((cell) => texts.push(cellText(cell.value))));
    expect(texts).toContain('Ex Libris – könyvtárkatalógus');
    expect(texts).toContain('https://www.exlibrisvideo.hu/334345435');
    expect(texts).toContain('Legtöbb könyvvel szereplő szerzők');
    expect(texts.some((t) => t.startsWith('Készült az Ex Libris Video segítségével'))).toBe(true);
    let linkCell: ExcelJS.Cell | undefined;
    summary.eachRow((row) =>
      row.eachCell((cell) => {
        if (cellText(cell.value) === 'https://www.exlibrisvideo.hu/334345435') linkCell = cell;
      }),
    );
    expect((linkCell?.value as ExcelJS.CellHyperlinkValue).hyperlink).toBe('https://www.exlibrisvideo.hu/334345435');
  });

  it('uses English sheet names and hides owner columns for viewers', async () => {
    const c = makeSampleCollection({ isOwner: false });
    const file = await buildExport(c, 'xlsx', 'en');
    const wb = await readBook(file.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Books', 'Authors', 'Topics', 'Summary']);
    const header = rowValues(wb.getWorksheet('Books')!, 1);
    expect(header).toContain('Recognition confidence (%)');
    expect(header).not.toContain('Notes');
    expect(header).not.toContain('Lent to');
    expect(header).not.toContain('Lent on');
  });

  it('handles an empty collection', async () => {
    const c = makeSampleCollection({ bookCount: 0 });
    const wb = await readBook((await buildExport(c, 'xlsx', 'hu')).body);
    expect(wb.getWorksheet('Könyvek')!.actualRowCount).toBe(1);
    expect(wb.worksheets).toHaveLength(4);
  });
});

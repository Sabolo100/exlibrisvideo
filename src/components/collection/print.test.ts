import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { groupBooksForPrint, printAuthorHeading, printDetails } from './print';

describe('groupBooksForPrint', () => {
  const books = [
    makeSampleBook({ id: '1', title: 'Az ajtó', author: 'Szabó Magda', authorSort: 'szabo magda', shelfPosition: 1 }),
    makeSampleBook({ id: '2', title: 'Abigél', author: 'Szabó Magda', authorSort: 'szabo magda', shelfPosition: 2 }),
    makeSampleBook({ id: '3', title: 'Száz év magány', author: 'Gabriel García Márquez', authorSort: 'garcia marquez gabriel', shelfPosition: 3 }),
    makeSampleBook({ id: '4', title: 'Jegyzetfüzet', author: null, authorSort: null, shelfPosition: 4 }),
    makeSampleBook({ id: '5', title: 'Csillagok', author: 'Csáth Géza', authorSort: 'csath geza', shelfPosition: 5 }),
    makeSampleBook({ id: '6', title: 'Harmonia caelestis', author: 'Esterházy Péter', authorSort: 'esterhazy peter', shelfPosition: 6 }),
    makeSampleBook({ id: '7', title: 'Névtelen', author: '  ', authorSort: null, shelfPosition: 7 }),
  ];

  it('groups by author, family name first, in Hungarian collation, no-author books last', () => {
    const groups = groupBooksForPrint(books, 'hu');
    expect(groups.map((g) => g.author)).toEqual(['Csáth Géza', 'Esterházy Péter', 'García Márquez Gabriel', 'Szabó Magda', null]);
    // Hungarian: "Cs" sorts after "C…" and before "D" – here only relative order matters
    expect(groups.find((g) => g.author === 'Szabó Magda')?.books.map((b) => b.title)).toEqual(['Abigél', 'Az ajtó']);
    expect(groups.at(-1)?.books.map((b) => b.id).sort()).toEqual(['4', '7']);
    expect(groups.at(-1)?.key).toBe('');
  });

  it('merges spellings that fold to the same author', () => {
    const groups = groupBooksForPrint(
      [
        makeSampleBook({ id: 'a', title: 'A', author: 'Szabó Magda', authorSort: 'szabo magda' }),
        makeSampleBook({ id: 'b', title: 'B', author: 'Szabo Magda', authorSort: 'szabo magda' }),
      ],
      'hu',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].books).toHaveLength(2);
  });

  it('returns nothing for an empty list', () => {
    expect(groupBooksForPrint([], 'en')).toEqual([]);
  });
});

describe('printAuthorHeading', () => {
  it('prints family name first but keeps the printed spelling where possible', () => {
    expect(printAuthorHeading({ author: 'Eric Berne', authorSort: 'berne eric' })).toBe('Berne Eric');
    expect(printAuthorHeading({ author: 'Bánki M. Csaba', authorSort: 'banki m csaba' })).toBe('Bánki M. Csaba');
    expect(printAuthorHeading({ author: 'Simon Baron-Cohen', authorSort: 'baroncohen simon' })).toBe('Simon Baron-Cohen');
    expect(printAuthorHeading({ author: 'Frank Herbert; Brian Herbert', authorSort: 'herbert frank' })).toBe('Herbert Frank');
    expect(printAuthorHeading({ author: 'Szabó Magda', authorSort: null })).toBe('Szabó Magda');
    expect(printAuthorHeading({ author: null, authorSort: null })).toBeNull();
  });

  it('is used for the group headings', () => {
    const groups = groupBooksForPrint(
      [
        makeSampleBook({ id: 'x', title: 'Mindblindness', author: 'Simon Baron-Cohen', authorSort: 'baroncohen simon' }),
        makeSampleBook({ id: 'y', title: 'Emberi játszmák', author: 'Eric Berne', authorSort: 'berne eric' }),
      ],
      'hu',
    );
    expect(groups.map((g) => g.author)).toEqual(['Simon Baron-Cohen', 'Berne Eric']);
  });
});

describe('printDetails', () => {
  it('joins year, publisher and series', () => {
    expect(printDetails({ firstPublishedYear: 1965, publisher: ' Európa ', series: 'Dűne-ciklus' })).toBe('1965 · Európa · Dűne-ciklus');
    expect(printDetails({ firstPublishedYear: null, publisher: null, series: '  ' })).toBe('');
  });
});

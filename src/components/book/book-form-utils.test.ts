import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import type { BookDTO, FrameDTO } from '@/lib/types';
import { combineAutosaveStatus } from './useAutosave';
import {
  bboxToPercentRect,
  bookToFormValues,
  defaultSpineTurn,
  diffBookPatch,
  findDuplicates,
  findEvidenceFrame,
  formatTags,
  formatTimecode,
  hasOwnerData,
  isFormDirty,
  isTitlePrefix,
  isUprightCrop,
  isValidIsbn10,
  isValidIsbn13,
  localizedDescription,
  mergeCandidates,
  neighbourIds,
  nextAfterRemoval,
  normalizeIsbn,
  parseOptionalInt,
  parseTags,
  pickDefaultKeep,
  previewMerge,
  rebaseFormValues,
  reviewQueue,
  titleKey,
  todayIsoDate,
  validateBookForm,
  validateIsbn,
} from './book-form-utils';

function book(partial: Partial<BookDTO> & { title: string }): BookDTO {
  return makeSampleBook(partial);
}

describe('ISBN validation', () => {
  it('normalises prefixes, hyphens and spaces', () => {
    expect(normalizeIsbn('ISBN 978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn('isbn-10: 0 8044 2957 x')).toBe('080442957X');
    expect(normalizeIsbn('  ')).toBe('');
    expect(normalizeIsbn(null)).toBe('');
  });

  it('checks ISBN-10 and ISBN-13 checksums', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9780306406158')).toBe(false);
    expect(isValidIsbn13('9789631427998')).toBe(true);
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('9630142791')).toBe(true);
    expect(isValidIsbn10('0306406153')).toBe(false);
    expect(isValidIsbn10('X306406152')).toBe(false);
  });

  it('allows empty input and reports the kind of error', () => {
    expect(validateIsbn('')).toEqual({ value: null, error: null });
    expect(validateIsbn('978-963-14-2799-8')).toEqual({ value: '9789631427998', error: null });
    expect(validateIsbn('963 01 4279 1')).toEqual({ value: '9630142791', error: null });
    expect(validateIsbn('0-8044-2957-x')).toEqual({ value: '080442957X', error: null });
    expect(validateIsbn('978-963-14-2799-7').error).toBe('checksum');
    expect(validateIsbn('12345').error).toBe('length');
    expect(validateIsbn('97809ABC06157').error).toBe('chars');
    expect(validateIsbn('08044X9575').error).toBe('chars');
    expect(validateIsbn('978030640615X').error).toBe('chars');
  });
});

describe('numbers and tags', () => {
  it('parses optional integers within a range', () => {
    expect(parseOptionalInt('', 1000, 2100)).toEqual({ value: null, error: null });
    expect(parseOptionalInt(' 1968 ', 1000, 2100)).toEqual({ value: 1968, error: null });
    expect(parseOptionalInt('1968.', 1000, 2100)).toEqual({ value: 1968, error: null });
    expect(parseOptionalInt('1 200', 1, 100000)).toEqual({ value: 1200, error: null });
    expect(parseOptionalInt('19a8', 1000, 2100).error).toBe('number');
    expect(parseOptionalInt('-5', 1, 10).error).toBe('number');
    expect(parseOptionalInt('999', 1000, 2100).error).toBe('range');
    expect(parseOptionalInt('2101', 1000, 2100).error).toBe('range');
  });

  it('splits, trims and de-duplicates tags case/accent-insensitively', () => {
    expect(parseTags('dedikált, első kiadás,  Dedikalt ;; ajándék')).toEqual({ tags: ['dedikált', 'első kiadás', 'ajándék'], error: null });
    expect(parseTags('')).toEqual({ tags: [], error: null });
    expect(parseTags('x'.repeat(61)).error).toBe('tooLong');
    expect(parseTags(Array.from({ length: 31 }, (_, i) => `t${i}`).join(',')).error).toBe('tooMany');
    expect(formatTags(['a', 'b'])).toBe('a, b');
  });
});

describe('edit form', () => {
  const base = book({
    title: 'A Mester és Margarita',
    author: 'Mihail Bulgakov',
    language: 'hu',
    firstPublishedYear: 1967,
    isbn: '9789631427998',
    topics: ['classics', 'fantasy'],
    tags: ['kedvenc'],
  });

  it('round-trips a book without changes', () => {
    const values = bookToFormValues(base);
    const { errors, parsed } = validateBookForm(values);
    expect(errors).toEqual({});
    expect(parsed).not.toBeNull();
    expect(diffBookPatch(base, parsed!)).toEqual({});
    expect(isFormDirty(base, values)).toBe(false);
    expect(isFormDirty(base, { ...values, topics: ['fantasy', 'classics'] })).toBe(false);
  });

  it('reports field errors', () => {
    const values = {
      ...bookToFormValues(base),
      title: '   ',
      firstPublishedYear: '19x7',
      editionYear: '3000',
      pageCount: '0',
      isbn: '978-963-14-2799-1',
      language: 'hungarian',
      tags: 'x'.repeat(70),
    };
    const { errors, parsed } = validateBookForm(values);
    expect(parsed).toBeNull();
    expect(errors.title).toEqual({ code: 'required' });
    expect(errors.firstPublishedYear).toEqual({ code: 'yearNumber' });
    expect(errors.editionYear).toEqual({ code: 'yearRange', min: 1000, max: 2100 });
    expect(errors.pageCount).toEqual({ code: 'pagesRange', min: 1, max: 100000 });
    expect(errors.isbn).toEqual({ code: 'isbnChecksum' });
    expect(errors.language).toEqual({ code: 'languageCode' });
    expect(errors.tags).toEqual({ code: 'tagTooLong', max: 60 });
  });

  it('rebases untouched fields on server changes and keeps the user edits', () => {
    const values = { ...bookToFormValues(base), author: 'M. Bulgakov', tags: 'kedvenc, orosz' };
    const server = { ...base, author: 'Mihail Afanaszjevics Bulgakov', firstPublishedYear: 1966, topics: ['classics'], tags: ['kedvenc'] };
    const rebased = rebaseFormValues(base, server, values);
    expect(rebased.author).toBe('M. Bulgakov'); // edited: kept
    expect(rebased.tags).toBe('kedvenc, orosz'); // edited: kept
    expect(rebased.firstPublishedYear).toBe('1966'); // untouched: follows the server
    expect(rebased.topics).toEqual(['classics']);
    expect(rebaseFormValues(base, { ...base }, values)).toBe(values); // nothing changed: same object
  });

  it('builds a minimal patch with normalised values', () => {
    const values = {
      ...bookToFormValues(base),
      author: '  Mihail   Bulgakov ',
      subtitle: 'Regény',
      isbn: '',
      pageCount: '512',
      language: 'RU',
      category: 'classics',
      topics: ['fantasy', 'nonsense-key'],
      tags: 'kedvenc, orosz',
    };
    const { parsed } = validateBookForm(values);
    expect(diffBookPatch(base, parsed!)).toEqual({
      subtitle: 'Regény',
      isbn: null,
      pageCount: 512,
      language: 'ru',
      category: 'classics',
      topics: ['fantasy'],
      tags: ['kedvenc', 'orosz'],
    });
  });
});

describe('duplicate detection', () => {
  const shelf = [
    book({ title: 'A Mester és Margarita', author: 'Mihail Bulgakov', shelfPosition: 1 }),
    book({ title: 'Háború és béke I.', author: 'Lev Tolsztoj', shelfPosition: 2 }),
    book({ title: 'Sorstalanság', author: 'Kertész Imre', shelfPosition: 3 }),
    book({ title: 'Egri csillagok', author: null, shelfPosition: 4 }),
    book({ title: 'Ő', author: 'Rejtő Jenő', shelfPosition: 5 }),
    book({ title: 'The Hobbit', author: 'J. R. R. Tolkien', originalTitle: null, shelfPosition: 6 }),
    book({ title: 'A babó', author: 'J. R. R. Tolkien', originalTitle: 'The Hobbit', shelfPosition: 7 }),
  ];

  it('matches accent-, case- and article-insensitively', () => {
    const m = findDuplicates(shelf, { title: 'mester es margarita', author: 'Bulgakov' });
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe('exact');
    expect(m[0].book.title).toBe('A Mester és Margarita');
    expect(titleKey('Az ember tragédiája')).toBe('ember tragediaja');
  });

  it('treats a missing author on either side as compatible and handles name order', () => {
    expect(findDuplicates(shelf, { title: 'Egri csillagok', author: 'Gárdonyi Géza' })).toHaveLength(1);
    expect(findDuplicates(shelf, { title: 'Sorstalanság', author: '' })).toHaveLength(1);
    expect(findDuplicates(shelf, { title: 'Sorstalansag', author: 'Imre Kertész' })).toHaveLength(1);
  });

  it('does not match different authors, different volumes or unrelated titles', () => {
    expect(findDuplicates(shelf, { title: 'Sorstalanság', author: 'Szabó Magda' })).toEqual([]);
    expect(findDuplicates(shelf, { title: 'Háború és béke II.', author: 'Tolsztoj' })).toEqual([]);
    expect(findDuplicates(shelf, { title: 'Az ajtó', author: 'Szabó Magda' })).toEqual([]);
    expect(findDuplicates(shelf, { title: '', author: 'Bulgakov' })).toEqual([]);
    expect(findDuplicates(shelf, { title: 'Ók', author: 'Rejtő Jenő' })).toEqual([]);
  });

  it('flags near-identical titles (OCR typos) as similar and original titles as exact', () => {
    const typo = findDuplicates(shelf, { title: 'A Mester és Margaritta', author: 'M. Bulgakov' });
    expect(typo[0]?.kind).toBe('similar');
    const orig = findDuplicates(shelf, { title: 'The Hobbit', author: 'Tolkien' });
    expect(orig.map((m) => m.book.title)).toEqual(['The Hobbit', 'A babó']);
    expect(orig.every((m) => m.kind === 'exact')).toBe(true);
  });

  it('treats the same title with a subtitle as similar (whole-word prefix, not for short titles)', () => {
    expect(isTitlePrefix('Seveneves', 'Seveneves: Hét Éva')).toBe(true);
    expect(isTitlePrefix('Sorstalanság (regény)', 'sorstalansag')).toBe(true);
    expect(isTitlePrefix('Seven', 'Seveneves')).toBe(false);
    expect(isTitlePrefix('Az ajtó', 'Az ajtó mögött')).toBe(false); // "ajto" is too short to be telling
    expect(isTitlePrefix('Seveneves', 'Seveneves')).toBe(false);
    const withSubtitle = [...shelf, book({ title: 'Seveneves: Hét Éva', author: 'Neal Stephenson', shelfPosition: 8 })];
    const m = findDuplicates(withSubtitle, { title: 'Seveneves', author: 'N. Stephenson' });
    expect(m.map((x) => [x.book.title, x.kind])).toEqual([['Seveneves: Hét Éva', 'similar']]);
    expect(findDuplicates(withSubtitle, { title: 'Seveneves', author: 'Szabó Magda' })).toEqual([]);
    const target = book({ title: 'Seveneves', author: 'N. Stephenson', shelfPosition: 40 });
    expect(mergeCandidates([...withSubtitle, target], target, '').map((b) => b.title)).toEqual(['Seveneves: Hét Éva']);
  });

  it('honours excludeIds and limit', () => {
    const orig = findDuplicates(shelf, { title: 'The Hobbit', author: 'Tolkien' }, { excludeIds: [shelf[5].id], limit: 5 });
    expect(orig.map((m) => m.book.title)).toEqual(['A babó']);
    expect(findDuplicates(shelf, { title: 'The Hobbit' }, { limit: 1 })).toHaveLength(1);
  });

  it('suggests merge candidates with and without a query', () => {
    const target = book({ title: 'Mester es Margarit', author: 'Bulgakov', shelfPosition: 1.5 });
    const all = [...shelf, target];
    expect(mergeCandidates(all, target, '').map((b) => b.title)).toEqual(['A Mester és Margarita']);
    expect(mergeCandidates(all, target, 'kertesz').map((b) => b.title)).toEqual(['Sorstalanság']);
    expect(mergeCandidates(all, target, 'tolkien').map((b) => b.title).sort()).toEqual(['A babó', 'The Hobbit']);
    expect(mergeCandidates(all, target, 'nincs ilyen')).toEqual([]);
  });
});

describe('merge preview', () => {
  const a = book({ title: 'Sorstalanság', author: 'Kertész Imre', confidence: 0.55, detectionCount: 2, topics: ['hungarian_literature'], needsReview: true, spineImage: null, bestBbox: null });
  const b = book({
    title: 'Sorstalansag',
    author: null,
    confidence: 0.91,
    detectionCount: 5,
    publisher: 'Magvető',
    firstPublishedYear: 1975,
    topics: ['literary_fiction', 'hungarian_literature'],
    spineImage: '/api/media/123456789/spines/b.jpg',
    bestBbox: { x0: 1, y0: 2, x1: 30, y1: 400 },
    rating: 5,
  });
  const c = book({ title: 'Sorstalanság', author: 'Kertész', confidence: 0.4, detectionCount: 1, pageCount: 330 });

  it('mirrors the server merge (sums, unions, fills, evidence)', () => {
    const p = previewMerge(a, [b, c]);
    expect(p.detectionCount).toBe(8);
    expect(p.confidence).toBe(0.91);
    expect(p.topics).toEqual(['hungarian_literature', 'literary_fiction']);
    expect(p.filled.map((f) => [f.field, f.value])).toEqual([
      ['publisher', 'Magvető'],
      ['firstPublishedYear', 1975],
      ['pageCount', 330],
    ]);
    expect(p.evidenceFrom?.id).toBe(b.id);
    expect(p.lostOwnerData.map((x) => x.id)).toEqual([b.id]);
    expect(p.others.map((x) => x.id)).toEqual([b.id, c.id]);
  });

  it('keeps the entry with owner data / reviewed state by default', () => {
    expect(hasOwnerData(b)).toBe(true);
    expect(hasOwnerData(c)).toBe(false);
    expect(pickDefaultKeep([a, b, c])?.id).toBe(b.id);
    expect(pickDefaultKeep([a, c])?.id).toBe(c.id);
    expect(pickDefaultKeep([])).toBeNull();
  });
});

describe('evidence frames', () => {
  const frame = (id: string, w = 1080, h = 1920): FrameDTO => ({ id, videoId: 'v', idx: 1, timeSec: 1, width: w, height: h, image: `/f/${id}.jpg`, thumb: null });

  it('converts pixel boxes to clamped percentages', () => {
    expect(bboxToPercentRect({ x0: 108, y0: 192, x1: 216, y1: 960 }, 1080, 1920)).toEqual({ left: 10, top: 10, width: 10, height: 40 });
    expect(bboxToPercentRect({ x0: 1200, y0: -50, x1: 900, y1: 2500 }, 1080, 1920)).toEqual({ left: 83.333, top: 0, width: 16.667, height: 100 });
    expect(bboxToPercentRect({ x0: 5, y0: 5, x1: 5, y1: 50 }, 100, 100)).toBeNull();
    expect(bboxToPercentRect({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0, 100)).toBeNull();
    expect(bboxToPercentRect(null, 100, 100)).toBeNull();
  });

  it('finds the best frame, falling back to the largest detection', () => {
    const data = {
      frames: [frame('f1'), frame('f2')],
      detections: [
        { frameId: 'f1', bookId: 'b1', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
        { frameId: 'f2', bookId: 'b1', bbox: { x0: 0, y0: 0, x1: 50, y1: 50 } },
        { frameId: 'f2', bookId: 'b2', bbox: null },
      ],
    };
    expect(findEvidenceFrame({ id: 'b1', bestFrameId: 'f1', bestBbox: { x0: 1, y0: 1, x1: 9, y1: 9 } }, data)?.bbox).toEqual({ x0: 1, y0: 1, x1: 9, y1: 9 });
    expect(findEvidenceFrame({ id: 'b1', bestFrameId: 'f1', bestBbox: null }, data)?.bbox).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(findEvidenceFrame({ id: 'b1', bestFrameId: 'gone', bestBbox: null }, data)?.frame.id).toBe('f2');
    expect(findEvidenceFrame({ id: 'b2', bestFrameId: null, bestBbox: null }, data)).toBeNull();
    expect(findEvidenceFrame({ id: 'b1', bestFrameId: 'f1', bestBbox: null }, null)).toBeNull();
  });
});

describe('drawer and review helpers', () => {
  it('falls back to the other locale for descriptions', () => {
    expect(localizedDescription({ descriptionHu: 'Magyar', descriptionEn: 'English' }, 'en')).toEqual({ text: 'English', lang: 'en', isFallback: false });
    expect(localizedDescription({ descriptionHu: 'Magyar', descriptionEn: ' ' }, 'en')).toEqual({ text: 'Magyar', lang: 'hu', isFallback: true });
    expect(localizedDescription({ descriptionHu: null, descriptionEn: null }, 'hu')).toBeNull();
  });

  it('computes neighbours without wrapping', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(neighbourIds(list, 'a')).toEqual({ prev: null, next: 'b', index: 0, total: 3 });
    expect(neighbourIds(list, 'c')).toEqual({ prev: 'b', next: null, index: 2, total: 3 });
    expect(neighbourIds(list, 'x')).toEqual({ prev: null, next: null, index: -1, total: 3 });
  });

  it('orders the review queue by shelf position and picks the next item', () => {
    const b1 = book({ title: 'b1', needsReview: true, reviewed: false, shelfPosition: 20 });
    const b2 = book({ title: 'b2', needsReview: true, reviewed: true, shelfPosition: 5 });
    const b3 = book({ title: 'b3', needsReview: true, reviewed: false, shelfPosition: 10 });
    const b4 = book({ title: 'b4', needsReview: false, shelfPosition: 1 });
    const q = reviewQueue([b1, b2, b3, b4]);
    expect(q.map((b) => b.title)).toEqual(['b3', 'b1']);
    expect(nextAfterRemoval(q, b3.id)).toBe(b1.id);
    expect(nextAfterRemoval(q, b1.id)).toBe(b3.id);
    expect(nextAfterRemoval([q[0]], b3.id)).toBeNull();
  });

  it('turns upright spine crops so the lettering reads left to right', () => {
    expect(isUprightCrop(52, 900)).toBe(true);
    expect(isUprightCrop(100, 110)).toBe(false);
    expect(isUprightCrop(900, 52)).toBe(false);
    expect(isUprightCrop(0, 10)).toBe(false);
    expect(defaultSpineTurn({ language: 'en' })).toBe(270);
    expect(defaultSpineTurn({ language: 'EN' })).toBe(270);
    expect(defaultSpineTurn({ language: 'hu' })).toBe(90);
    expect(defaultSpineTurn({ language: null })).toBe(90);
  });

  it('combines autosave states for one indicator', () => {
    expect(combineAutosaveStatus('idle', 'saved')).toBe('saved');
    expect(combineAutosaveStatus('saved', 'pending')).toBe('pending');
    expect(combineAutosaveStatus('saving', 'error')).toBe('error');
    expect(combineAutosaveStatus()).toBe('idle');
  });

  it('formats time codes and dates', () => {
    expect(formatTimecode(75.4)).toBe('1:15');
    expect(formatTimecode(3725)).toBe('1:02:05');
    expect(formatTimecode(null)).toBeNull();
    expect(todayIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

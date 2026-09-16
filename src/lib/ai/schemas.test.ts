import { describe, expect, it } from 'vitest';
import {
  clampText,
  cleanText,
  coerceClassificationOutput,
  coerceDuplicateOutput,
  coerceVisionOutput,
  extractJson,
  isKnownPublisherMark,
  looseSimilarity,
  mapClassification,
  mapClassificationOutput,
  mapDuplicateOutput,
  mapVisionOutput,
  normalizeBBox,
  normalizeCountry,
  normalizeLanguage,
  normalizeYear,
  plausibleCanonical,
  resolveBoxScale,
  toTopicKey,
  VisionOutputSchema,
  type BookClassificationWire,
  type SpineObservationWire,
} from './schemas';

const obs = (o: Partial<SpineObservationWire>): SpineObservationWire => ({
  frame: 1,
  order: 1,
  author: null,
  title: 'Rokonok',
  canonical_author: null,
  canonical_title: null,
  publisher: null,
  confidence: 0.9,
  bbox: null,
  ...o,
});

const FRAMES = [
  { index: 11, width: 1080, height: 1920 },
  { index: 12, width: 1080, height: 1920 },
];

describe('normalizeBBox', () => {
  it('keeps pixel boxes, rounds and orders corners', () => {
    expect(normalizeBBox({ x0: 300.4, y0: 1500, x1: 100.6, y1: 200 }, 1080, 1920)).toEqual({ x0: 101, y0: 200, x1: 300, y1: 1500 });
  });

  it('scales normalised 0..1 answers to the frame', () => {
    expect(normalizeBBox({ x0: 0.1, y0: 0.05, x1: 0.2, y1: 0.95 }, 1080, 1920)).toEqual({ x0: 108, y0: 96, x1: 216, y1: 1824 });
  });

  it('clamps to the frame', () => {
    expect(normalizeBBox({ x0: -40, y0: -10, x1: 1200, y1: 2500 }, 1080, 1920)).toEqual({ x0: 0, y0: 0, x1: 1080, y1: 1920 });
  });

  it('applies a per-axis scale (e.g. per-mille answers)', () => {
    expect(normalizeBBox({ x0: 100, y0: 50, x1: 200, y1: 950 }, 1080, 1920, { x: 1.08, y: 1.92 })).toEqual({
      x0: 108,
      y0: 96,
      x1: 216,
      y1: 1824,
    });
  });

  it('rejects degenerate, non-finite or out-of-frame boxes', () => {
    expect(normalizeBBox({ x0: 10, y0: 10, x1: 11, y1: 500 }, 1080, 1920)).toBeNull();
    expect(normalizeBBox({ x0: Number.NaN, y0: 10, x1: 100, y1: 500 }, 1080, 1920)).toBeNull();
    expect(normalizeBBox({ x0: 1200, y0: 10, x1: 1300, y1: 500 }, 1080, 1920)).toBeNull();
    expect(normalizeBBox(null, 1080, 1920)).toBeNull();
    expect(normalizeBBox({ x0: 1, y0: 1, x1: 5, y1: 5 }, 0, 1920)).toBeNull();
  });
});

describe('resolveBoxScale', () => {
  it('uses thousandths when per-mille was requested and values fit', () => {
    const scales = resolveBoxScale([obs({ bbox: { x0: 100, y0: 50, x1: 300, y1: 980 } })], FRAMES, 'per_mille');
    expect(scales).toEqual([
      { scaleX: 1.08, scaleY: 1.92 },
      { scaleX: 1.08, scaleY: 1.92 },
    ]);
  });

  it('falls back to pixels when the reply clearly contains pixel values', () => {
    const scales = resolveBoxScale(
      [obs({ bbox: { x0: 100, y0: 50, x1: 1060, y1: 900 } }), obs({ bbox: { x0: 100, y0: 50, x1: 300, y1: 1700 } })],
      FRAMES,
      'per_mille',
    );
    expect(scales[0]).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('decides per axis for mixed replies (x in pixels, y in thousandths)', () => {
    // live deepseek-flash reply on a 1080 x 1920 frame: x reaches 1080, y stays within 205..870
    const wire = [obs({ bbox: { x0: 0, y0: 215, x1: 230, y1: 860 } }), obs({ bbox: { x0: 905, y0: 270, x1: 1080, y1: 860 } })];
    const scales = resolveBoxScale(wire, FRAMES, 'per_mille');
    expect(scales[0]).toEqual({ scaleX: 1, scaleY: 1.92 });
    expect(normalizeBBox(wire[0].bbox, 1080, 1920, { x: scales[0].scaleX, y: scales[0].scaleY })).toEqual({ x0: 0, y0: 413, x1: 230, y1: 1651 });
    // y clearly in pixels: the near-grid 1080 px side is read as pixels too
    expect(resolveBoxScale([obs({ bbox: { x0: 100, y0: 700, x1: 400, y1: 1650 } })], FRAMES, 'per_mille')[1]).toEqual({ scaleX: 1, scaleY: 1 });
    // landscape frame, y in pixels: the long 1920 px side stays in thousandths while its values fit
    const landscape = [{ width: 1920, height: 1080 }];
    expect(resolveBoxScale([obs({ bbox: { x0: 100, y0: 300, x1: 400, y1: 1070 } })], landscape, 'per_mille')).toEqual([{ scaleX: 1.92, scaleY: 1 }]);
    expect(resolveBoxScale([obs({ bbox: { x0: 100, y0: 300, x1: 1500, y1: 900 } })], landscape, 'per_mille')).toEqual([{ scaleX: 1, scaleY: 1 }]);
  });

  it('maps fraction boxes and thousandth boxes of one reply to the same pixels', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({ order: 1, title: 'Fractions', bbox: { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.9 } }),
          obs({ order: 2, title: 'Thousandths', bbox: { x0: 100, y0: 100, x1: 200, y1: 900 } }),
        ],
      },
      FRAMES.map((f, i) => ({ ...f, ...resolveBoxScale([obs({ bbox: { x0: 100, y0: 100, x1: 200, y1: 900 } })], FRAMES, 'per_mille')[i] })),
    );
    expect(out.map((o) => o.bbox)).toEqual([
      { x0: 108, y0: 192, x1: 216, y1: 1728 },
      { x0: 108, y0: 192, x1: 216, y1: 1728 },
    ]);
  });

  it('never rescales when pixels were requested', () => {
    expect(resolveBoxScale([obs({ bbox: { x0: 1, y0: 1, x1: 10, y1: 10 } })], FRAMES, 'pixels')[1]).toEqual({ scaleX: 1, scaleY: 1 });
  });
});

describe('mapVisionOutput', () => {
  it('maps snake_case to camelCase and frame numbers to VisionFrame.index', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({
            frame: 2,
            author: 'MÓRICZ ZSIGMOND',
            title: '  Rokonok ',
            canonical_author: 'Móricz Zsigmond',
            canonical_title: 'Rokonok',
            publisher: 'Szépirodalmi',
            confidence: 0.93,
            bbox: { x0: 10, y0: 20, x1: 110, y1: 1800 },
          }),
        ],
      },
      FRAMES,
    );
    expect(out).toEqual([
      {
        frame: 12,
        order: 1,
        author: 'MÓRICZ ZSIGMOND',
        title: 'Rokonok',
        canonicalAuthor: 'Móricz Zsigmond',
        canonicalTitle: 'Rokonok',
        publisher: 'Szépirodalmi',
        confidence: 0.93,
        bbox: { x0: 10, y0: 20, x1: 110, y1: 1800 },
      },
    ]);
  });

  it('drops unknown frames and title-less readings, uses canonical title for author-only readings', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({ frame: 3, title: 'Ghost frame' }),
          obs({ frame: 1, title: '   ', author: 'Ferrante' }),
          obs({ frame: 1, title: '', author: 'Asimov', canonical_title: 'Alapítvány', canonical_author: 'Isaac Asimov' }),
        ],
      },
      FRAMES,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ frame: 11, title: 'Alapítvány', author: 'Asimov' });
  });

  it('moves publisher marks out of author/title', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({ author: 'Park Kiadó', title: 'Az új név története' }),
          obs({ order: 2, author: 'Asimov', title: 'Galaktika Könyvek', publisher: null }),
        ],
      },
      FRAMES,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ author: null, publisher: 'Park Kiadó', title: 'Az új név története' });
  });

  it('clamps confidence and accepts percentages', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({ title: 'A', order: 1, confidence: 87 }),
          obs({ title: 'B', order: 2, confidence: -3 }),
          obs({ title: 'C', order: 3, confidence: 1000 }),
        ],
      },
      FRAMES,
    );
    expect(out.map((o) => o.confidence)).toEqual([0.87, 0, 1]);
  });

  it('renumbers order left→right per frame and dedupes repeated readings', () => {
    const out = mapVisionOutput(
      {
        observations: [
          obs({ frame: 1, order: 5, title: 'Right', bbox: { x0: 800, y0: 0, x1: 900, y1: 1000 } }),
          obs({ frame: 1, order: 2, title: 'Left', confidence: 0.5, bbox: { x0: 100, y0: 0, x1: 200, y1: 1000 } }),
          obs({ frame: 1, order: 2, title: 'left', confidence: 0.8, bbox: { x0: 105, y0: 0, x1: 205, y1: 1000 } }),
          obs({ frame: 2, order: 1, title: 'Other frame' }),
        ],
      },
      FRAMES,
    );
    expect(out.map((o) => [o.frame, o.order, o.title, o.confidence])).toEqual([
      [11, 1, 'left', 0.8],
      [11, 2, 'Right', 0.9],
      [12, 1, 'Other frame', 0.9],
    ]);
  });
});

describe('text helpers', () => {
  it('cleanText collapses whitespace, strips control characters and wrapping quotes', () => {
    expect(cleanText('  „Az   ajtó”\n')).toBe('Az ajtó');
    expect(cleanText(`A${String.fromCharCode(0)}B`)).toBe('A B');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
  });

  it('clampText cuts at a word boundary with an ellipsis', () => {
    const long = 'Móricz Zsigmond regénye egy vidéki város hivatali korrupciójáról, a rokonok és a városi vezetők összefonódásáról, valamint a hatalom természetéről szól, amely mindenkit megront előbb vagy utóbb.';
    const clamped = clampText(long, 120)!;
    expect(clamped.length).toBeLessThanOrEqual(120);
    expect(clamped.endsWith('…')).toBe(true);
    expect(long.startsWith(clamped.slice(0, -1))).toBe(true);
    expect(clampText('rövid', 200)).toBe('rövid');
  });

  it('recognises publisher marks with accents and suffixes', () => {
    expect(isKnownPublisherMark('MAGVETŐ')).toBe(true);
    expect(isKnownPublisherMark('Európa Könyvkiadó')).toBe(true);
    expect(isKnownPublisherMark('Galaktika könyvek')).toBe(true);
    expect(isKnownPublisherMark('Esterházy Péter')).toBe(false);
  });
});

describe('canonical plausibility', () => {
  it('keeps spelling fixes and completions, drops translations and other books', () => {
    // live DeepSeek answers seen on the sample shelf
    expect(plausibleCanonical('Briliáns barátnőm', 'La brillante amica', 'title')).toBeNull();
    expect(plausibleCanonical('A firenzei varázslónő', 'The Enchantress of Florence', 'title')).toBeNull();
    expect(plausibleCanonical('1984', 'Állatfarm', 'title')).toBeNull();
    expect(plausibleCanonical('A szökékékkel mindig baj van', 'A szőkékkel mindig baj van', 'title')).toBe('A szőkékkel mindig baj van');
    expect(plausibleCanonical('Csontbrigad', 'Csontbrigád', 'title')).toBe('Csontbrigád');
    expect(plausibleCanonical('The Hundred-Year-Old Man', 'The Hundred-Year-Old Man Who Climbed Out of the Window and Disappeared', 'title')).toBe(
      'The Hundred-Year-Old Man Who Climbed Out of the Window and Disappeared',
    );
    expect(plausibleCanonical('Asimov', 'Isaac Asimov', 'author')).toBe('Isaac Asimov');
    expect(plausibleCanonical('Esterhazy Peter', 'Esterházy Péter', 'author')).toBe('Esterházy Péter');
    expect(plausibleCanonical('Perruchot Henri', 'Henri Perruchot', 'author')).toBe('Henri Perruchot');
    expect(plausibleCanonical('Carmine Gallo', 'Walter Isaacson', 'author')).toBeNull();
    // nothing printed → nothing to contradict
    expect(plausibleCanonical(null, 'Szabó Magda', 'author')).toBe('Szabó Magda');
    expect(plausibleCanonical('Rokonok', null, 'title')).toBeNull();
    expect(looseSimilarity('Az Alapítvány', 'Az Alapítvány barátai')).toBe(1);
  });

  it('mapVisionOutput drops implausible canonical values but keeps the reading', () => {
    const out = mapVisionOutput(
      { observations: [obs({ author: 'Elena Ferrante', title: 'Briliáns barátnőm', canonical_author: 'Elena Ferrante', canonical_title: 'La brillante amica' })] },
      FRAMES,
    );
    expect(out[0]).toMatchObject({ title: 'Briliáns barátnőm', canonicalTitle: null, canonicalAuthor: 'Elena Ferrante' });
  });
});

describe('classification mapping', () => {
  const wire = (o: Partial<BookClassificationWire>): BookClassificationWire => ({
    id: 'b1',
    known_book: true,
    category: 'literary_fiction',
    topics: [],
    author: null,
    original_title: null,
    language: null,
    original_language: null,
    author_country: null,
    first_published_year: null,
    description_hu: null,
    description_en: null,
    ...o,
  });

  it('maps fields and normalises codes', () => {
    const r = mapClassification(
      wire({
        category: 'Science fiction',
        topics: ['classics', 'scifi', 'not-a-key', 'Crime & thriller', 'poetry', 'humor'],
        author: ' Isaac Asimov ',
        original_title: 'Foundation',
        language: 'HU',
        original_language: 'eng',
        author_country: 'us',
        first_published_year: 1951.2,
        description_hu: 'Egy galaktikus birodalom bukása.',
        description_en: 'The fall of a galactic empire.',
      }),
    );
    expect(r).toEqual({
      id: 'b1',
      category: 'scifi',
      topics: ['classics', 'crime_thriller', 'poetry'],
      author: 'Isaac Asimov',
      originalTitle: 'Foundation',
      language: 'hu',
      originalLanguage: 'en',
      authorCountry: 'US',
      firstPublishedYear: 1951,
      descriptionHu: 'Egy galaktikus birodalom bukása.',
      descriptionEn: 'The fall of a galactic empire.',
    });
  });

  it('falls back to other and nulls book facts when the model does not know the book', () => {
    const r = mapClassification(
      wire({
        category: 'poems and stuff',
        known_book: false,
        original_title: 'X',
        first_published_year: 1990,
        description_hu: 'Kitalált leírás.',
        description_en: 'Invented.',
        language: 'hu',
      }),
    );
    expect(r).toMatchObject({ category: 'other', originalTitle: null, firstPublishedYear: null, descriptionHu: null, descriptionEn: null, language: 'hu' });
  });

  it('clamps descriptions to 200 characters', () => {
    const r = mapClassification(wire({ description_hu: 'szó '.repeat(80), description_en: 'word '.repeat(80) }));
    expect(r.descriptionHu!.length).toBeLessThanOrEqual(200);
    expect(r.descriptionEn!.length).toBeLessThanOrEqual(200);
  });

  it('validates years, languages and countries', () => {
    expect(normalizeYear(0)).toBeNull();
    expect(normalizeYear(-400)).toBe(-400);
    expect(normalizeYear(3000)).toBeNull();
    expect(normalizeLanguage('en-GB')).toBe('en');
    expect(normalizeLanguage('Hungarian')).toBe('hu');
    expect(normalizeLanguage('xyz1')).toBeNull();
    expect(normalizeCountry('UK')).toBe('GB');
    expect(normalizeCountry('Hungary')).toBeNull();
    expect(toTopicKey('Történelem')).toBe('history');
  });

  it('keeps only requested ids, first answer wins', () => {
    const out = mapClassificationOutput(
      { books: [wire({ id: 'b1', category: 'history' }), wire({ id: 'zz' }), wire({ id: 'b1', category: 'poetry' })] },
      ['b1', 'b2'],
    );
    expect(out.map((r) => [r.id, r.category])).toEqual([['b1', 'history']]);
  });
});

describe('duplicates mapping', () => {
  it('answers every id, missing ones are false', () => {
    expect(mapDuplicateOutput({ answers: [{ id: 'q1', same: true }, { id: 'q9', same: true }] }, ['q1', 'q2'])).toEqual({
      q1: true,
      q2: false,
    });
  });
});

describe('lenient JSON coercion', () => {
  it('extractJson handles fences, chatter and several top-level objects', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": [1]} thanks')).toEqual({ a: [1] });
    expect(extractJson('{"observations": [{"t": "x}"}]}\n{"observations": [{"t": 2}]}')).toEqual({
      observations: [{ t: 'x}' }, { t: 2 }],
    });
    expect(() => extractJson('{"observations": [')).toThrow();
    expect(() => extractJson('no json')).toThrow();
  });

  it('coerceVisionOutput repairs strings, arrays and missing keys', () => {
    const out = coerceVisionOutput(
      {
        observations: [
          { frame: '1', order: '2', title: 'Rokonok', author: 'Móricz Zsigmond', confidence: '0.8', bbox: [1, 2, 300, 400] },
          { frame: 1, title: 'Box as left/top/width/height', bbox: { left: 10, top: 20, width: 30, height: 40 } },
          { order: 1, title: 'no frame in multi-frame batch' },
          'garbage',
        ],
      },
      2,
    )!;
    expect(VisionOutputSchema.safeParse(out).success).toBe(true);
    expect(out.observations).toHaveLength(2);
    expect(out.observations[0]).toMatchObject({ frame: 1, order: 2, confidence: 0.8, canonical_title: null, bbox: { x0: 1, y0: 2, x1: 300, y1: 400 } });
    expect(out.observations[1].bbox).toEqual({ x0: 10, y0: 20, x1: 40, y1: 60 });
    expect(coerceVisionOutput({ foo: 'bar' }, 1)).toBeNull();
    expect(coerceVisionOutput([{ title: 'bare array', order: 1 }], 1)!.observations[0].frame).toBe(1);
  });

  it('coerceClassificationOutput and coerceDuplicateOutput accept near-miss shapes', () => {
    const c = coerceClassificationOutput({ books: [{ id: 'b1', category: 'history', topics: 'classics, poetry', year: '1932' }] })!;
    expect(c.books[0]).toMatchObject({ id: 'b1', known_book: true, topics: ['classics', ' poetry'], first_published_year: 1932, description_hu: null });
    expect(mapClassification(c.books[0]).topics).toEqual(['classics', 'poetry']);
    expect(coerceDuplicateOutput({ answers: [{ id: 'q1', same: 'true' }, { id: 'q2', same: false }] })).toEqual({
      answers: [
        { id: 'q1', same: true },
        { id: 'q2', same: false },
      ],
    });
    expect(coerceDuplicateOutput({ q1: true, q2: false })!.answers).toHaveLength(2);
  });
});

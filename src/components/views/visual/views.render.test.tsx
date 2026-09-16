/**
 * Server-render smoke tests of the four visual views (react-dom/server, no DOM): every render path
 * runs with a mocked collection context in both languages, i18n keys resolve, React reports no
 * key / prop warnings, and the big-collection path stays progressive.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  width: 1180 as number | null,
  desktop: true,
  prefs: new Map<string, unknown>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/123456789',
  useSearchParams: () => new URLSearchParams(),
}));

// SSR has no layout: pretend the view was measured, and read the stored preferences from `env`
vi.mock('@/components/views/visual/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useElementWidth: () => [() => {}, env.width],
    useStoredState: <T,>(key: string, fallback: T) => [env.prefs.has(key) ? (env.prefs.get(key) as T) : fallback, () => {}],
  };
});

vi.mock('@/components/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/hooks')>();
  return { ...actual, useMediaQuery: () => env.desktop };
});

vi.mock('@/lib/client/api', () => ({
  api: { getFrames: vi.fn(() => new Promise(() => {})) },
}));

import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import { CollectionContext, EMPTY_FILTERS, type CollectionContextValue, type SortKey } from '@/components/collection/context';
import { CoversView } from '@/components/views/CoversView';
import { FramesView } from '@/components/views/FramesView';
import { ShelfView } from '@/components/views/ShelfView';
import { TimelineView } from '@/components/views/TimelineView';
import { I18nProvider } from '@/i18n/client';
import type { BookDTO, CollectionWithBooksDTO, FrameDTO, Locale, VideoDTO } from '@/lib/types';
import { FrameStage } from './FrameStage';
import { FrameStrip } from './FrameStrip';
import type { FrameDetection } from './frames-layout';

const VIDEO: VideoDTO = {
  id: 'v1',
  kind: 'video',
  sortOrder: 0,
  originalFilename: '20260912_212903.mp4',
  sizeBytes: 12_000_000,
  uploadStatus: 'uploaded',
  status: 'done',
  stage: 'done',
  progress: 100,
  durationSec: 9.4,
  framesTotal: 3,
  framesAnalyzed: 3,
  booksFound: 3,
  error: null,
  createdAt: '2026-09-12T20:00:00.000Z',
  processedAt: '2026-09-12T20:05:00.000Z',
};

function makeCtx(books: BookDTO[], overrides: Partial<CollectionContextValue> = {}): CollectionContextValue {
  const collection: CollectionWithBooksDTO = {
    id: '123456789',
    title: 'Teszt könyvtár',
    description: null,
    ownerName: null,
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: false,
    email: null,
    publicUrl: 'http://localhost/123456789',
    bookCount: books.length,
    videos: [VIDEO],
    createdAt: '2026-09-12T20:00:00.000Z',
    updatedAt: '2026-09-12T20:05:00.000Z',
    emailSentAt: null,
    books,
  };
  return {
    collection,
    books,
    visibleBooks: books,
    isOwner: false,
    locale: 'hu',
    view: 'shelf',
    setView: vi.fn(),
    filters: EMPTY_FILTERS,
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    activeFilterCount: 0,
    sort: 'shelf',
    setSort: vi.fn(),
    openBookId: null,
    openBook: vi.fn(),
    selection: new Set(),
    toggleSelect: vi.fn(),
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    updateBook: vi.fn(async () => null),
    deleteBooks: vi.fn(async () => {}),
    addBook: vi.fn(async () => null),
    mergeBooks: vi.fn(async () => null),
    updateCollection: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...overrides,
  };
}

function render(ui: ReactElement, ctx: CollectionContextValue, locale: Locale = 'hu'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <CollectionContext.Provider value={{ ...ctx, locale }}>{ui}</CollectionContext.Provider>
    </I18nProvider>,
  );
}

const count = (html: string, needle: string | RegExp) =>
  typeof needle === 'string' ? html.split(needle).length - 1 : (html.match(needle) ?? []).length;

/** The markup escapes quotes and ampersands; compare against escaped text. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  env.width = 1180;
  env.desktop = true;
  env.prefs.clear();
  const capture = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  // no missing translations, no React key / DOM prop warnings in any render
  expect(warnings).toEqual([]);
});

const undated = [
  makeSampleBook({ title: 'Kézzel felvett könyv', author: null, source: 'manual', enriched: false }),
  makeSampleBook({ title: 'Ismeretlen évű regény', author: 'Teszt Elek', firstPublishedYear: null }),
];
const books = [...SAMPLE_BOOKS, ...undated];

describe('ShelfView', () => {
  it('packs every book as an interactive spine with bookends, skip link and options (hu)', () => {
    const html = render(<ShelfView />, makeCtx(books));
    expect(count(html, 'role="button"')).toBe(books.length);
    for (const b of SAMPLE_BOOKS.slice(0, 5)) expect(html).toContain(esc(`${b.author} – ${b.title}`));
    expect(html).toContain('Ugrás a könyvespolc után');
    expect(html).toContain('Csoportosítás');
    expect(html).toContain('Valódi gerincek');
    expect(html).toContain('data-plank-row="all:0"');
  });

  it('groups by topic / author initial / status with brass plates and counts (en)', () => {
    env.prefs.set('exl.visual.shelf.groupBy', 'topic');
    const topic = render(<ShelfView />, makeCtx(books), 'en');
    expect(topic).toContain('Hungarian literature');
    expect(topic).toContain(esc('Hungarian literature – ')); // case aria-label with the book count
    expect(count(topic, 'role="button"')).toBe(books.length);

    env.prefs.set('exl.visual.shelf.groupBy', 'author');
    const author = render(<ShelfView />, makeCtx(books), 'hu');
    expect(author).toContain('Szerző nélkül');
    expect(author).toContain('data-plank-row="Sz:0"');

    env.prefs.set('exl.visual.shelf.groupBy', 'status');
    const status = render(<ShelfView />, makeCtx(books), 'en');
    expect(status).toContain('data-plank-row="reading:0"');
    expect(status.indexOf('data-plank-row="reading:0"')).toBeLessThan(status.indexOf('data-plank-row="unknown:0"'));
  });

  it('renders a skeleton before the width is measured and the compact size when stored', () => {
    env.width = null;
    const skeleton = render(<ShelfView />, makeCtx(books));
    expect(count(skeleton, 'role="button"')).toBe(0);
    env.width = 1180;
    env.prefs.set('exl.visual.shelf.density', 'compact');
    const compact = render(<ShelfView />, makeCtx(books));
    env.prefs.clear();
    const comfortable = render(<ShelfView />, makeCtx(books));
    // compact planks hold more (thinner) spines: fewer planks than comfortable
    expect(count(comfortable, 'data-plank-row=')).toBeGreaterThan(0);
    expect(count(compact, 'data-plank-row=')).toBeLessThan(count(comfortable, 'data-plank-row='));
  });

  it('shows the filtered empty state with a reset button, or the empty-shelf state', () => {
    const filtered = render(<ShelfView />, makeCtx(books, { visibleBooks: [], activeFilterCount: 2 }));
    expect(filtered).toContain('Nincs a szűrésnek megfelelő könyv');
    expect(filtered).toContain('Szűrők törlése');
    const empty = render(<ShelfView />, makeCtx([]), 'en');
    expect(empty).toContain('The shelf is still empty');
  });

  it('keeps 2000+ books progressive: only the first planks get interactive spines', () => {
    const many = Array.from({ length: 2400 }, (_, i) =>
      makeSampleBook({ title: `Könyv ${i + 1} ${'x'.repeat(i % 23)}`, author: `Szerző ${i % 97}`, pageCount: 80 + ((i * 37) % 900) }),
    );
    const started = performance.now();
    const html = render(<ShelfView />, makeCtx(many));
    const ms = performance.now() - started;
    const interactive = count(html, 'role="button"');
    expect(interactive).toBeGreaterThan(0);
    expect(interactive).toBeLessThan(many.length / 4);
    // every book is still on a plank (placeholders for the rest)
    expect(count(html, 'data-plank-row=')).toBeGreaterThan(40);
    console.info('[views-visual] shelf SSR of 2400 books', { ms: Math.round(ms), interactive });
  });
});

describe('CoversView', () => {
  it('renders a card button per book, badges, and no letter headers for shelf order', () => {
    const html = render(<CoversView />, makeCtx(books));
    expect(count(html, 'role="listitem"')).toBe(books.length);
    expect(html).toContain(esc('Szabó Magda – Az ajtó megnyitása'));
    expect(html).not.toContain('Ugrás kezdőbetűre');
  });

  it('adds initial-letter headers and the jump bar when sorted by author / title', () => {
    const sorted = [...books].sort((a, b) => (a.authorSort ?? '~').localeCompare(b.authorSort ?? '~', 'hu'));
    const html = render(<CoversView />, makeCtx(sorted, { sort: 'author' as SortKey }));
    expect(html).toContain('Ugrás kezdőbetűre');
    expect(html).toContain('„Sz” betű');
    expect(html).toContain('Szerző nélkül');
    const en = render(<CoversView />, makeCtx(sorted, { sort: 'title' as SortKey }), 'en');
    expect(en).toContain('Jump to letter');
  });

  it('shows ghosts instead of cards far down a large wall', () => {
    const many = Array.from({ length: 900 }, (_, i) => makeSampleBook({ title: `Borító ${i}`, author: `Író ${i % 50}` }));
    const html = render(<CoversView />, makeCtx(many));
    expect(count(html, 'megnyitása')).toBeLessThan(many.length / 3);
    expect(count(html, 'megnyitása')).toBeGreaterThan(0);
  });
});

describe('TimelineView', () => {
  const bc = makeSampleBook({ title: 'Iliász', author: 'Homérosz', firstPublishedYear: -750 });

  it('desktop: century bands, decade columns, histogram, extremes and the unknown tray (hu)', () => {
    const html = render(<TimelineView />, makeCtx([...books, bc]));
    expect(html).toContain('20. század');
    expect(html).toContain('19. század');
    expect(html).toContain('i. e. 8. század');
    expect(html).toContain('Könyvek száma évtizedenként');
    expect(html).toContain('Legrégebbi');
    expect(html).toContain('Legújabb');
    expect(html).toContain('Ismeretlen kiadási év');
    expect(html).toContain('nem találtunk adatot'); // ready collection → not "still running"
    expect(html).toContain('1960'); // decade tick
    expect(html).toContain(esc('év kihagyva')); // gap between 8th c. BC and 19th c.
  });

  it('mobile + English: vertical decades, pending hint while processing', () => {
    env.desktop = false;
    const ctx = makeCtx(books);
    const html = render(<TimelineView />, { ...ctx, collection: { ...ctx.collection, status: 'processing' } }, 'en');
    expect(html).toContain('1960s');
    expect(html).toContain('20th century');
    expect(html).toContain('That is still running');
  });

  it('century zoom and the owner hint', () => {
    env.prefs.set('exl.visual.timeline.zoom', 'century');
    const html = render(<TimelineView />, makeCtx(books, { isOwner: true }));
    expect(html).toContain('20. század');
    expect(html).toContain('A könyv adatlapján kézzel is megadhatod.');
  });

  it('only undated books → empty timeline message, tray still lists them', () => {
    const html = render(<TimelineView />, makeCtx(undated), 'en');
    expect(html).toContain('No publication years yet');
    expect(html).toContain('Unknown year');
  });
});

describe('FramesView', () => {
  const frames: FrameDTO[] = [0, 1, 2].map((i) => ({
    id: `f${i}`,
    videoId: 'v1',
    idx: i,
    timeSec: i * 0.35,
    width: 1080,
    height: 1920,
    image: `/api/media/frames/123456789/v1/${i}.jpg`,
    thumb: `/api/media/frames/123456789/v1/${i}_t.jpg`,
  }));

  it('shows the intro, the deletion note and a skeleton while loading', () => {
    const html = render(<FramesView />, makeCtx(books));
    expect(html).toContain('Így láttuk a polcodat');
    expect(html).toContain('csak ezek a kulcsképkockák maradnak meg');
    expect(html).toContain('aria-busy="true"');
  });

  it('stage: scales boxes from frame pixels, greys out detections without a book', () => {
    env.width = 1180; // viewport fallback 800 → max height 576 → scale 0.3 → 324 × 576
    const [a, b] = SAMPLE_BOOKS;
    const detections: FrameDetection[] = [
      { frameId: 'f0', bookId: a.id, bbox: { x0: 108, y0: 192, x1: 216, y1: 1728 } },
      { frameId: 'f0', bookId: b.id, bbox: { x0: 300, y0: 100, x1: 400, y1: 1800 } },
      { frameId: 'f0', bookId: 'deleted-book', bbox: { x0: 500, y0: 100, x1: 600, y1: 1800 } },
      { frameId: 'f0', bookId: null, bbox: null },
    ];
    const html = render(
      <FrameStage
        frame={frames[0]}
        detections={detections}
        booksById={new Map(books.map((x) => [x.id, x]))}
        imageLabel="Kulcsképkocka"
        showAll
        highlightBookId={null}
        onOpen={() => {}}
      />,
      makeCtx(books),
    );
    expect(html).toContain('width:324px;height:576px');
    expect(html).toContain('left:32.4px;top:57.6px;width:32.4px;height:460.8px');
    expect(count(html, '<button')).toBe(2);
    expect(html).toContain(esc(`${a.author} – ${a.title} megnyitása`));
    expect(html).toContain('Nem tartozik könyvhöz (törölve vagy összevonva)');
  });

  it('strip: source name, duration and counts per video (en)', () => {
    const html = render(
      <FrameStrip group={{ videoId: 'v1', video: VIDEO, frames }} selectedId="f1" detectionCounts={new Map([['f1', 4]])} onSelect={() => {}} />,
      makeCtx(books),
      'en',
    );
    expect(html).toContain('20260912_212903.mp4');
    expect(html).toContain('0:09 · 3 frames · 4 recognised spines');
    expect(count(html, 'aria-current="true"')).toBe(1);
    expect(html).toContain('0:00.4');
  });
});

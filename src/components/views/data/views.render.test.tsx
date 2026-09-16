/**
 * Server-render smoke tests of the four data views (react-dom/server, no DOM): every render path
 * runs with a mocked collection context in both languages, all i18n keys resolve, React reports no
 * key / prop warnings, and the markup carries the expected structure (charts with title/desc and
 * table twins, windowed table rows, A–Z sections, topic tiles).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  size: { width: 640, height: 720 } as { width: number; height: number } | null,
  desktop: true,
  prefs: new Map<string, unknown>(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/123456789',
  useSearchParams: () => new URLSearchParams(),
}));

// SSR has no layout: pretend elements were measured, and read stored preferences from `env`
vi.mock('@/components/views/data/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useElementSize: () => [() => {}, env.size],
    usePersistentState: <T,>(key: string, fallback: T) => [env.prefs.has(key) ? (env.prefs.get(key) as T) : fallback, () => {}],
  };
});

vi.mock('@/components/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/hooks')>();
  return { ...actual, useMediaQuery: () => env.desktop };
});

import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import { CollectionContext, EMPTY_FILTERS, type CollectionContextValue } from '@/components/collection/context';
import { AuthorsView } from '@/components/views/AuthorsView';
import { StatsView } from '@/components/views/StatsView';
import { TableView } from '@/components/views/TableView';
import { TopicsView } from '@/components/views/TopicsView';
import { formatNumber } from '@/i18n';
import { I18nProvider } from '@/i18n/client';
import type { BookDTO, CollectionWithBooksDTO, Locale } from '@/lib/types';

function makeCtx(books: BookDTO[], overrides: Partial<CollectionContextValue> = {}): CollectionContextValue {
  const collection: CollectionWithBooksDTO = {
    id: '123456789',
    title: 'Teszt könyvtár',
    description: null,
    ownerName: null,
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: overrides.isOwner ?? false,
    email: null,
    publicUrl: 'http://localhost/123456789',
    bookCount: books.length,
    videos: [],
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
    view: 'stats',
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

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The markup escapes quotes and ampersands; compare against escaped text. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  env.size = { width: 640, height: 720 };
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
  // no missing translations ("[i18n] missing key"), no React key / DOM nesting / prop warnings
  expect(warnings).toEqual([]);
});

const books = SAMPLE_BOOKS;

/* ------------------------------------------------------------------ */

describe('TableView', () => {
  it('viewer: one row per book, sortable headers, no selection column (hu)', () => {
    const html = render(<TableView />, makeCtx(books));
    expect(count(html, 'data-row-index="')).toBe(books.length);
    for (const label of ['Szerző', 'Cím', 'Év', 'Témák', 'Állapot', 'Értékelés', 'Felismerés', 'Hely']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-sort="ascending"'); // shelf order is the active collection sort
    expect(html).not.toContain('Az összes látható könyv kijelölése');
    expect(html).toContain('Kattints egy sorra a részletekért');
    // default hidden columns
    expect(html).not.toContain('>Nyelv<');
    expect(html).not.toContain('Felvéve');
  });

  it('owner: selection, inline status select, rating, favourite toggle and review marker (en)', () => {
    const pending = books.filter((b) => b.needsReview && !b.reviewed);
    const html = render(<TableView />, makeCtx(books, { isOwner: true, selection: new Set([books[0].id]) }), 'en');
    expect(html).toContain('Select all visible books');
    expect(count(html, 'aria-label="Select ')).toBe(books.length + 1);
    expect(count(html, 'Reading status of ')).toBe(books.length);
    expect(count(html, esc(`Favourite: ${books[1].title}`))).toBe(1);
    expect(count(html, 'aria-label="Needs review"')).toBe(pending.length);
    expect(html).toContain('1 selected');
    expect(html).toContain('aria-multiselectable="true"');
  });

  it('honours stored hidden columns and compact density', () => {
    env.prefs.set('exl.data.table.hiddenColumns', ['topics', 'confidence']);
    env.prefs.set('exl.data.table.density', 'compact');
    const html = render(<TableView />, makeCtx(books));
    expect(html).not.toContain('>Témák<');
    expect(html).not.toContain('>Felismerés<');
    expect(html).toContain('height:38px');
  });

  it('windows long tables: renders only the rows in view plus spacers', () => {
    const many = Array.from({ length: 450 }, (_, i) => makeSampleBook({ title: `Könyv ${i + 1}`, author: `Szerző ${i % 40}` }));
    const html = render(<TableView />, makeCtx(many));
    const rows = count(html, 'data-row-index="');
    expect(rows).toBeGreaterThan(10);
    expect(rows).toBeLessThan(60);
    expect(html).toContain('aria-rowcount="451"');
  });

  it('empty and filtered-out states', () => {
    expect(render(<TableView />, makeCtx([]))).toContain('Még nincsenek könyvek');
    const filtered = render(<TableView />, makeCtx(books, { visibleBooks: [], activeFilterCount: 1 }), 'en');
    expect(filtered).toContain('No books match your filters');
    expect(filtered).toContain('Clear filters');
  });
});

/* ------------------------------------------------------------------ */

describe('AuthorsView', () => {
  it('A–Z rail with Hungarian digraphs, sections, cards and the no-author section (hu)', () => {
    const html = render(<AuthorsView />, makeCtx(books));
    expect(html).toContain('Szerzők betűrendes mutatója');
    expect(html).toContain('aria-label="Ugrás ide: Sz"');
    expect(html).toContain('aria-label="Ugrás ide: Dzs"'); // present on the rail, disabled
    expect(html).toContain('id="authors-letter-Sz"');
    expect(html).toContain('Szabó Magda');
    expect(html).toContain('Szerző nélkül');
    expect(count(html, '>Mutasd a polcon<')).toBe(new Set(books.flatMap((b) => (b.author ? [b.author] : []))).size);
  });

  it('count order ranks the cards and hides the rail (en)', () => {
    env.prefs.set('exl.data.authors.sort', 'count');
    const html = render(<AuthorsView />, makeCtx(books), 'en');
    expect(html).not.toContain('Authors A–Z index');
    expect(html).toContain('>1.<');
    expect(html).toContain('Without an author');
  });
});

/* ------------------------------------------------------------------ */

describe('TopicsView', () => {
  it('taxonomy group sections with sized, labelled tiles (hu)', () => {
    const html = render(<TopicsView />, makeCtx(books));
    expect(html).toContain('>Szépirodalom<');
    expect(html).toContain('Magyar irodalom');
    expect(count(html, 'aria-expanded="false"')).toBeGreaterThan(10);
    expect(html).toContain('row-span-2'); // the largest topics get big tiles
    expect(html).toContain('Egy könyv több témában is szerepelhet');
  });

  it('adds the unclassified tile while classification is still running (en)', () => {
    const pending = makeSampleBook({ title: 'Friss könyv', author: 'Új Szerző', category: null, topics: [], enriched: false });
    const html = render(<TopicsView />, makeCtx([...books, pending]), 'en');
    expect(html).toContain('Classification in progress');
    expect(html).toContain('Topics are added in the last step of processing.');
  });
});

/* ------------------------------------------------------------------ */

describe('StatsView', () => {
  const n = (v: number) => formatNumber('hu', v);

  it('renders every panel with charts, table twins and localised labels (hu, viewer)', () => {
    const html = render(<StatsView />, makeCtx(books));
    for (const heading of [
      'Top 10 szerző',
      'Kategóriák',
      'Megjelenés évtizedenként',
      'Olvasási állapot',
      'Nyelvek',
      'A szerzők országai',
      'Felismerés minősége',
      'Érdekességek',
      'Mit olvassak ma?',
    ]) {
      expect(html).toContain(`>${heading}<`);
    }
    // four hand-made SVG charts, each named by <title>/<desc> and paired with a hidden data table
    expect(count(html, '<svg role="img"')).toBe(4);
    expect(count(html, '<title id=')).toBe(4);
    expect(count(html, '<desc id=')).toBe(4);
    expect(count(html, '<caption>')).toBe(4);
    expect(html).toContain('Kategóriák – adatok táblázatban');
    // headline numbers (final values on the server)
    expect(html).toContain(`>${n(books.length)}<`);
    expect(html).toContain(`~${n(15514)}`);
    expect(html).toContain('92 cm');
    expect(html).toContain('29%');
    // decades: Hungarian suffixes, century bin, notes
    expect(html).toContain('1940-es évek');
    expect(html).toContain('1960-as évek');
    expect(html).toContain('19. század');
    expect(html).toContain('19. sz.');
    expect(html).toContain('A régebbi, 1900 előtt megjelent könyveket évszázadonként összesítjük.');
    expect(html).toContain('1 könyv megjelenési éve ismeretlen.');
    // category legend folds the tail into "other"
    expect(html).toContain('Egyéb kategóriák');
    expect(html).toContain('Ide tartozik: ');
    // fun facts
    expect(html).toContain('Toldi');
    expect(html).toContain('Arany János · 1846');
    expect(html).toContain('„magyar”');
    expect(html).toContain('Napi 30 oldallal');
    expect(html).toContain('1 év és 22 nap');
    expect(html).toContain('alatt olvasnád végig a még olvasatlan 24 könyvet');
    // countries with flags, languages, translation share
    expect(html).toContain('Magyarország');
    expect(html).toContain('100% fordítás');
    // recognition quality: count visible, review shortcut only for owners
    expect(html).toContain('Ellenőrzésre vár');
    expect(html).not.toContain('Ellenőrzés indítása');
    // what to read today: to-read list first
    expect(html).toContain('Véletlenszerű ajánlat a várólistáról · 4 könyv közül');
    expect(html).not.toContain('A számok a szűrésnek megfelelő');
  });

  it('English labels, owner review shortcut, filtered notice', () => {
    const subset = books.slice(0, 12);
    const html = render(<StatsView />, makeCtx(books, { isOwner: true, visibleBooks: subset, activeFilterCount: 2 }), 'en');
    expect(html).toContain('>Top 10 authors<');
    expect(html).toContain('These figures cover the 12 books matching your filters (whole collection: 34).');
    const full = render(<StatsView />, makeCtx(books, { isOwner: true }), 'en');
    expect(full).toContain('1940s');
    expect(full).toContain('19th century');
    expect(full).toContain('At 30 pages a day');
    expect(full).toContain('1 year and 22 days');
    expect(full).toContain('to read the 24 unread books');
    expect(full).toContain('Start reviewing');
    expect(full).toContain('2 awaiting review');
  });

  it('explains missing reading statuses and offers the table to owners', () => {
    const unset = books.map((b) => ({ ...b, readingStatus: 'unknown' as const }));
    const owner = render(<StatsView />, makeCtx(unset, { isOwner: true }));
    expect(owner).toContain('Még egyik könyvnél sincs megadva olvasási állapot.');
    expect(owner).toContain('Táblázat nézet');
    const viewer = render(<StatsView />, makeCtx(unset), 'en');
    expect(viewer).toContain('No reading status has been set yet.');
    expect(viewer).not.toContain('Table view');
    expect(viewer).toContain('A random pick from the unread books');
  });

  it('degrades gracefully for unclassified, manual-only collections', () => {
    const bare = [
      makeSampleBook({ title: 'Kézzel felvett', author: null, source: 'manual', category: null, topics: [], enriched: false, language: null }),
      makeSampleBook({ title: 'Még egy', author: null, source: 'manual', category: null, topics: [], enriched: false, language: null }),
    ];
    const html = render(<StatsView />, makeCtx(bare));
    expect(html).toContain('Még egyik könyvnél sincs szerző.');
    expect(html).toContain('A kategóriák a feldolgozás utolsó lépésében kerülnek a könyvekre.');
    expect(html).toContain('Még egyik könyvnél sincs megjelenési év.');
    expect(html).toContain('Minden könyvet kézzel vettek fel, így nincs mit értékelni.');
    expect(count(html, '<svg role="img"')).toBe(1); // only the reading-status ring remains
  });

  it('renders the chart shells before measurement and the empty states', () => {
    env.size = null;
    const unmeasured = render(<StatsView />, makeCtx(books));
    expect(count(unmeasured, '<svg role="img"')).toBe(2); // rings do not need a measured width
    expect(render(<StatsView />, makeCtx([]))).toContain('Még nincsenek könyvek');
    const filtered = render(<StatsView />, makeCtx(books, { visibleBooks: [], activeFilterCount: 1 }));
    expect(filtered).toContain('Nincs a szűrésnek megfelelő könyv');
  });
});

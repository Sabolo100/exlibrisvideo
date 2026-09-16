/**
 * Server-render tests of the collection shell: provider + page + header + toolbar + panel wiring,
 * PIN gate, empty / processing / error states, deep links, localisation. Views, drawer, processing
 * panel and uploader belong to other modules and are replaced by markers.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType, ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ search: '', refresh: () => {} }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: nav.refresh, push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
  usePathname: () => '/123456789',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// code-split views: render their loading state, like the first paint before the chunk arrives
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, opts?: { loading?: ComponentType }) => {
    const Loading = opts?.loading;
    return function DynamicStub() {
      return Loading ? <Loading /> : null;
    };
  },
}));

const { marker } = vi.hoisted(() => ({
  marker: (name: string) =>
    function Marker() {
      return <div data-marker={name} />;
    },
}));
vi.mock('@/components/views/ShelfView', () => ({ ShelfView: marker('view-shelf') }));
vi.mock('@/components/views/CoversView', () => ({ CoversView: marker('view-covers') }));
vi.mock('@/components/views/TableView', () => ({ TableView: marker('view-table') }));
vi.mock('@/components/views/AuthorsView', () => ({ AuthorsView: marker('view-authors') }));
vi.mock('@/components/views/TopicsView', () => ({ TopicsView: marker('view-topics') }));
vi.mock('@/components/views/TimelineView', () => ({ TimelineView: marker('view-timeline') }));
vi.mock('@/components/views/StatsView', () => ({ StatsView: marker('view-stats') }));
vi.mock('@/components/views/FramesView', () => ({ FramesView: marker('view-frames') }));
vi.mock('@/components/views/ReviewView', () => ({ ReviewView: marker('view-review') }));
vi.mock('@/components/book/BookDrawer', () => ({ BookDrawer: marker('drawer') }));
vi.mock('@/components/book/AddBookDialog', () => ({ AddBookDialog: () => null }));
vi.mock('@/components/book/MergeDialog', () => ({ MergeDialog: () => null }));
vi.mock('@/components/upload/Uploader', () => ({ Uploader: () => null }));
vi.mock('@/components/processing/ProcessingPanel', () => ({
  ProcessingPanel: ({ isOwner, initial }: { isOwner: boolean; initial: { id: string } }) => (
    <div data-marker="processing" data-owner={String(isOwner)} data-id={initial.id} />
  ),
}));

import { makeSampleBook } from '@/components/books/sample-books';
import { I18nProvider } from '@/i18n/client';
import type { BookDTO, CollectionWithBooksDTO, Locale } from '@/lib/types';
import { CollectionPage } from './CollectionPage';
import { CollectionProvider } from './CollectionProvider';
import { PinGate } from './PinGate';
import { PrintCatalogueContent } from './PrintCatalogue';

const BOOKS: BookDTO[] = [
  makeSampleBook({ id: 'b1', title: 'Abigél', author: 'Szabó Magda', authorSort: 'szabo magda', shelfPosition: 1, category: 'young_adult', pageCount: 300 }),
  makeSampleBook({ id: 'b2', title: 'Harmonia caelestis', author: 'Esterházy Péter', authorSort: 'esterhazy peter', shelfPosition: 2, category: 'hungarian_literature' }),
  makeSampleBook({ id: 'b3', title: 'Sorstalanság', author: 'Kertész Imre', authorSort: 'kertesz imre', shelfPosition: 3, needsReview: true, reviewed: false, confidence: 0.5 }),
];

function makeCollection(overrides: Partial<CollectionWithBooksDTO> = {}): CollectionWithBooksDTO {
  const books = overrides.books ?? BOOKS;
  return {
    id: '123456789',
    title: 'Nappali könyvespolc',
    description: 'A régi polc a kandalló mellett.',
    ownerName: 'Kovács Anna',
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: false,
    email: null,
    publicUrl: 'http://localhost:3000/123456789',
    bookCount: books.length,
    videos: [
      {
        id: 'v1',
        kind: 'video',
        sortOrder: 0,
        originalFilename: 'polc.mp4',
        sizeBytes: 1000,
        uploadStatus: 'uploaded',
        status: 'done',
        stage: 'done',
        progress: 100,
        durationSec: 9,
        framesTotal: 24,
        framesAnalyzed: 24,
        booksFound: books.length,
        error: null,
        createdAt: '2026-09-12T20:00:00.000Z',
        processedAt: '2026-09-12T20:05:00.000Z',
      },
    ],
    createdAt: '2026-09-12T20:00:00.000Z',
    updatedAt: '2026-09-12T20:05:00.000Z',
    emailSentAt: null,
    books,
    ...overrides,
  };
}

function render(ui: ReactElement, locale: Locale = 'hu'): string {
  return renderToStaticMarkup(<I18nProvider locale={locale}>{ui}</I18nProvider>);
}

function renderPage(collection: CollectionWithBooksDTO, locale: Locale = 'hu'): string {
  return render(
    <CollectionProvider initial={collection}>
      <CollectionPage />
    </CollectionProvider>,
    locale,
  );
}

/** Visible text: tags stripped, entities decoded, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const tabSelected = (html: string, view: string) => new RegExp(`id="collection-view-tab-${view}"[^>]*aria-selected="true"`).test(html);

beforeEach(() => {
  nav.search = '';
});

describe('CollectionPage – ready catalogue', () => {
  it('renders the header, toolbar and default shelf view for a visitor', () => {
    const html = renderPage(makeCollection());
    const visible = text(html);
    expect(html).toMatch(/<h1[^>]*>Nappali könyvespolc<\/h1>/);
    expect(visible).toContain('Kovács Anna könyvtára');
    expect(visible).toContain('3 könyv');
    expect(visible).toContain('3 szerző');
    expect(visible).toContain('Létrehozva: 2026. szeptember 12.');
    expect(visible).toContain('1 videóból');
    expect(html).toContain('role="tablist"');
    expect(tabSelected(html, 'shelf')).toBe(true);
    expect(html).toContain('collection-view-tab-frames');
    expect(html).not.toContain('collection-view-tab-review');
    expect(html).toContain('data-marker="view-shelf"');
    expect(html).toContain('data-marker="drawer"');
    expect(html).toContain('id="collection-search"');
    expect(visible).not.toContain('Szerkesztő mód');
    expect(html).not.toContain('aria-label="Beállítások"');
    expect(html).toContain('exl-catalogue');
  });

  it('shows owner tools and the review tab with its badge', () => {
    const html = renderPage(makeCollection({ isOwner: true, email: 'anna@example.com' }));
    const visible = text(html);
    expect(visible).toContain('Szerkesztő mód');
    expect(html).toContain('collection-view-tab-review');
    expect(visible).toContain('1 ellenőrizendő');
    expect(html).toContain('aria-label="Beállítások"');
    expect(visible).toContain('Hozzáadás');
    expect(html).toContain('aria-label="Cím szerkesztése"');
  });

  it('restores view, sort and search from the URL', () => {
    nav.search = 'view=table&sort=author&q=abig';
    const html = renderPage(makeCollection());
    expect(html).toContain('data-marker="view-table"');
    expect(tabSelected(html, 'table')).toBe(true);
    expect(html).toMatch(/id="collection-search"[^>]*value="abig"/);
    expect(text(html)).toContain('1 / 3 könyv');
    expect(html).toMatch(/<option value="author" selected="">/);
  });

  it('shows the loading state of code-split views', () => {
    nav.search = 'view=stats';
    const html = renderPage(makeCollection());
    expect(tabSelected(html, 'stats')).toBe(true);
    expect(text(html)).toContain('Nézet betöltése…');
  });

  it('falls back to the shelf when a visitor deep-links the review view', () => {
    nav.search = 'view=review';
    const html = renderPage(makeCollection());
    expect(tabSelected(html, 'shelf')).toBe(true);
    expect(html).toContain('data-marker="view-shelf"');
  });

  it('shows "no results" instead of a view when filters match nothing', () => {
    nav.search = 'q=zzzzzz';
    const html = renderPage(makeCollection());
    expect(text(html)).toContain('Nincs találat');
    expect(html).not.toContain('data-marker="view-shelf"');
  });

  it('localises to English', () => {
    const html = renderPage(makeCollection({ title: null, ownerName: null }), 'en');
    const visible = text(html);
    expect(html).toMatch(/<h1[^>]*>Library #123456789<\/h1>/);
    expect(visible).toContain('3 books');
    expect(visible).toContain('from 1 video');
    expect(visible).toContain('Shelf');
  });
});

describe('CollectionPage – other states', () => {
  it('hands draft / processing collections to the processing panel', () => {
    const html = renderPage(makeCollection({ status: 'processing', isOwner: true, books: [] }));
    expect(html).toContain('data-marker="processing"');
    expect(html).toContain('data-owner="true"');
    expect(html).not.toContain('id="collection-search"');
    expect(renderPage(makeCollection({ status: 'draft', books: [] }))).toContain('data-owner="false"');
  });

  it('shows the empty catalogue with next steps for the owner', () => {
    const html = renderPage(makeCollection({ isOwner: true, books: [] }));
    const visible = text(html);
    expect(visible).toContain('Még nincs könyv a katalógusban');
    expect(visible).toContain('Új videó feltöltése');
    expect(visible).toContain('Könyv felvétele kézzel');
    expect(visible).toContain('Így sikerül a felvétel');
    expect(html).not.toContain('role="tablist"');
  });

  it('tells visitors of an empty catalogue to come back later', () => {
    const visible = text(renderPage(makeCollection({ books: [] })));
    expect(visible).toContain('A könyvtár gazdája még nem vett fel könyveket.');
    expect(visible).not.toContain('Új videó feltöltése');
  });

  it('explains a failed processing run', () => {
    const visible = text(renderPage(makeCollection({ isOwner: true, status: 'error', books: [] })));
    expect(visible).toContain('Nem sikerült feldolgozni a felvételeket');
  });
});

describe('PrintCatalogueContent', () => {
  it('lists the shown books grouped by author, noting an active filter', () => {
    nav.search = 'q=a&sort=title';
    const html = render(
      <CollectionProvider initial={makeCollection()}>
        <PrintCatalogueContent printedAt={new Date('2026-09-13T10:00:00Z')} />
      </CollectionProvider>,
    );
    const visible = text(html);
    expect(html).toContain('exl-print-catalogue');
    expect(visible).toContain('Könyvtárkatalógus');
    expect(visible).toContain('Nyomtatva: 2026. szeptember 13.');
    expect(visible).toContain('Online: http://localhost:3000/123456789');
    // "a" matches every sample book, so the list is complete
    expect(visible).toContain('3 könyv – Nappali könyvespolc');
    expect(visible.indexOf('Esterházy Péter')).toBeLessThan(visible.indexOf('Kertész Imre'));
    expect(visible.indexOf('Kertész Imre')).toBeLessThan(visible.indexOf('Szabó Magda'));
  });

  it('prints the filtered subset', () => {
    nav.search = 'q=abig';
    const visible = text(
      render(
        <CollectionProvider initial={makeCollection()}>
          <PrintCatalogueContent printedAt={new Date('2026-09-13T10:00:00Z')} />
        </CollectionProvider>,
        'en',
      ),
    );
    expect(visible).toContain('Filtered list: 1 of 3 books');
    expect(visible).toContain('Szabó Magda');
    expect(visible).toContain('Abigél');
    expect(visible).not.toContain('Sorstalanság');
  });
});

describe('PinGate', () => {
  it('renders the lock screen in Hungarian', () => {
    const html = render(<PinGate id="123456789" title="Titkos polc" />);
    const visible = text(html);
    expect(visible).toContain('Védett könyvtár');
    expect(html).toMatch(/<h1[^>]*>Titkos polc<\/h1>/);
    expect(html).toMatch(/type="password"[^>]*inputMode="numeric"|inputMode="numeric"[^>]*type="password"/i);
    expect(html).toContain('href="/my"');
    expect(visible).toContain('Megnyitás');
  });

  it('falls back to the id and localises to English', () => {
    const visible = text(render(<PinGate id="123456789" title={null} />, 'en'));
    expect(visible).toContain('Protected library');
    expect(visible).toContain('Library #123456789');
    expect(visible).toContain('My collections');
  });
});

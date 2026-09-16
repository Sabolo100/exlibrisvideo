/**
 * Server-render tests of the book drawer body, the edit form and review mode (owner / visitor, hu / en).
 * Named *.spec.tsx: the project vitest config keeps tsconfig's `jsx: preserve`, which Vite cannot
 * execute, so this file needs a config with JSX enabled, e.g.
 *   npx vitest run --config <config with oxc: { jsx: { runtime: 'automatic' } }> src/components/book/book-ux.render.spec.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/123456789',
  useSearchParams: () => new URLSearchParams(),
}));

import { makeSampleBook } from '@/components/books/sample-books';
import { CollectionContext, EMPTY_FILTERS, type CollectionContextValue } from '@/components/collection/context';
import { ReviewView } from '@/components/views/ReviewView';
import { I18nProvider } from '@/i18n/client';
import type { BookDTO, CollectionWithBooksDTO, Locale } from '@/lib/types';
import { BookDetails } from './BookDrawer';
import { BookEditForm } from './BookEditForm';

function makeCtx(books: BookDTO[], overrides: Partial<CollectionContextValue> = {}): CollectionContextValue {
  const collection: CollectionWithBooksDTO = {
    id: '123456789',
    title: 'Teszt könyvtár',
    description: null,
    ownerName: null,
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: true,
    email: null,
    publicUrl: 'http://localhost/123456789',
    bookCount: books.length,
    videos: [
      {
        id: 'v1',
        kind: 'video',
        sortOrder: 0,
        originalFilename: '20260912_212903.mp4',
        sizeBytes: 1000,
        uploadStatus: 'uploaded',
        status: 'done',
        stage: 'done',
        progress: 100,
        durationSec: 9,
        framesTotal: 30,
        framesAnalyzed: 30,
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
  };
  return {
    collection,
    books,
    visibleBooks: books,
    isOwner: true,
    locale: 'hu',
    view: 'review',
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
    unreadSpines: [],
    resolveUnreadSpine: vi.fn(async () => null),
    dismissUnreadSpine: vi.fn(async () => true),
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

const pending = makeSampleBook({
  title: 'Sorstalanság',
  author: 'Kertész Imre',
  confidence: 0.52,
  needsReview: true,
  reviewed: false,
  spineAuthor: 'KERTÉSZ',
  spineTitle: 'Sorstalansag',
  descriptionHu: null,
  descriptionEn: 'A Nobel-prize-winning novel about a teenage boy in the camps.',
  firstPublishedYear: 1975,
  publisher: 'Magvető',
  pageCount: 332,
  category: 'hungarian_literature',
  topics: ['literary_fiction'],
  firstVideoId: 'v1',
  firstTimeSec: 75.2,
  shelfPosition: 1,
});
const second = makeSampleBook({ title: 'Az ajtó', author: 'Szabó Magda', confidence: 0.4, needsReview: true, reviewed: false, shelfPosition: 2 });
const fine = makeSampleBook({ title: 'Egri csillagok', author: 'Gárdonyi Géza', confidence: 0.95, shelfPosition: 3, notes: 'Kedvenc', lentTo: 'Anna', lentAt: '2026-08-01' });

describe('BookDetails (drawer body)', () => {
  it('renders bibliographic data, evidence and owner fields for the owner', () => {
    const ctx = makeCtx([pending, second, fine]);
    const html = render(<BookDetails book={pending} ctx={ctx} onEdit={() => {}} onMarkReviewed={() => {}} marking={false} />, ctx);
    expect(html).toContain('Sorstalanság');
    expect(html).toContain('Kertész Imre');
    expect(html).toContain('Magvető');
    expect(html).toContain('332 oldal');
    expect(html).toContain('Érdemes ellenőrizni');
    expect(html).toContain('A saját példányom');
    expect(html).toContain('Magyar leírás még nincs');
    expect(html).toContain('Így ismertük fel');
    expect(html).toContain('20260912_212903.mp4');
    expect(html).toContain('1:15');
    expect(html).toContain('„KERTÉSZ – Sorstalansag”');
  });

  it('is read-only for visitors and localises to English', () => {
    const ctx = makeCtx([pending, fine], { isOwner: false });
    const html = render(<BookDetails book={{ ...fine, notes: null, lentTo: null, lentAt: null, rating: 4, favorite: true }} ctx={ctx} onEdit={() => {}} onMarkReviewed={() => {}} marking={false} />, ctx, 'en');
    expect(html).not.toContain('My copy');
    expect(html).not.toContain('Worth a check');
    expect(html).toContain('Favourite');
    expect(html).toContain('How we recognised it');
  });

  it('shows the manual-entry note instead of evidence for manual books', () => {
    const manual = makeSampleBook({ title: 'Kézi könyv', source: 'manual', bestFrameId: null, spineImage: null, detectionCount: 0 });
    const ctx = makeCtx([manual]);
    const html = render(<BookDetails book={manual} ctx={ctx} onEdit={() => {}} onMarkReviewed={() => {}} marking={false} />, ctx);
    expect(html).toContain('kézzel került a katalógusba');
  });
});

describe('BookEditForm', () => {
  it('renders the fields prefilled', () => {
    const ctx = makeCtx([pending]);
    const html = render(<BookEditForm book={pending} onCancel={() => {}} />, ctx);
    expect(html).toContain('value="Sorstalanság"');
    expect(html).toContain('value="Kertész Imre"');
    expect(html).toContain('value="1975"');
    expect(html).toContain('Fő kategória');
    expect(html).toContain('Magyar irodalom');
  });
});

describe('ReviewView', () => {
  it('shows an owner-only message to visitors', () => {
    const ctx = makeCtx([pending], { isOwner: false });
    expect(render(<ReviewView />, ctx)).toContain('Az ellenőrzés csak a tulajdonosnak érhető el');
  });

  it('shows the first pending book with progress and shortcuts', () => {
    const ctx = makeCtx([fine, second, pending]);
    const html = render(<ReviewView />, ctx);
    expect(html).toContain('1 / 2');
    expect(html).toContain('Kertész Imre – Sorstalanság');
    expect(html).toContain('Még 2 könyv vár ellenőrzésre');
    expect(html).toContain('Ugyanaz, mint…');
    expect(html).toContain('Billentyűparancsok');
  });

  it('shows the empty state when nothing needs review', () => {
    const ctx = makeCtx([fine]);
    expect(render(<ReviewView />, ctx, 'en')).toContain('Nothing to review');
  });
});

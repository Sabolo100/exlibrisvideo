/**
 * Server-render smoke tests of the processing screen (react-dom/server, no DOM, effects do not run):
 * every phase renders in both languages, all i18n keys resolve and React reports no warnings. JSX module → run with
 *   npx vitest run <this file>  (root vitest.config.ts compiles JSX)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ desktop: true }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/123456789',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/hooks')>();
  return { ...actual, useMediaQuery: () => env.desktop };
});

vi.mock('@/lib/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/api')>();
  const never = () => new Promise<never>(() => {});
  return {
    ...actual,
    api: { ...actual.api, getStatus: vi.fn(never), getCollection: vi.fn(never), updateCollection: vi.fn(never), deleteUpload: vi.fn(never) },
  };
});

import { makeSampleBook } from '@/components/books/sample-books';
import { I18nProvider } from '@/i18n/client';
import type { BookDTO, CollectionWithBooksDTO, Locale, VideoDTO } from '@/lib/types';
import { ProcessingPanel } from './ProcessingPanel';

function video(p: Partial<VideoDTO> = {}): VideoDTO {
  return {
    id: 'v1',
    kind: 'video',
    sortOrder: 0,
    originalFilename: '20260912_212903.mp4',
    sizeBytes: 48_000_000,
    uploadStatus: 'uploaded',
    status: 'processing',
    stage: 'vision',
    progress: 42,
    durationSec: 9.4,
    framesTotal: 40,
    framesAnalyzed: 12,
    booksFound: 7,
    error: null,
    createdAt: '2026-09-13T10:00:00.000Z',
    processedAt: null,
    ...p,
  };
}

function collection(p: Partial<CollectionWithBooksDTO> = {}): CollectionWithBooksDTO {
  const books = p.books ?? [];
  return {
    id: '123456789',
    title: 'Nappali könyvespolc',
    description: null,
    ownerName: null,
    locale: 'hu',
    visibility: 'link',
    status: 'processing',
    isOwner: true,
    email: null,
    publicUrl: 'http://localhost:3000/123456789',
    bookCount: books.length,
    videos: [video()],
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:01:00.000Z',
    emailSentAt: null,
    ...p,
    books,
  };
}

const BOOKS: BookDTO[] = [
  makeSampleBook({ id: 'b1', title: 'Az ajtó', author: 'Szabó Magda', shelfPosition: 1 }),
  makeSampleBook({ id: 'b2', title: 'Sorstalanság', author: 'Kertész Imre', shelfPosition: 2 }),
  makeSampleBook({ id: 'b3', title: 'Egri csillagok', author: 'Gárdonyi Géza', shelfPosition: 3 }),
];

function render(initial: CollectionWithBooksDTO, isOwner: boolean, locale: Locale = 'hu'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ProcessingPanel initial={initial} isOwner={isOwner} onReady={() => {}} />
    </I18nProvider>,
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  env.desktop = true;
  const capture = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(warnings).toEqual([]);
});

describe('ProcessingPanel', () => {
  it('shows live processing for the owner: stepper, frames, share block, e-mail capture, uploader, shelf (hu)', () => {
    const html = render(
      collection({
        books: BOOKS,
        videos: [video(), video({ id: 'v2', sortOrder: 1, originalFilename: 'polc2.mov', status: 'queued', stage: null, progress: 0, framesTotal: 0, framesAnalyzed: 0, booksFound: 0 })],
      }),
      true,
    );
    expect(html).toContain('Nappali könyvespolc');
    expect(html).toContain('Olvassuk a könyvgerinceket');
    expect(html).toContain('A gerincek kiolvasása');
    expect(html).toContain('12 / 40 képkocka');
    expect(html).toContain('7 könyv');
    expect(html).toContain('Sorra vár');
    expect(html).toContain('Feldolgozási lépések');
    expect(html).toContain('Eddig 3 könyvet találtunk');
    expect(html).toContain('Ezen a linken lesz a könyvtárad');
    expect(html).toContain('http://localhost:3000/123456789');
    expect(html).toContain('Szóljunk, ha kész?');
    expect(html).toContain('További videók hozzáadása');
    expect(html).toContain('Amíg vársz');
    expect(html).toContain(esc('Szabó Magda – Az ajtó'));
    expect(html).toContain('Így telik meg a polcod');
    // overall progress: (42 + 0) / 2 sources
    expect(html).toContain('aria-valuenow="21"');
  });

  it('explains failures with guidance and hides owner-only tools from viewers (en)', () => {
    const html = render(
      collection({
        status: 'error',
        isOwner: false,
        videos: [video({ status: 'error', stage: 'merge', error: 'no_books', booksFound: 0 })],
      }),
      false,
      'en',
    );
    expect(html).toContain(esc("We couldn't process this one"));
    expect(html).toContain(esc("We couldn't read any book spines"));
    expect(html).toContain('Move closer to the shelf (20–40 cm)');
    expect(html).toContain('This page refreshes by itself');
    expect(html).not.toContain('Shall we let you know?');
    expect(html).not.toContain('Add more videos');
    expect(html).not.toContain('>Remove<');
  });

  it('maps every pipeline error code and failed uploads to localized texts', () => {
    const codes = ['too_long', 'unreadable', 'no_frames', 'ai_failed', 'internal', 'some legacy message'] as const;
    const html = render(
      collection({
        status: 'error',
        videos: [
          ...codes.map((code, i) => video({ id: `e${i}`, sortOrder: i, status: 'error', stage: 'probe', error: code })),
          video({ id: 'uf', sortOrder: 9, uploadStatus: 'failed', status: 'error', stage: null }),
        ],
      }),
      true,
    );
    expect(html).toContain('Túl hosszú a videó');
    // until GET /api/config answers (never during the server render) the default limit is quoted
    expect(html).toContain('Legfeljebb 10 perc hosszú felvételt tudunk feldolgozni.');
    expect(html).toContain('Nem tudtuk megnyitni a fájlt');
    expect(html).toContain('Nem találtunk használható képkockát');
    expect(html).toContain('A felismerő szolgáltatás most nem érhető el');
    expect(html.split('Váratlan hiba történt').length - 1).toBe(2); // internal + unknown legacy text
    expect(html).toContain('A feltöltés nem sikerült');
    expect(html).toContain('Eltávolítás');
  });

  it('invites the owner to upload when the draft is empty (en)', () => {
    const html = render(collection({ status: 'draft', videos: [], title: null }), true, 'en');
    expect(html).toContain('Your library catalogue');
    expect(html).toContain('No video uploaded yet');
    expect(html).toContain('Add more videos');
    expect(html).not.toContain('Watch your shelf fill up');
    const viewer = render(collection({ status: 'draft', videos: [], title: null }), false, 'en');
    expect(viewer).toContain('the owner will upload the shelf video soon');
  });

  it('shows enrichment and an already given e-mail address (hu)', () => {
    const html = render(
      collection({
        books: BOOKS,
        email: 'anna@example.com',
        videos: [video({ status: 'done', stage: 'enrich', progress: 100 })],
      }),
      true,
    );
    expect(html).toContain('Az utolsó simítások');
    expect(html).toContain('Adatok és borítók');
    expect(html).toContain('Amint elkészül, értesítünk ide: anna@example.com');
    expect(html).not.toContain('Kérem az értesítést');
  });

  it('offers to resume an interrupted upload and to remove it (hu, phone layout)', () => {
    env.desktop = false;
    const html = render(
      collection({
        status: 'draft',
        videos: [video({ uploadStatus: 'uploading', status: 'pending', stage: null, progress: 0, framesTotal: 0, framesAnalyzed: 0, booksFound: 0 })],
      }),
      true,
    );
    expect(html).toContain('Megszakadt a feltöltés');
    expect(html).toContain('Félbemaradt feltöltés');
    expect(html).toContain('Félbemaradt feltöltés folytatása');
    expect(html).toContain('Eltávolítás');
  });
});

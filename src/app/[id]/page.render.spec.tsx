/**
 * `/[id]` Server Component and metadata with the data layer mocked. JSX module → run with
 *   npx vitest run <this file>  (root vitest.config.ts compiles JSX)
 */
import fs from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uiMode: vi.fn(async () => 'web' as 'web' | 'app'),
  load: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/collections/queries', () => ({ loadCollectionPage: mocks.load }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/i18n/server', async () => {
  const { getTranslator } = await import('@/i18n');
  return { getServerT: async () => getTranslator('hu'), getRequestLocale: async () => 'hu' };
});
vi.mock('@/components/collection/CollectionPage', () => ({ CollectionPage: function CollectionPage() { return null; } }));
vi.mock('@/components/collection/CollectionProvider', () => ({
  CollectionProvider: function CollectionProvider() {
    return null;
  },
}));
vi.mock('@/components/collection/PinGate', () => ({ PinGate: function PinGate() { return null; } }));
vi.mock('@/components/app/ui-mode.server', () => ({ getUiMode: mocks.uiMode }));
vi.mock('@/components/app/AppCollection', () => ({ AppCollection: function AppCollection() { return null; } }));
vi.mock('@/components/app/AppPinGate', () => ({ AppPinGate: function AppPinGate() { return null; } }));

import { UiModeProvider } from '@/components/app/UiModeProvider';
import { makeSampleBook } from '@/components/books/sample-books';
import { SessionProvider } from '@/components/site/SessionProvider';
import type { CollectionWithBooksDTO, SessionUserDTO } from '@/lib/types';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionLoading from './loading';
import CollectionRoute, { dynamic, generateMetadata } from './page';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function data(overrides: Partial<CollectionWithBooksDTO> = {}): CollectionWithBooksDTO {
  const books = overrides.books ?? [
    makeSampleBook({ id: 'a', title: 'Abigél', author: 'Szabó Magda' }),
    makeSampleBook({ id: 'b', title: 'Az ajtó', author: 'Szabó Magda' }),
    makeSampleBook({ id: 'c', title: 'Sorstalanság', author: 'Kertész Imre' }),
  ];
  return {
    id: '334345435',
    title: 'Nappali',
    description: null,
    ownerName: 'Kovács Anna',
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: false,
    email: null,
    publicUrl: 'https://www.exlibrisvideo.hu/334345435',
    bookCount: books.length,
    videos: [],
    createdAt: '2026-09-12T20:00:00.000Z',
    updatedAt: '2026-09-12T20:00:00.000Z',
    emailSentAt: null,
    isAccountLibrary: false,
    books,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.notFound.mockClear();
});

describe('/[id] page', () => {
  it('is dynamic', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404s malformed ids without touching the database', async () => {
    for (const id of ['12345678', '012345678', '1234567890', 'abcdefghi', '33434543x']) {
      await expect(CollectionRoute(params(id))).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('404s unknown collections', async () => {
    mocks.load.mockResolvedValue({ kind: 'not_found' });
    await expect(CollectionRoute(params('999999999'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).toHaveBeenCalledWith('999999999');
  });

  it('shows the PIN gate for protected collections', async () => {
    mocks.load.mockResolvedValue({ kind: 'needs_pin', id: '334345435', title: 'Titkos polc' });
    const el = (await CollectionRoute(params('334345435'))) as ReactElement<{ id: string; title: string | null }>;
    expect(isValidElement(el)).toBe(true);
    expect((el.type as { name: string }).name).toBe('PinGate');
    expect(el.props).toMatchObject({ id: '334345435', title: 'Titkos polc' });
  });

  it('hands the data to the client shell', async () => {
    const d = data();
    mocks.load.mockResolvedValue({ kind: 'ok', data: d });
    const el = (await CollectionRoute(params('334345435'))) as ReactElement<{ initial: CollectionWithBooksDTO; children: ReactElement }>;
    expect((el.type as { name: string }).name).toBe('CollectionProvider');
    expect(el.props.initial).toBe(d);
    expect(el.key).toBe('334345435');
    expect((el.props.children.type as { name: string }).name).toBe('CollectionPage');
  });

  it('renders the phone app screens in app mode', async () => {
    mocks.uiMode.mockResolvedValueOnce('app').mockResolvedValueOnce('app');
    const d = data();
    mocks.load.mockResolvedValue({ kind: 'ok', data: d });
    const el = (await CollectionRoute(params('334345435'))) as ReactElement<{ children: ReactElement }>;
    expect((el.props.children.type as { name: string }).name).toBe('AppCollection');

    mocks.load.mockResolvedValue({ kind: 'needs_pin', id: '334345435', title: 'Titkos polc' });
    const gate = (await CollectionRoute(params('334345435'))) as ReactElement;
    expect((gate.type as { name: string }).name).toBe('AppPinGate');
  });
});

describe('/[id] loading skeleton', () => {
  const user: SessionUserDTO = { id: 'u1', email: 'anna@example.com', name: 'Anna', picture: null, libraryId: '334345435' };
  const renderSkeleton = async (who: SessionUserDTO | null = null, mode: 'web' | 'app' = 'web') =>
    renderToStaticMarkup(
      <UiModeProvider mode={mode}>
        <SessionProvider user={who} authEnabled>
          {await CollectionLoading()}
        </SessionProvider>
      </UiModeProvider>,
    );

  it('renders an accessible, deterministic ghost of the catalogue', async () => {
    const first = await renderSkeleton();
    const second = await renderSkeleton();
    expect(first).toBe(second);
    expect(first).toContain('role="status"');
    expect(first).toContain('aria-busy="true"');
    expect(first).toContain('A könyvtár betöltése…');
  });

  it('draws ONE plank, never a wall of planks that collapses when a small library arrives', async () => {
    const html = await renderSkeleton();
    expect(html.match(/data-skeleton-row=/g)?.length).toBe(1);
    // twelve ghost spines and the ghost bookend on that plank
    expect(html.match(/rounded-t-\[3px\]/g)?.length).toBe(12 + 1);
  });

  it('shows up only after a short wait, so a quick load never flashes it', async () => {
    expect(await renderSkeleton()).toContain('exl-loading-fade');
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/\.exl-loading-fade\s*\{[^}]*animation:[^;]*\b\d+ms ease-out (\d+)ms backwards/);
    const delay = Number(/\.exl-loading-fade\s*\{[^}]*animation:[^;]*\b\d+ms ease-out (\d+)ms backwards/.exec(css)?.[1]);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(300);
  });

  it('includes the ghost of the owner add block only for a signed-in visitor on the website', async () => {
    // the add block ghost is the only place with three 164 px tiles
    const tiles = (html: string) => html.match(/h-\[10\.25rem\]/g)?.length ?? 0;
    expect(tiles(await renderSkeleton(null))).toBe(0);
    expect(tiles(await renderSkeleton(user))).toBe(3);
    // the phone app has no such block
    expect(tiles(await renderSkeleton(user, 'app'))).toBe(0);
    // still one plank either way
    expect((await renderSkeleton(user)).match(/data-skeleton-row=/g)?.length).toBe(1);
  });
});

describe('/[id] metadata', () => {
  it('titles and describes a ready collection, never indexed', async () => {
    mocks.load.mockResolvedValue({ kind: 'ok', data: data() });
    const meta = await generateMetadata(params('334345435'));
    expect(meta.title).toBe('Nappali');
    expect(meta.description).toBe('3 könyv, 2 szerző – böngészhető könyvtárkatalógus az Ex Libris Videón.');
    expect(meta.robots).toMatchObject({ index: false, follow: false });
    expect(meta.openGraph).toMatchObject({ title: 'Nappali', url: 'https://www.exlibrisvideo.hu/334345435' });
  });

  it('falls back to the owner or the id and describes processing / empty collections', async () => {
    mocks.load.mockResolvedValue({ kind: 'ok', data: data({ title: null, status: 'processing', books: [] }) });
    let meta = await generateMetadata(params('334345435'));
    expect(meta.title).toBe('Kovács Anna könyvtára');
    expect(meta.description).toBe('A katalógus épp most készül egy könyvespolc-videóból.');

    mocks.load.mockResolvedValue({ kind: 'ok', data: data({ title: null, ownerName: null, books: [] }) });
    meta = await generateMetadata(params('334345435'));
    expect(meta.title).toBe('Könyvtár #334345435');
    expect(meta.description).toBe('Könyvtárkatalógus az Ex Libris Videón.');
  });

  it('reveals nothing about a protected collection', async () => {
    mocks.load.mockResolvedValue({ kind: 'needs_pin', id: '334345435', title: 'Titkos polc' });
    const meta = await generateMetadata(params('334345435'));
    expect(meta.title).toBe('Védett könyvtár');
    expect(JSON.stringify(meta)).not.toContain('Titkos polc');
    expect(meta.robots).toMatchObject({ index: false });
  });

  it('adds only robots for unknown or malformed ids', async () => {
    mocks.load.mockResolvedValue({ kind: 'not_found' });
    expect(Object.keys(await generateMetadata(params('999999999')))).toEqual(['robots']);
    expect(Object.keys(await generateMetadata(params('nope')))).toEqual(['robots']);
  });
});

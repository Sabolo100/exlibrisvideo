/**
 * Server-render smoke tests of the landing page sections, the legal pages, /my, 404 and the error boundary
 * (react-dom/server, no DOM): both languages, all i18n keys resolve, React reports no warnings.
 * Async Server Components are awaited first, then their element tree is rendered. JSX module → run with
 *   npx vitest run <this file>  (root vitest.config.ts compiles JSX)
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/types';

const current = vi.hoisted(() => {
  // non-default upload limits: the uploader, the FAQ and the terms must quote these, not the env defaults
  Object.assign(process.env, { MAX_UPLOAD_MB: '2048', MAX_SOURCES_PER_COLLECTION: '20', MAX_VIDEO_SECONDS: '300' });
  return { locale: 'hu' as 'hu' | 'en' };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/server', async () => {
  const { getTranslator } = await import('@/i18n');
  return {
    getRequestLocale: async () => current.locale,
    getServerT: async () => getTranslator(current.locale),
    localeFromRequest: () => current.locale,
  };
});

import HomePage, { generateMetadata as homeMetadata } from '@/app/page';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import { MyCollections } from '@/app/my/MyCollections';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import { I18nProvider } from '@/i18n/client';
import { Faq } from './Faq';
import { faqJsonLd, FAQ_ITEMS } from './faq-items';
import { FilmingTips } from './FilmingTips';
import { FinalCta } from './FinalCta';
import { Hero } from './Hero';
import { HERO_BOOKS } from './hero-books';
import { HowItWorks } from './HowItWorks';
import { PrivacyPromise } from './PrivacyPromise';
import { WhatYouGet } from './WhatYouGet';

type AsyncComponent = (props: Record<string, unknown>) => Promise<ReactElement>;

/** Resolves async Server Components at the top of an element (pages return <LegalDocument/> etc.). */
async function resolve(node: ReactElement | Promise<ReactElement>): Promise<ReactElement> {
  let el = await node;
  while (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    el = await (el.type as AsyncComponent)(el.props as Record<string, unknown>);
  }
  return el;
}

/** `make` runs after the request locale is set (Server Components read it when they start). */
async function render(make: () => ReactElement | Promise<ReactElement>, locale: Locale = 'hu'): Promise<string> {
  current.locale = locale;
  const el = await resolve(make());
  return renderToStaticMarkup(<I18nProvider locale={locale}>{el}</I18nProvider>);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;');
const count = (html: string, needle: string) => html.split(needle).length - 1;

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  const capture = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(warnings).toEqual([]);
});

describe('landing page', () => {
  it('composes every section and localizes the metadata', async () => {
    const page = await HomePage();
    const sections = (page.props as { children: ReactElement[] }).children;
    expect(sections.map((s) => (s.type as { name: string }).name)).toEqual([
      'Hero',
      'HowItWorks',
      'FilmingTips',
      'WhatYouGet',
      'PrivacyPromise',
      'Faq',
      'FinalCta',
    ]);
    current.locale = 'hu';
    const hu = await homeMetadata();
    expect(hu.title).toEqual({ absolute: 'Ex Libris Video – könyvespolc-videóból könyvkatalógus' });
    current.locale = 'en';
    const en = await homeMetadata();
    expect(String(en.description)).toContain('Film your bookshelf');
  });

  it('hero: headline, the uploader itself with camera capture, animated shelf of classics (hu)', async () => {
    const html = await render(() => Hero({ demoCollectionId: '123456789' }));
    expect(html).toContain('Filmezd le a könyvespolcodat');
    expect(html).toContain('id="upload"');
    expect(html).toContain('Töltsd fel a polcvideódat');
    expect(html).toContain('Videó felvétele');
    expect(html).toContain('Választás a galériából');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('multiple');
    expect(html).toContain('href="/123456789"');
    // the limits of the server environment, already in the server render
    expect(html).toContain('fájlonként legfeljebb 2 GB · összesen 20 fájl');
    expect(HERO_BOOKS).toHaveLength(18);
    // two bookcase variants (phone / wider screens) × 18 spines
    expect(count(html, esc('Jókai Mór – Az arany ember'))).toBeGreaterThanOrEqual(2);
    expect(html).toContain('18 könyv a polcon');
  });

  it('hero in English without a demo link', async () => {
    const html = await render(() => Hero({ demoCollectionId: null }), 'en');
    expect(html).toContain(esc('Film your bookshelf – we’ll turn it into a catalogue'));
    expect(html).toContain('Upload your shelf video');
    expect(html).toContain('up to 2 GB per file · 20 files in total');
    expect(html).not.toContain('See a finished catalogue');
  });

  it('how it works, filming tips with diagrams, what you get (en)', async () => {
    const how = await render(() => HowItWorks(), 'en');
    expect(count(how, '<h3')).toBe(3);
    expect(how).toContain('Film your shelf');
    const tips = await render(() => FilmingTips(), 'en');
    expect(count(tips, '<svg')).toBe(6);
    expect(tips).toContain('Stay 20–40 cm away');
    expect(tips).toContain('Several short clips are fine');
    const get = await render(() => WhatYouGet(), 'hu');
    for (const title of ['Virtuális könyvespolc', 'Borítófal', 'Statisztikák', 'Szerkeszthető táblázat', 'Excel e-mailben']) {
      expect(get).toContain(title);
    }
  });

  it('privacy promise, FAQ with structured data and the final call to action (hu)', async () => {
    const privacy = await render(() => PrivacyPromise());
    expect(privacy).toContain('href="/privacy"');
    expect(privacy).toContain('Hetzner');
    const faq = await render(() => Faq());
    expect(count(faq, '<details')).toBe(FAQ_ITEMS.length);
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(8);
    expect(faq).toContain('application/ld+json');
    expect(faq).toContain('Mennyibe kerül?');
    // the answer and its structured data quote the configured file limit
    expect(count(faq, 'egy katalógusba legfeljebb 20 fájl fér')).toBe(2);
    expect(faq).not.toContain('{maxFiles}');
    const cta = await render(() => FinalCta({ demoCollectionId: null }));
    expect(cta).toContain('href="/#upload"');
    expect(cta).toContain('href="/my"');
  });

  it('escapes the FAQ JSON-LD so it can never close its script element', () => {
    const json = faqJsonLd(() => '</script><script>alert(1)</script>');
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json).mainEntity).toHaveLength(FAQ_ITEMS.length);
  });
});

describe('legal pages', () => {
  it('privacy policy names the processors, hosting, retention and the operator placeholder (hu)', async () => {
    const html = await render(() => PrivacyPage());
    expect(html).toContain('Adatkezelési tájékoztató');
    expect(html).toContain('Anthropic');
    expect(html).toContain('DeepSeek');
    expect(html).toContain('Hetzner Online GmbH');
    expect(html).toContain('[Az üzemeltető neve');
    expect(html).toContain('mailto:hello@exlibrisvideo.hu');
    expect(html).toContain('href="#cookies"');
    expect(html).toContain('href="/terms"');
    expect(count(html, '<h2')).toBe(11); // table of contents + 10 sections
  });

  it('terms of use in English', async () => {
    const html = await render(() => TermsPage(), 'en');
    expect(html).toContain('Terms of use');
    expect(html).toContain('[Operator name');
    expect(html).toContain('Hungarian law');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('A file can be at most 2 GB in size and 5 minutes long, and a catalogue can hold at most 20 files.');
  });

  it('terms of use quote the configured limits in Hungarian too', async () => {
    const html = await render(() => TermsPage());
    expect(html).toContain('Egy fájl legfeljebb 2 GB méretű és 5 perc hosszú lehet, egy katalógusba legfeljebb 20 fájl kerülhet.');
    expect(html).not.toMatch(/\{max\w*\}/);
  });
});

describe('secondary pages', () => {
  it('404 page offers home, my collections and open by id (hu)', async () => {
    const html = await render(() => NotFound());
    expect(html).toContain('Ez a könyv nincs a polcon');
    expect(html).toContain('Keresd meg az azonosítója alapján');
    expect(html).toContain('placeholder="pl. 334345435"');
    expect(html).toContain('href="/my"');
  });

  it('error boundary shows retry and the error digest (en)', async () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    const html = await render(() => <ErrorPage error={error} reset={() => {}} />, 'en');
    expect(html).toContain('Oops, something got stuck');
    expect(html).toContain('Try again');
    expect(html).toContain('Error code: abc123');
  });

  it('my collections renders the skeleton list, open-by-id and recovery forms (hu)', async () => {
    const html = await render(() => <MyCollections />);
    expect(html).toContain('Kollekcióim');
    expect(html).toContain('Katalógusok betöltése…');
    expect(html).toContain('Megnyitás azonosító alapján');
    expect(html).toContain('Elvesztetted a linket?');
    expect(html).toContain('type="email"');
  });
});

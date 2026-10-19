/**
 * Server-render smoke test of the phone app's home screen (react-dom/server, no DOM): the promo video sits at the very
 * top – above the headline, the record action and everything else – and costs the first paint only its poster.
 * JSX module → run with  npx vitest run <this file>  (root vitest.config.ts compiles JSX)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { AppHome } from './AppHome';
import { PROMO_MEDIA } from '@/components/landing/PromoVideo';
import { I18nProvider } from '@/i18n/client';
import { SessionProvider } from '@/components/site/SessionProvider';

function render(locale: Locale = 'hu'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <SessionProvider user={null} authEnabled>
        <AppHome />
      </SessionProvider>
    </I18nProvider>,
  );
}

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

describe('phone app home', () => {
  it('the promo video is the first thing under the app bar: video → headline → sign-in → record action → tiles', () => {
    const hu = render();
    const video = hu.indexOf('<video');
    expect(video).toBeGreaterThan(-1);
    for (const later of ['Filmezd le a polcodat', 'Egy könyvtár, ami veled marad', 'Polc felvétele', 'Galériából']) {
      expect(hu.indexOf(later), later).toBeGreaterThan(video);
    }
    // the little static shelf of spines is gone
    expect(hu).not.toContain('exl-spine');
  });

  it('costs the first paint only the poster: no video request yet, muted inline player, controls for touch', () => {
    const hu = render();
    expect(hu).toContain(`src="${PROMO_MEDIA.hu.poster}"`);
    expect(hu).toMatch(/fetchpriority="high"/i);
    expect(hu).toMatch(/<video[^>]*preload="none"/);
    expect(hu).not.toMatch(/<video[^>]*\ssrc=/);
    expect(hu).not.toContain(PROMO_MEDIA.hu.video);
    expect(hu).toMatch(/<video[^>]*muted/);
    expect(hu).toMatch(/<video[^>]*playsinline/i);
    expect(hu).toContain('aria-label="Hang be"'); // the unmute switch is there for the touch screen
  });

  it('the English home has the same order and plays the English video (its own poster, no note about the language)', () => {
    const en = render('en');
    expect(en.indexOf('<video')).toBeLessThan(en.indexOf('Film your bookshelf'));
    expect(en).toContain(`src="${PROMO_MEDIA.en.poster}"`);
    expect(en).not.toContain(PROMO_MEDIA.hu.poster);
    expect(en).not.toContain(PROMO_MEDIA.en.video); // first paint: the poster only
    expect(en).not.toContain('in Hungarian');
  });
});

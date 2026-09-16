/**
 * Server-render tests of the in-app recorder (react-dom/server, no DOM, effects do not run): the closed recorder
 * renders nothing, the open one waits for the client (portal), every fallback screen and the main camera states
 * render in both languages with all i18n keys resolved and without React warnings. JSX module → run with
 *   npx vitest run src/components/camera   (root vitest.config.ts compiles JSX)
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// I18nProvider asks for the router (locale switch)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

import { I18nProvider } from '@/i18n/client';
import { camera as messages } from '@/i18n/messages/camera';
import type { Locale } from '@/lib/types';
import type { CameraProblem, Platform } from './camera';
import { CameraFallback, type CameraFallbackProps } from './CameraFallback';
import { CameraRecorder } from './CameraRecorder';
import { CameraScreen, type CameraScreenActions } from './CameraScreen';
import type { CameraSessionState, RecordedClip } from './useCameraSession';

const PROBLEMS: CameraProblem[] = ['insecure', 'unsupported', 'denied', 'not_found', 'in_use', 'unknown'];
const LOCALES: Locale[] = ['hu', 'en'];

/** text of the markup (tags stripped, entities decoded, whitespace collapsed) */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const decode = (s: string) => s.replace(/\s+/g, ' ').trim();

/** attributes of the first <button> whose aria-label or text contains `label` */
function buttonAttrs(html: string, label: string): string | undefined {
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (m[1].includes(`aria-label="${label}"`) || text(m[2]).includes(label)) return m[1];
  }
  return undefined;
}
const isDisabled = (html: string, label: string) => {
  const attrs = buttonAttrs(html, label);
  if (attrs === undefined) throw new Error(`no button "${label}"`);
  return /\sdisabled=""/.test(attrs);
};

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

const noop = () => {};

function renderFallback(props: Partial<CameraFallbackProps> & { problem: CameraProblem }, locale: Locale = 'hu'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <CameraFallback platform="android" onRetry={noop} onNativeFiles={noop} onCancel={noop} {...props} />
    </I18nProvider>,
  );
}

const ACTIONS: CameraScreenActions = {
  attachVideo: noop,
  onVideoReady: noop,
  onClose: noop,
  onShutter: noop,
  onToggleTorch: noop,
  onSwitchCamera: noop,
  onOpenReview: noop,
  onDone: noop,
  onRetry: noop,
  onNativeFiles: noop,
  onUseClips: noop,
};

const BASE_STATE: CameraSessionState = {
  status: 'live',
  problem: null,
  mirrored: false,
  videoReady: true,
  freezeFrame: null,
  canSwitch: false,
  torchSupported: false,
  torchOn: false,
  phase: 'idle',
  elapsedSec: 0,
  clips: [],
  notice: null,
  announcement: null,
};

function clip(i: number): RecordedClip {
  return {
    id: `clip-${i}`,
    file: new File([new Uint8Array(1024)], `polc-20260916-10000${i}.mp4`, { type: 'video/mp4' }),
    url: `blob:clip-${i}`,
    thumbnail: 'data:image/jpeg;base64,AAAA',
    durationSec: 12 + i,
  };
}

function renderScreen(state: Partial<CameraSessionState>, locale: Locale = 'hu', maxDurationSec = 180, platform: Platform = 'ios'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <CameraScreen
        state={{ ...BASE_STATE, ...state }}
        maxDurationSec={maxDurationSec}
        platform={platform}
        iosApp="Safari"
        actions={ACTIONS}
      />
    </I18nProvider>,
  );
}

describe('CameraRecorder', () => {
  it('renders nothing while closed', () => {
    for (const locale of LOCALES) {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <CameraRecorder open={false} onClose={noop} onDone={noop} />
        </I18nProvider>,
      );
      expect(html).toBe('');
    }
  });

  it('waits for the client when open (portal after hydration, no camera access on the server)', () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="hu">
        <CameraRecorder open onClose={noop} onDone={noop} maxDurationSec={60} />
      </I18nProvider>,
    );
    expect(html).toBe('');
  });
});

describe('CameraFallback', () => {
  it.each(LOCALES)('renders every problem with its title, body and the native camera button (%s)', (locale) => {
    const dict = messages[locale];
    for (const problem of PROBLEMS) {
      const html = renderFallback({ problem }, locale);
      const t = text(html);
      expect(t).toContain(decode(dict[`fallback.${problem}.title`]));
      expect(t).toContain(decode(dict[`fallback.${problem}.body`]));
      expect(t).toContain(decode(dict['fallback.native']));
      expect(t).toContain(dict['fallback.cancel']);
      expect(html).toContain(`data-problem="${problem}"`);
      expect(t).not.toMatch(/camera\.[a-z]/); // no unresolved keys
      // hidden native capture input opened by the button
      expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="video\/\*"[^>]*capture="environment"/);
      expect(html).toContain(`aria-label="${dict['action.close']}"`);
    }
  });

  it('offers "try again" only where it can help', () => {
    for (const problem of PROBLEMS) {
      const t = text(renderFallback({ problem }));
      const retry = problem !== 'insecure' && problem !== 'unsupported';
      expect(t.includes('Próbáld újra'), problem).toBe(retry);
    }
  });

  it('explains plain http and still offers the phone camera', () => {
    const t = text(renderFallback({ problem: 'insecure' }));
    expect(t).toContain('A beépített kamera csak biztonságos (https) kapcsolaton érhető el');
    expect(t).toContain('Felvétel a telefon kamerájával');
  });

  it('shows the permission path for the platform when access was denied', () => {
    const android = text(renderFallback({ problem: 'denied', platform: 'android' }));
    expect(android).toContain('Android: koppints a címsorban a lakat ikonra → Engedélyek → Kamera');
    expect(android).not.toContain('Beállítások');

    const ios = text(renderFallback({ problem: 'denied', platform: 'ios', iosApp: 'Safari' }));
    expect(ios).toContain('iPhone, iPad: Beállítások → Safari → Kamera → Engedélyezés');
    const iosChrome = text(renderFallback({ problem: 'denied', platform: 'ios', iosApp: 'Chrome' }, 'en'));
    expect(iosChrome).toContain('iPhone, iPad: Settings → Chrome → Camera → Allow');

    const desktop = text(renderFallback({ problem: 'denied', platform: 'other' }, 'en'));
    expect(desktop).toContain('On a computer: click the lock icon in the address bar and allow the camera.');

    expect(text(renderFallback({ problem: 'in_use', platform: 'android' }))).not.toContain('Így engedélyezheted');
  });

  it('lets the user keep clips recorded before the camera failed', () => {
    const one = text(renderFallback({ problem: 'in_use', clipCount: 1, onUseClips: noop }));
    expect(one).toContain('Kész – 1 felvétel használata');
    const en = text(renderFallback({ problem: 'unknown', clipCount: 3, onUseClips: noop }, 'en'));
    expect(en).toContain('Done – use 3 clips');
    expect(text(renderFallback({ problem: 'unknown', clipCount: 0, onUseClips: noop }))).not.toContain('használata');
  });
});

describe('CameraScreen', () => {
  it('shows a starting indicator and a disabled shutter before the camera runs', () => {
    const html = renderScreen({ status: 'starting', videoReady: false });
    expect(text(html)).toContain('Kamera indítása…');
    expect(isDisabled(html, 'Felvétel indítása')).toBe(true);
  });

  it.each(LOCALES)('guides before the first clip with the grid and a neutral "done" (%s)', (locale) => {
    const dict = messages[locale];
    const html = renderScreen({}, locale);
    const t = text(html);
    expect(t).toContain(dict['guide.title']);
    expect(t).toContain(dict['guide.body']);
    expect(html).toContain(`aria-label="${dict['action.start']}"`);
    expect(html).toContain(`aria-label="${dict['action.close']}"`);
    expect(t).toContain(dict['action.done'].replace('{count}', '0'));
    expect(isDisabled(html, dict['action.done'].replace('{count}', '0'))).toBe(true);
    expect(isDisabled(html, dict['action.start'])).toBe(false);
    expect(html).toContain('left-1/3'); // rule-of-thirds grid
    expect(t).not.toMatch(/camera\.[a-z]/);
  });

  it('shows the timer, turns it amber near the limit and hides the guidance while recording', () => {
    const calm = renderScreen({ phase: 'recording', elapsedSec: 42.7, canSwitch: true, torchSupported: true });
    expect(text(calm)).toContain('00:42');
    expect(calm).not.toContain('data-warning');
    expect(calm).toContain('aria-label="Felvétel leállítása"');
    expect(calm).toContain('aria-label="Zseblámpa bekapcsolása"');
    expect(calm).not.toContain('aria-label="Váltás a másik kamerára"');
    expect(text(calm)).not.toContain(messages.hu['guide.title']);
    expect(calm).not.toContain('left-1/3');

    const amber = renderScreen({ phase: 'recording', elapsedSec: 168 });
    expect(amber).toContain('data-warning="true"');
    expect(text(amber)).toContain('02:48');
  });

  it('shows the clip tray, "another shelf" hint, done count and the limit notice after clips', () => {
    const html = renderScreen({ clips: [clip(1), clip(2)], notice: { id: 1, kind: 'limit' }, canSwitch: true }, 'hu', 180);
    const t = text(html);
    expect(html).toContain('aria-label="2 felvétel megtekintése"');
    expect(t).toContain('Még egy polc?');
    expect(t).toContain('Kész (2)');
    expect(t).toContain('A felvétel 03:00 után automatikusan leállt.');
    expect(html).toContain('aria-label="Váltás a másik kamerára"');
    expect(isDisabled(html, 'Kész (2)')).toBe(false);
    expect(isDisabled(html, '2 felvétel megtekintése')).toBe(false);
    // while recording the tray and "done" are locked
    const busy = renderScreen({ clips: [clip(1), clip(2)], phase: 'recording', elapsedSec: 5 });
    expect(isDisabled(busy, 'Kész (2)')).toBe(true);
    expect(isDisabled(busy, '2 felvétel megtekintése')).toBe(true);

    const en = text(renderScreen({ clips: [clip(1)], notice: { id: 2, kind: 'tooShort' } }, 'en'));
    expect(en).toContain('Another shelf?');
    expect(en).toContain("That was too short, so the clip wasn't kept.");
    expect(renderScreen({ clips: [clip(1)] }, 'en')).toContain('aria-label="Review 1 clip"');
  });

  it('marks the torch as pressed when it is on', () => {
    const html = renderScreen({ torchSupported: true, torchOn: true });
    expect(html).toMatch(/aria-label="Zseblámpa kikapcsolása"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Zseblámpa kikapcsolása"/);
  });

  it('switches to the fallback screen when the camera failed', () => {
    const html = renderScreen({ status: 'failed', problem: 'denied', videoReady: false, clips: [clip(1)] }, 'hu', 180, 'ios');
    const t = text(html);
    // the camera bars underneath are unreachable
    expect(html.match(/<div inert=""/g)).toHaveLength(2);
    expect(renderScreen({})).not.toContain('inert=""');
    expect(t).toContain('Nincs engedély a kamerához');
    expect(t).toContain('Beállítások → Safari → Kamera');
    expect(t).toContain('Kész – 1 felvétel használata');
  });
});

describe('camera messages', () => {
  it('has the same keys in Hungarian and English, none empty', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.hu).sort());
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) expect(value.trim(), `${locale} ${key}`).not.toBe('');
    }
  });
});

/**
 * Server-render tests of the upload list (react-dom/server, no DOM, effects do not run): the status line of each
 * row in both languages, the server-reported state after "Uploaded" and the size limit quoted in errors.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// I18nProvider asks for the router (locale switch)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

import { I18nProvider } from '@/i18n/client';
import type { UploadItem } from '@/lib/client/upload-store';
import type { Locale } from '@/lib/types';
import type { UploadLimits } from './limits';
import { UploadFileList, type UploadFileListProps } from './UploadFileList';

function item(p: Partial<UploadItem> = {}): UploadItem {
  return {
    localId: p.localId ?? 'up-1',
    collectionId: '123456789',
    videoId: 'v1',
    name: 'polc.mp4',
    size: 12_000_000,
    mimeType: 'video/mp4',
    kind: 'video',
    lastModified: 1,
    bytesSent: 0,
    status: 'queued',
    addedAt: 1,
    ...p,
  };
}

const LIMITS: UploadLimits = { maxUploadMb: 2048, maxSourcesPerCollection: 30, maxVideoSeconds: 600 };

function render(props: UploadFileListProps, locale: Locale = 'hu'): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UploadFileList limits={LIMITS} {...props} />
    </I18nProvider>,
  );
}

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

describe('UploadFileList', () => {
  it('says only "uploaded" for a finished upload without server information (hu, en)', () => {
    const done = item({ status: 'done', bytesSent: 12_000_000, finishedAt: 2 });
    const hu = text(render({ items: [done] }));
    expect(hu).toContain('Videó: Feltöltve');
    expect(hu).not.toContain('feldolgozásra vár');
    const en = text(render({ items: [done] }, 'en'));
    expect(en).toContain('Video: Uploaded');
    expect(en).not.toContain('waiting to be processed');
  });

  it('shows the state reported for the source after "uploaded"', () => {
    const done = [item({ status: 'done', finishedAt: 2 }), item({ localId: 'up-2', videoId: 'v2', name: 'polc2.mov', status: 'done', finishedAt: 3 })];
    const detail = (i: UploadItem) => (i.videoId === 'v1' ? <span className="text-muted">Feldolgozás alatt</span> : null);
    const html = text(render({ items: done, doneDetail: detail }));
    expect(html).toContain('polc.mp4 11,4 MB Videó: Feltöltve · Feldolgozás alatt');
    // no detail for the second source: "Feltöltve" alone, without a dangling separator
    expect(html).toMatch(/polc2\.mov 11,4 MB Videó: Feltöltve(?! ·)/);
  });

  it('shows progress, queue and pause states', () => {
    const html = text(
      render({
        items: [
          item({ status: 'uploading', bytesSent: 4_800_000 }),
          item({ localId: 'up-2', name: 'b.mp4', status: 'queued' }),
          item({ localId: 'up-3', name: 'c.mp4', status: 'paused' }),
          item({ localId: 'up-4', name: 'd.mp4', status: 'finalizing' }),
        ],
      }),
    );
    expect(html).toContain('Feltöltés: 40%');
    expect(html).toContain('Sorra vár');
    expect(html).toContain('Szüneteltetve');
    expect(html).toContain('Ellenőrzés és sorba állítás…');
  });

  it('quotes the server size limit when a file was too large (hu, en)', () => {
    const failed = item({ status: 'error', errorCode: 'too_large' });
    expect(text(render({ items: [failed] }))).toContain('A fájl túl nagy: fájlonként legfeljebb 2 GB tölthető fel.');
    expect(text(render({ items: [failed] }, 'en'))).toContain('The file is too large: each file can be at most 2 GB.');
    // unknown codes fall back to the server message, then to the generic text
    expect(text(render({ items: [item({ status: 'error', errorCode: 'weird', error: 'Szerver üzenet' })] }))).toContain('Szerver üzenet');
    expect(text(render({ items: [item({ status: 'error', errorCode: 'weird' })] }, 'en'))).toContain("The file couldn't be uploaded.");
  });
});

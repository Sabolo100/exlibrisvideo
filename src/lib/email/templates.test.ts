import { describe, expect, it } from 'vitest';
import { makeSampleCollection } from '@/lib/export/testing/sample-collection';
import {
  escapeHtml,
  headerSafe,
  miniShelf,
  renderCollectionReady,
  renderExport,
  renderRecoverLinks,
  safeUrl,
  topTopics,
  type CollectionEmailInput,
} from './templates';

const EVIL = `<script>alert("x")</script>&'`;

function readyInput(overrides: Partial<CollectionEmailInput> = {}): CollectionEmailInput {
  const collection = makeSampleCollection();
  return {
    locale: 'hu',
    collection,
    appUrl: 'https://www.exlibrisvideo.hu',
    editUrl: 'https://www.exlibrisvideo.hu/334345435?r=1790000000.c2ln',
    attachments: [{ format: 'xlsx', filename: 'exlibris-334345435.xlsx', size: 20_755 }],
    attachmentNote: 'none',
    failedFormats: [],
    downloads: [],
    ...overrides,
  };
}

describe('escaping helpers', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(EVIL)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
  it('allows only http(s) URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('https://x.hu/1?a=b')).toBe('https://x.hu/1?a=b');
    expect(safeUrl('nonsense')).toBeNull();
  });
  it('strips line breaks from header values', () => {
    expect(headerSafe('Hello\r\nBcc: evil@example.com')).toBe('Hello Bcc: evil@example.com');
  });
});

describe('collection_ready template', () => {
  it('renders the Hungarian e-mail with stats, top topics, shelf, buttons and attachment note', () => {
    const input = readyInput();
    const { subject, html, text } = renderCollectionReady(input);
    expect(subject).toBe('Elkészült a katalógusod – 42 könyv a polcodról');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="hu"');
    expect(html).toContain('width="600"');
    expect(html).toContain('Kedves Budaházy Ödön!');
    expect(html).toContain('Elkészült a könyvtárad katalógusa');
    expect(html).toContain('„Nagyszülők könyvespolca – Tőzsér-hagyaték”');
    expect(html).toContain('href="https://www.exlibrisvideo.hu/334345435"');
    expect(html).toContain('Megnyitom a katalógust');
    expect(html).toContain('href="https://www.exlibrisvideo.hu/334345435?r=1790000000.c2ln"');
    expect(html).toContain('7 napig érvényes');
    expect(html).toContain('Mellékeltük: Excel-táblázat (.xlsx) – 20 KB.');
    expect(html).toContain('#1f4d3a');
    expect(html).toContain('#f6efe2');
    expect(html).toContain('#a87a2e');
    expect(html).toContain('Georgia');

    const top = topTopics(input.collection.books, 3);
    expect(top).toHaveLength(3);
    expect(top[0].key).toBe('hungarian_literature');
    expect(html).toContain('Magyar irodalom');

    // review tip (6 books need review in the sample)
    expect(html).toMatch(/6 könyvnél nem voltunk egészen biztosak/);

    expect(text).toContain('Katalógus megnyitása: https://www.exlibrisvideo.hu/334345435');
    expect(text).toContain('Szerkesztés (7 napig érvényes): https://www.exlibrisvideo.hu/334345435?r=1790000000.c2ln');
    expect(text).toContain('42 könyv · 39 szerző · 17 téma');
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it('renders at most 20 spine cells and sanitizes spine colours', () => {
    const collection = makeSampleCollection({ bookCount: 30 });
    collection.books[0].spineColor = 'red;background:url(https://evil.example/x)';
    const shelf = miniShelf(collection.books);
    expect((shelf.match(/border-radius:3px 3px 0 0/g) ?? []).length).toBe(20);
    expect(shelf).not.toContain('evil.example');
    expect(shelf).toMatch(/bgcolor="#[0-9a-f]{6}"/);
    expect(miniShelf([])).toBe('');
  });

  it('escapes all user-provided text', () => {
    const input = readyInput();
    input.collection.title = EVIL;
    input.collection.ownerName = EVIL;
    input.collection.books[0].title = EVIL;
    input.collection.publicUrl = 'javascript:alert(1)';
    input.editUrl = 'javascript:alert(2)';
    const { subject, html, text } = renderCollectionReady(input);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain(EVIL); // plain text is not HTML
    expect(text).not.toContain('javascript:');
  });

  it('explains dropped attachments and lists download links', () => {
    const { html, text } = renderCollectionReady(
      readyInput({
        attachments: [],
        attachmentNote: 'tooLarge',
        failedFormats: ['pdf'],
        downloads: [
          { format: 'xlsx', url: 'https://www.exlibrisvideo.hu/api/collections/334345435/export?format=xlsx&lang=hu' },
          { format: 'pdf', url: 'javascript:alert(1)' },
        ],
      }),
    );
    expect(html).toContain('túl nagyok lettek volna');
    expect(html).toContain('Nyomtatható PDF-katalógus (.pdf)');
    expect(html).toContain('href="https://www.exlibrisvideo.hu/api/collections/334345435/export?format=xlsx&amp;lang=hu"');
    expect(html).not.toContain('javascript:');
    expect(text).toContain('- Excel-táblázat (.xlsx): https://www.exlibrisvideo.hu/api/collections/334345435/export?format=xlsx&lang=hu');
  });

  it('renders English with singular forms and an empty catalogue', () => {
    const input = readyInput({ locale: 'en', editUrl: null, attachments: [] });
    input.collection.books = input.collection.books.slice(0, 1);
    input.collection.ownerName = null;
    const one = renderCollectionReady(input);
    expect(one.subject).toBe('Your catalogue is ready – 1 book from your shelf');
    expect(one.html).toContain('Hello, book lover,');
    expect(one.html).toContain('<html lang="en"');
    expect(one.html).not.toContain('Open for editing');

    input.collection.books = [];
    const empty = renderCollectionReady(input);
    expect(empty.html).toContain('could not read a single spine');
    expect(empty.html).not.toContain('What to do next');
  });
});

describe('export template', () => {
  it('lists attachments and download links', () => {
    const { subject, html, text } = renderExport(
      readyInput({
        editUrl: null,
        attachments: [
          { format: 'xlsx', filename: 'exlibris-334345435.xlsx', size: 20_000 },
          { format: 'pdf', filename: 'exlibris-334345435.pdf', size: 3_500_000 },
        ],
        downloads: [{ format: 'json', url: 'https://www.exlibrisvideo.hu/api/collections/334345435/export?format=json&lang=hu' }],
      }),
    );
    expect(subject).toBe('A katalógusod exportja: Nagyszülők könyvespolca – Tőzsér-hagyaték');
    expect(html).toContain('Itt a katalógusod exportja');
    expect(html).toMatch(/Nyomtatható PDF-katalógus \(\.pdf\) – 3,3 MB/);
    expect(html).toContain('JSON-adatfájl (.json)');
    expect(text).toContain('Katalógus megnyitása: https://www.exlibrisvideo.hu/334345435');
  });
});

describe('recover_links template', () => {
  it('lists every collection with its 24-hour edit link and the ignore notice', () => {
    const { subject, html, text } = renderRecoverLinks({
      locale: 'hu',
      appUrl: 'https://www.exlibrisvideo.hu',
      limited: true,
      items: [
        {
          id: '334345435',
          title: `Nappali ${EVIL}`,
          ownerName: null,
          bookCount: 42,
          createdAt: '2026-09-12T19:21:03.000Z',
          status: 'ready',
          publicUrl: 'https://www.exlibrisvideo.hu/334345435',
          editUrl: 'https://www.exlibrisvideo.hu/334345435?r=1790000000.abc',
        },
        {
          id: '123456789',
          title: null,
          ownerName: 'Kovács Ödön',
          bookCount: 1,
          createdAt: '2026-09-01T08:00:00.000Z',
          status: 'processing',
          publicUrl: 'https://www.exlibrisvideo.hu/123456789',
          editUrl: 'https://www.exlibrisvideo.hu/123456789?r=1790000000.def',
        },
      ],
    });
    expect(subject).toBe('Szerkesztési linkek a katalógusaidhoz');
    expect(html).toContain('href="https://www.exlibrisvideo.hu/334345435?r=1790000000.abc"');
    expect(html).toContain('href="https://www.exlibrisvideo.hu/123456789?r=1790000000.def"');
    expect(html).toContain('Kovács Ödön könyvtára');
    expect(html).toContain('feldolgozás alatt');
    expect(html).toContain('nyugodtan hagyd figyelmen kívül');
    expect(html).toContain('24 óráig');
    expect(html).toContain('A legutóbbi 2 katalógust soroltuk fel.');
    expect(html).not.toContain('<script>');
    expect(text).toContain('Szerkesztés (24 óráig érvényes): https://www.exlibrisvideo.hu/334345435?r=1790000000.abc');
    expect(text).toContain('42 könyv · létrehozva: 2026. szept. 12.');
    expect(text.endsWith('\n-- \nAzért kapod ezt a levelet, mert valaki erre a címre kért szerkesztési linkeket az Ex Libris Video oldalán.\nEx Libris Video · Egy videó a polcodról – és kész a könyvtárad katalógusa.\nhttps://www.exlibrisvideo.hu\n')).toBe(true);
  });

  it('renders English', () => {
    const { subject, html } = renderRecoverLinks({
      locale: 'en',
      appUrl: 'https://www.exlibrisvideo.hu',
      limited: false,
      items: [
        {
          id: '334345435',
          title: 'Shelf',
          ownerName: null,
          bookCount: 3,
          createdAt: new Date('2026-09-12T19:21:03.000Z'),
          status: 'draft',
          publicUrl: 'https://www.exlibrisvideo.hu/334345435',
          editUrl: 'https://www.exlibrisvideo.hu/334345435?r=1.x',
        },
      ],
    });
    expect(subject).toBe('Edit links for your catalogues');
    expect(html).toContain('If you did not request this e-mail, you can safely ignore it');
    expect(html).toContain('no video uploaded yet');
  });
});

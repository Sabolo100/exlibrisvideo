import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionRow } from '@/db/schema';
import { makeSampleCollection } from '@/lib/export/testing/sample-collection';
import type { MailMessage } from './types';

const h = vi.hoisted(() => ({
  sent: [] as MailMessage[],
  sendImpl: null as null | ((m: MailMessage) => Promise<void>),
  rows: new Map<string, unknown>(),
  byEmail: [] as unknown[],
  logs: [] as { collectionId: string | null; to: string; kind: string; status: string; error?: string | null }[],
  marked: [] as string[],
  collection: null as unknown,
  buildExportFail: new Set<string>(),
}));

vi.mock('@/lib/env', () => ({
  env: () => ({ EMAIL_FROM: 'Ex Libris Video <hello@exlibrisvideo.hu>', APP_URL: 'https://www.exlibrisvideo.hu', EMAIL_PROVIDER: 'console' }),
  publicCollectionUrl: (id: string) => `https://www.exlibrisvideo.hu/${id}`,
}));

vi.mock('./providers', () => ({
  maskAddress: (a: string) => `${a[0]}***`,
  getMailProvider: () => ({
    name: 'console',
    send: async (m: MailMessage) => {
      if (h.sendImpl) await h.sendImpl(m);
      h.sent.push(m);
      return { provider: 'console', id: 'x' };
    },
  }),
}));

vi.mock('./repo', () => ({
  loadCollectionRow: async (id: string) => h.rows.get(id) ?? null,
  findCollectionsByEmail: async (email: string, limit: number) =>
    (h.byEmail as { email: string }[]).filter((r) => r.email.toLowerCase() === email).slice(0, limit),
  countBooksByCollection: async (ids: string[]) => new Map(ids.map((id, i) => [id, 10 + i])),
  insertEmailLog: async (entry: (typeof h.logs)[number]) => {
    h.logs.push(entry);
  },
  markEmailSent: async (id: string) => {
    h.marked.push(id);
  },
}));

vi.mock('@/lib/collections/queries', () => ({
  getCollectionWithBooks: vi.fn(async () => h.collection),
}));

vi.mock('@/lib/collections/access', () => ({
  buildRecoveryUrl: vi.fn((row: { id: string }, hours?: number) => `https://www.exlibrisvideo.hu/${row.id}?r=${hours ?? 24}h.sig`),
}));

vi.mock('@/lib/export', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/export')>();
  return {
    ...real,
    buildExport: vi.fn(async (...args: Parameters<typeof real.buildExport>) => {
      if (h.buildExportFail.has(args[1])) throw new Error(`boom ${args[1]}`);
      return real.buildExport(...args);
    }),
  };
});

import { buildRecoveryUrl } from '@/lib/collections/access';
import { getCollectionWithBooks } from '@/lib/collections/queries';
import { capAttachments, handleSendEmailJob, normalizeAddress, resolveFormats, sendMail } from './index';

function row(overrides: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: '334345435',
    ownerTokenHash: 'hash',
    title: 'Nagyszülők könyvespolca – Tőzsér-hagyaték',
    description: null,
    ownerName: 'Budaházy Ödön',
    email: 'Tulajdonos@Example.com',
    locale: 'hu',
    visibility: 'link',
    pinHash: null,
    status: 'ready',
    usage: {},
    viewCount: 0,
    emailSentAt: null,
    lastViewedAt: null,
    createdAt: new Date('2026-09-12T19:21:03.000Z'),
    updatedAt: new Date('2026-09-12T19:45:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  h.sent = [];
  h.sendImpl = null;
  h.rows = new Map([['334345435', row()]]);
  h.byEmail = [];
  h.logs = [];
  h.marked = [];
  h.collection = makeSampleCollection();
  h.buildExportFail = new Set();
  vi.mocked(buildRecoveryUrl).mockClear();
  vi.mocked(getCollectionWithBooks).mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('helpers', () => {
  it('normalizes addresses', () => {
    expect(normalizeAddress('  Olvaso@Example.COM ')).toBe('olvaso@example.com');
    expect(normalizeAddress('a@b')).toBeNull();
    expect(normalizeAddress('x@example.com\r\nBcc: y@example.com')).toBeNull();
    expect(normalizeAddress('two@example.com, three@example.com')).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it('resolves default and requested formats', () => {
    expect(resolveFormats('collection_ready', undefined)).toEqual(['xlsx']);
    expect(resolveFormats('export', undefined)).toEqual(['xlsx', 'pdf']);
    expect(resolveFormats('export', ['csv', 'csv', 'docx', 'json'])).toEqual(['csv', 'json']);
    expect(resolveFormats('export', ['docx'])).toEqual(['xlsx', 'pdf']);
  });

  it('caps attachments at 15 MB: PDF first, then links only', () => {
    const file = (format: 'xlsx' | 'pdf' | 'csv', mb: number) => ({
      format,
      filename: `f.${format}`,
      contentType: 'x',
      body: Buffer.alloc(Math.round(mb * 1024 * 1024)),
    });
    expect(capAttachments([file('xlsx', 2), file('pdf', 5)]).note).toBe('none');
    const pdfDropped = capAttachments([file('xlsx', 2), file('pdf', 14)]);
    expect(pdfDropped.note).toBe('pdfDropped');
    expect(pdfDropped.attached.map((f) => f.format)).toEqual(['xlsx']);
    expect(pdfDropped.dropped).toEqual(['pdf']);
    const tooLarge = capAttachments([file('xlsx', 16), file('pdf', 1)]);
    expect(tooLarge.note).toBe('tooLarge');
    expect(tooLarge.attached).toEqual([]);
    expect(tooLarge.dropped).toEqual(['xlsx', 'pdf']);
  });

  it('sendMail validates the recipient and strips header line breaks', async () => {
    await sendMail({ to: ' Olvaso@Example.com ', subject: 'Szia\r\nBcc: x@example.com', html: '<p>x</p>', text: 'x' });
    expect(h.sent[0].to).toBe('olvaso@example.com');
    expect(h.sent[0].subject).toBe('Szia Bcc: x@example.com');
    await expect(sendMail({ to: 'nope', subject: 's', html: '', text: '' })).rejects.toThrow('Invalid recipient address');
  });
});

describe('collection_ready', () => {
  it('sends the ready e-mail with the xlsx attached and a 7-day edit link, then logs and marks it sent', async () => {
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435' });
    expect(getCollectionWithBooks).toHaveBeenCalledWith('334345435', { isOwner: true });
    expect(h.sent).toHaveLength(1);
    const m = h.sent[0];
    expect(m.to).toBe('tulajdonos@example.com');
    expect(m.kind).toBe('collection_ready');
    expect(m.subject).toBe('Elkészült a katalógusod – 42 könyv a polcodról');
    expect(m.attachments?.map((a) => a.filename)).toEqual(['exlibris-334345435.xlsx']);
    expect(m.attachments?.[0].content.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(buildRecoveryUrl).toHaveBeenCalledWith(expect.objectContaining({ id: '334345435' }), 168);
    expect(m.html).toContain('https://www.exlibrisvideo.hu/334345435?r=168h.sig');
    expect(m.text).toContain('Mellékeltük: Excel-táblázat (.xlsx)');
    expect(h.logs).toEqual([{ collectionId: '334345435', to: 'tulajdonos@example.com', kind: 'collection_ready', status: 'sent' }]);
    expect(h.marked).toEqual(['334345435']);
  });

  it('uses the payload locale when given', async () => {
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435', locale: 'en' });
    expect(h.sent[0].subject).toBe('Your catalogue is ready – 42 books from your shelf');
  });

  it('skips when already sent, when there is no recipient, or the collection is gone', async () => {
    h.rows.set('334345435', row({ emailSentAt: new Date() }));
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435' });
    h.rows.set('334345435', row({ email: null }));
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435' });
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '999999999' });
    expect(h.sent).toHaveLength(0);
    expect(h.logs).toHaveLength(0);
    expect(h.marked).toHaveLength(0);
  });

  it('requires a collection id', async () => {
    await expect(handleSendEmailJob({ kind: 'export' })).rejects.toThrow(/collectionId is required/);
  });

  it('logs a failure and rethrows so the job retries', async () => {
    h.sendImpl = async () => {
      throw new Error('SMTP connection refused');
    };
    await expect(handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435' })).rejects.toThrow('SMTP connection refused');
    expect(h.logs).toEqual([
      { collectionId: '334345435', to: 'tulajdonos@example.com', kind: 'collection_ready', status: 'failed', error: 'SMTP connection refused' },
    ]);
    expect(h.marked).toHaveLength(0);
  });

  it('sends links instead of attachments for an empty catalogue', async () => {
    h.collection = makeSampleCollection({ bookCount: 0 });
    await handleSendEmailJob({ kind: 'collection_ready', collectionId: '334345435' });
    expect(h.sent[0].attachments).toEqual([]);
    expect(h.sent[0].html).toContain('egyetlen könyvgerincet sem');
  });
});

describe('export', () => {
  it('attaches xlsx + pdf by default, links every format, and never includes an edit link for another address', async () => {
    await handleSendEmailJob({ kind: 'export', collectionId: '334345435', to: 'barat@example.com' });
    const m = h.sent[0];
    expect(m.to).toBe('barat@example.com');
    expect(m.subject).toBe('A katalógusod exportja: Nagyszülők könyvespolca – Tőzsér-hagyaték');
    expect(m.attachments?.map((a) => a.filename)).toEqual(['exlibris-334345435.xlsx', 'exlibris-334345435.pdf']);
    expect(m.attachments?.[1].content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    for (const f of ['xlsx', 'csv', 'json', 'pdf', 'goodreads']) {
      expect(m.text).toContain(`https://www.exlibrisvideo.hu/api/collections/334345435/export?format=${f}&lang=hu`);
    }
    expect(buildRecoveryUrl).not.toHaveBeenCalled();
    expect(m.html).not.toContain('?r=');
    expect(h.logs[0]).toMatchObject({ kind: 'export', status: 'sent', to: 'barat@example.com' });
    expect(h.marked).toHaveLength(0);
  });

  it('still sends when one export fails and tells the recipient', async () => {
    h.buildExportFail.add('pdf');
    await handleSendEmailJob({ kind: 'export', collectionId: '334345435', formats: ['xlsx', 'pdf'] });
    const m = h.sent[0];
    expect(m.to).toBe('tulajdonos@example.com');
    expect(m.attachments?.map((a) => a.filename)).toEqual(['exlibris-334345435.xlsx']);
    expect(m.text).toContain('Néhány fájlt most nem sikerült elkészítenünk (Nyomtatható PDF-katalógus (.pdf))');
  });
});

describe('recover_links', () => {
  it('mails every collection of the address with 24-hour links', async () => {
    h.byEmail = [
      row({ id: '334345435', email: 'Tulajdonos@Example.com' }),
      row({ id: '123456789', email: 'tulajdonos@example.com', title: null, status: 'processing', locale: 'hu' }),
      row({ id: '555555555', email: 'masvalaki@example.com' }),
    ];
    await handleSendEmailJob({ kind: 'recover_links', to: 'TULAJDONOS@example.com' });
    expect(h.sent).toHaveLength(1);
    const m = h.sent[0];
    expect(m.to).toBe('tulajdonos@example.com');
    expect(m.subject).toBe('Szerkesztési linkek a katalógusaidhoz');
    expect(buildRecoveryUrl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildRecoveryUrl).mock.calls.every((c) => c[1] === 24)).toBe(true);
    expect(m.text).toContain('https://www.exlibrisvideo.hu/334345435?r=24h.sig');
    expect(m.text).toContain('https://www.exlibrisvideo.hu/123456789?r=24h.sig');
    expect(m.text).not.toContain('555555555');
    expect(m.attachments ?? []).toHaveLength(0);
    expect(h.logs).toEqual([{ collectionId: null, to: 'tulajdonos@example.com', kind: 'recover_links', status: 'sent' }]);
  });

  it('lists at most 20 collections', async () => {
    h.byEmail = Array.from({ length: 25 }, (_, i) => row({ id: String(100000000 + i), email: 'sok@example.com' }));
    await handleSendEmailJob({ kind: 'recover_links', to: 'sok@example.com', locale: 'en' });
    expect(buildRecoveryUrl).toHaveBeenCalledTimes(20);
    expect(h.sent[0].text).toContain('Showing the 20 most recent catalogues.');
  });

  it('sends nothing (but logs) when the address has no collections', async () => {
    await handleSendEmailJob({ kind: 'recover_links', to: 'ismeretlen@example.com' });
    expect(h.sent).toHaveLength(0);
    expect(h.logs).toEqual([
      { collectionId: null, to: 'ismeretlen@example.com', kind: 'recover_links', status: 'skipped', error: 'no collections for this address' },
    ]);
    await handleSendEmailJob({ kind: 'recover_links' });
    expect(h.sent).toHaveLength(0);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
  value: {
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM: 'Ex Libris Video <hello@exlibrisvideo.hu>',
    RESEND_API_KEY: 're_test_secret_key' as string | undefined,
    SMTP_HOST: 'smtp.example.com' as string | undefined,
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'mailer' as string | undefined,
    SMTP_PASS: 'smtp-secret' as string | undefined,
    STORAGE_DIR: '',
  },
}));

vi.mock('@/lib/env', () => ({
  env: () => envState.value,
  storageRoot: () => path.resolve(envState.value.STORAGE_DIR),
}));

const smtpMock = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => {
  smtpMock.createTransport.mockImplementation(() => ({ sendMail: smtpMock.sendMail, close: smtpMock.close }));
  return { default: { createTransport: smtpMock.createTransport } };
});

import { consoleProvider, getMailProvider, maskAddress, resendProvider, resolveMailProviderName, smtpProvider } from './providers';
import type { MailMessage } from './types';

const tmpRoot = path.join(os.tmpdir(), `exl-mail-test-${process.pid}-${Date.now()}`);

const message: MailMessage = {
  to: 'olvaso@example.com',
  subject: 'Elkészült a katalógusod – 42 könyv',
  html: '<p>Szia ő ű</p>',
  text: 'Szia ő ű',
  kind: 'collection_ready',
  attachments: [{ filename: 'exlibris-334345435.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: Buffer.from('PKhello') }],
};

beforeEach(() => {
  envState.value.STORAGE_DIR = tmpRoot;
  envState.value.EMAIL_PROVIDER = 'console';
  envState.value.RESEND_API_KEY = 're_test_secret_key';
  vi.restoreAllMocks();
  smtpMock.sendMail.mockReset();
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('provider selection', () => {
  it('resolves EMAIL_PROVIDER', () => {
    envState.value.EMAIL_PROVIDER = 'Resend';
    expect(resolveMailProviderName()).toBe('resend');
    expect(getMailProvider().name).toBe('resend');
    envState.value.EMAIL_PROVIDER = 'smtp';
    expect(getMailProvider().name).toBe('smtp');
    envState.value.EMAIL_PROVIDER = 'carrier-pigeon';
    expect(() => resolveMailProviderName()).toThrow(/Unsupported EMAIL_PROVIDER/);
  });

  it('masks addresses for logs', () => {
    expect(maskAddress('olvaso@example.com')).toBe('o***@example.com');
    expect(maskAddress('broken')).toBe('***');
  });
});

describe('console provider', () => {
  it('writes an HTML preview under exports/_mail and logs a summary', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await consoleProvider.send(message, 'from@example.com');
    expect(res.provider).toBe('console');
    expect(res.id).toMatch(/^exports\/_mail\/\d{4}-\d{2}-\d{2}T[\d-]+Z-collection_ready\.html$/);
    const html = await fs.readFile(path.join(tmpRoot, res.id!), 'utf8');
    expect(html).toBe('<p>Szia ő ű</p>');
    const dir = path.dirname(path.join(tmpRoot, res.id!));
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith('-collection_ready.txt'))).toBe(true);
    expect(files.some((f) => f.endsWith('exlibris-334345435.xlsx'))).toBe(true);
    expect(info).toHaveBeenCalledWith(
      '[email] console provider',
      expect.objectContaining({
        to: 'olvaso@example.com',
        subject: message.subject,
        attachments: [{ filename: 'exlibris-334345435.xlsx', size: 9 }],
      }),
    );
  });
});

describe('resend provider', () => {
  it('posts JSON with base64 attachments and returns the id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }));
    const res = await resendProvider.send(message, 'Ex Libris Video <hello@exlibrisvideo.hu>');
    expect(res).toEqual({ provider: 'resend', id: 'msg_123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer re_test_secret_key');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      from: 'Ex Libris Video <hello@exlibrisvideo.hu>',
      to: ['olvaso@example.com'],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    expect(body.attachments).toEqual([
      {
        filename: 'exlibris-334345435.xlsx',
        content: Buffer.from('PKhello').toString('base64'),
        content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]);
  });

  it('throws a descriptive error without leaking the API key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' }), { status: 422 }),
    );
    const err = await resendProvider.send(message, 'x@example.com').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Resend API error 422: validation_error: Invalid `to` field.');
    expect((err as Error).message).not.toContain('re_test_secret_key');
  });

  it('fails fast without an API key and on network errors', async () => {
    envState.value.RESEND_API_KEY = undefined;
    await expect(resendProvider.send(message, 'x@example.com')).rejects.toThrow('RESEND_API_KEY is not configured');
    envState.value.RESEND_API_KEY = 're_test_secret_key';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(resendProvider.send(message, 'x@example.com')).rejects.toThrow('Resend request failed: fetch failed');
  });
});

describe('smtp provider', () => {
  it('sends through nodemailer with SMTP_* settings', async () => {
    smtpMock.sendMail.mockResolvedValue({ messageId: '<abc@example.com>', rejected: [], response: '250 OK' });
    const res = await smtpProvider.send(message, 'Ex Libris Video <hello@exlibrisvideo.hu>');
    expect(res).toEqual({ provider: 'smtp', id: '<abc@example.com>' });
    expect(smtpMock.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'mailer', pass: 'smtp-secret' } }),
    );
    expect(smtpMock.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Ex Libris Video <hello@exlibrisvideo.hu>',
        to: 'olvaso@example.com',
        attachments: [expect.objectContaining({ filename: 'exlibris-334345435.xlsx', contentType: expect.stringContaining('spreadsheetml') })],
      }),
    );
  });

  it('throws when the server rejects the recipient', async () => {
    smtpMock.sendMail.mockResolvedValue({ messageId: 'x', rejected: ['olvaso@example.com'], response: '550 No such user' });
    await expect(smtpProvider.send(message, 'x@example.com')).rejects.toThrow(/550 No such user/);
  });
});

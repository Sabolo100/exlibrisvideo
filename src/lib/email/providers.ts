/**
 * E-mail transports, selected by EMAIL_PROVIDER:
 *   smtp    – nodemailer with SMTP_* settings
 *   resend  – Resend HTTP API (https://api.resend.com/emails), attachments base64
 *   console – development: logs a summary and writes an HTML preview to
 *             <STORAGE_DIR>/exports/_mail/<timestamp>-<kind>.html
 */
import fs from 'node:fs/promises';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { env } from '@/lib/env';
import { ensureDirFor } from '@/lib/storage';
import type { MailMessage, MailProvider, MailProviderName, SendResult } from './types';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function resolveMailProviderName(): MailProviderName {
  const raw = (env().EMAIL_PROVIDER || 'console').trim().toLowerCase();
  if (raw === 'smtp' || raw === 'resend' || raw === 'console') return raw;
  throw new Error(`Unsupported EMAIL_PROVIDER "${raw}" (expected smtp | resend | console)`);
}

export function getMailProvider(name: MailProviderName = resolveMailProviderName()): MailProvider {
  switch (name) {
    case 'smtp':
      return smtpProvider;
    case 'resend':
      return resendProvider;
    case 'console':
      return consoleProvider;
  }
}

/** "hello@example.com" → "h***@example.com" (for logs) */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address[0]}***${address.slice(at)}`;
}

/* ------------------------------------------------------------------ */
/* SMTP                                                                */
/* ------------------------------------------------------------------ */

let smtpCache: { key: string; transporter: Transporter<SMTPTransport.SentMessageInfo> } | null = null;

function smtpTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
  const e = env();
  if (!e.SMTP_HOST) throw new Error('SMTP_HOST is not configured');
  const key = [e.SMTP_HOST, e.SMTP_PORT, e.SMTP_SECURE, e.SMTP_USER ?? ''].join('|');
  if (smtpCache?.key === key) return smtpCache.transporter;
  const options: SMTPTransport.Options = {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS ?? '' } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  };
  smtpCache?.transporter.close();
  const transporter = nodemailer.createTransport(options);
  smtpCache = { key, transporter };
  return transporter;
}

export const smtpProvider: MailProvider = {
  name: 'smtp',
  async send(message, from) {
    const info = await smtpTransporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: (message.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    const rejected = info.rejected ?? [];
    if (rejected.length > 0) {
      throw new Error(`SMTP server rejected the recipient (${info.response ?? 'no response'})`);
    }
    return { provider: 'smtp', id: info.messageId };
  },
};

/* ------------------------------------------------------------------ */
/* Resend                                                              */
/* ------------------------------------------------------------------ */

export const resendProvider: MailProvider = {
  name: 'resend',
  async send(message, from) {
    const key = env().RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not configured');
    const body = {
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString('base64'),
              content_type: a.contentType,
            })),
          }
        : {}),
    };
    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'User-Agent': 'ExLibrisVideo/1.0',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new Error(`Resend request failed: ${(err as Error).message}`);
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string; name?: string };
        detail = [parsed.name, parsed.message].filter(Boolean).join(': ') || raw;
      } catch {
        /* keep raw text */
      }
      throw new Error(`Resend API error ${res.status}: ${detail.slice(0, 500)}`);
    }
    let id: string | undefined;
    try {
      id = (JSON.parse(raw) as { id?: string }).id;
    } catch {
      id = undefined;
    }
    return { provider: 'resend', id };
  },
};

/* ------------------------------------------------------------------ */
/* Console (development)                                               */
/* ------------------------------------------------------------------ */

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'mail';
}

export const consoleProvider: MailProvider = {
  name: 'console',
  async send(message) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const kind = safeSegment(message.kind ?? 'mail');
    const base = `exports/_mail/${stamp}-${kind}`;
    const htmlPath = `${base}.html`;
    const htmlAbs = await ensureDirFor(htmlPath);
    await fs.writeFile(htmlAbs, message.html, 'utf8');
    await fs.writeFile(await ensureDirFor(`${base}.txt`), message.text, 'utf8');
    for (const a of message.attachments ?? []) {
      await fs.writeFile(await ensureDirFor(`${base}-${safeSegment(a.filename)}`), a.content);
    }
    console.info('[email] console provider', {
      to: message.to,
      subject: message.subject,
      attachments: (message.attachments ?? []).map((a) => ({ filename: a.filename, size: a.content.length })),
      preview: htmlAbs,
    });
    return { provider: 'console', id: htmlPath };
  },
};

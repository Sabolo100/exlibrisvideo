/**
 * E-mail entry point (owner: export-email): `sendMail` through the configured provider and the
 * worker handler for `send_email` jobs (collection_ready / export / recover_links).
 */
import { buildRecoveryUrl } from '@/lib/collections/access';
import { getCollectionWithBooks } from '@/lib/collections/queries';
import { env, publicCollectionUrl } from '@/lib/env';
import { buildExport, type ExportFile } from '@/lib/export';
import type { JobPayloads } from '@/lib/jobs/queue';
import { EXPORT_FORMATS, type CollectionWithBooksDTO, type EmailKind, type ExportFormat, type Locale } from '@/lib/types';
import { getMailProvider, maskAddress } from './providers';
import { countBooksByCollection, findCollectionsByEmail, insertEmailLog, loadCollectionRow, markEmailSent } from './repo';
import {
  headerSafe,
  renderCollectionReady,
  renderExport,
  renderRecoverLinks,
  type AttachmentNote,
  type DownloadLink,
  type RecoverItem,
} from './templates';
import type { MailAttachment, MailMessage, SendResult } from './types';

export type { MailAttachment, MailMessage } from './types';

/** Total attachment budget per e-mail (before base64). */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Maximum collections listed in a recover_links e-mail. */
export const MAX_RECOVER_COLLECTIONS = 20;
const RECOVER_LINK_HOURS = 24;
const READY_EDIT_LINK_HOURS = 168;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** Trimmed, lower-cased address, or null when it is not a plausible single address. */
export function normalizeAddress(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  if (!v || v.length > 254 || /[\r\n]/.test(v) || !EMAIL_RE.test(v)) return null;
  return v;
}

async function deliver(message: MailMessage): Promise<SendResult> {
  const to = normalizeAddress(message.to);
  if (!to) throw new Error('Invalid recipient address');
  const provider = getMailProvider();
  return provider.send({ ...message, to, subject: headerSafe(message.subject) }, env().EMAIL_FROM);
}

/** Sends through EMAIL_PROVIDER (smtp | resend | console). Throws on failure. */
export async function sendMail(message: MailMessage): Promise<void> {
  await deliver(message);
}

/** Worker handler for `send_email` jobs (builds content, attachments, logs to email_log). */
export async function handleSendEmailJob(payload: JobPayloads['send_email']): Promise<void> {
  switch (payload.kind) {
    case 'collection_ready':
    case 'export':
      return sendCollectionEmail(payload);
    case 'recover_links':
      return sendRecoverLinks(payload);
    default: {
      const kind: never = payload.kind;
      throw new Error(`Unknown e-mail kind: ${String(kind)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function logSafely(entry: Parameters<typeof insertEmailLog>[0]): Promise<void> {
  try {
    await insertEmailLog(entry);
  } catch (err) {
    console.error('[email] could not write email_log', { kind: entry.kind, status: entry.status, error: errorMessage(err) });
  }
}

function resolveLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const c of candidates) if (c === 'hu' || c === 'en') return c;
  return 'hu';
}

export function resolveFormats(kind: EmailKind, requested: readonly string[] | undefined): ExportFormat[] {
  const valid = [...new Set((requested ?? []).filter((f): f is ExportFormat => (EXPORT_FORMATS as string[]).includes(f)))];
  if (valid.length) return valid;
  return kind === 'collection_ready' ? ['xlsx'] : ['xlsx', 'pdf'];
}

export interface CappedAttachments {
  attached: (ExportFile & { format: ExportFormat })[];
  dropped: ExportFormat[];
  note: AttachmentNote;
}

/** Keeps the total under the cap: drops the PDF first, then falls back to links only. */
export function capAttachments(files: (ExportFile & { format: ExportFormat })[], cap = MAX_ATTACHMENT_BYTES): CappedAttachments {
  const total = (list: ExportFile[]) => list.reduce((s, f) => s + f.body.length, 0);
  if (total(files) <= cap) return { attached: files, dropped: [], note: 'none' };
  const withoutPdf = files.filter((f) => f.format !== 'pdf');
  if (withoutPdf.length < files.length && total(withoutPdf) <= cap) {
    return { attached: withoutPdf, dropped: files.filter((f) => f.format === 'pdf').map((f) => f.format), note: 'pdfDropped' };
  }
  return { attached: [], dropped: files.map((f) => f.format), note: 'tooLarge' };
}

function downloadUrl(collection: CollectionWithBooksDTO, format: ExportFormat, locale: Locale): string | null {
  try {
    const u = new URL(collection.publicUrl);
    return `${u.origin}/api/collections/${encodeURIComponent(collection.id)}/export?format=${format}&lang=${locale}`;
  } catch {
    return null;
  }
}

function appUrlOf(collection?: CollectionWithBooksDTO): string {
  if (collection) {
    try {
      return new URL(collection.publicUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return env().APP_URL.replace(/\/$/, '');
}

/* ------------------------------------------------------------------ */
/* collection_ready / export                                           */
/* ------------------------------------------------------------------ */

async function sendCollectionEmail(payload: JobPayloads['send_email']): Promise<void> {
  const kind = payload.kind;
  const collectionId = payload.collectionId;
  if (!collectionId) throw new Error(`send_email ${kind}: collectionId is required`);

  const row = await loadCollectionRow(collectionId);
  if (!row) {
    console.info('[email] collection no longer exists, skipping', { kind, collectionId });
    return;
  }
  if (kind === 'collection_ready' && row.emailSentAt && !payload.to) {
    console.info('[email] collection_ready already sent, skipping', { collectionId });
    return;
  }
  const to = normalizeAddress(payload.to ?? row.email);
  if (!to) {
    console.info('[email] no valid recipient, skipping', { kind, collectionId });
    return;
  }

  const collection = await getCollectionWithBooks(collectionId, { isOwner: true });
  if (!collection) {
    console.info('[email] collection not loadable, skipping', { kind, collectionId });
    return;
  }
  const locale = resolveLocale(payload.locale, row.locale, collection.locale);
  const formats = resolveFormats(kind, payload.formats);

  // attachments (none for an empty catalogue – the links still work)
  const built: (ExportFile & { format: ExportFormat })[] = [];
  const failedFormats: ExportFormat[] = [];
  if (collection.books.length > 0) {
    for (const format of formats) {
      try {
        const file = await buildExport(collection, format, locale, { isOwner: true });
        built.push({ ...file, format });
      } catch (err) {
        failedFormats.push(format);
        console.error('[email] export for attachment failed', { kind, collectionId, format, error: errorMessage(err) });
      }
    }
  }
  const capped = capAttachments(built);
  const linkFormats: ExportFormat[] =
    kind === 'export' ? [...EXPORT_FORMATS] : [...new Set([...capped.dropped, ...failedFormats])];
  const downloads: DownloadLink[] = linkFormats
    .map((format) => ({ format, url: downloadUrl(collection, format, locale) }))
    .filter((d): d is DownloadLink => Boolean(d.url));

  // the signed edit link only ever goes to the collection's own address
  const ownAddress = normalizeAddress(row.email);
  let editUrl: string | null = null;
  if (kind === 'collection_ready' && ownAddress && ownAddress === to) {
    editUrl = buildRecoveryUrl(row, READY_EDIT_LINK_HOURS);
  }

  const input = {
    locale,
    collection,
    appUrl: appUrlOf(collection),
    editUrl,
    attachments: capped.attached.map((f) => ({ format: f.format, filename: f.filename, size: f.body.length })),
    attachmentNote: capped.note,
    failedFormats,
    downloads,
  };
  const rendered = kind === 'collection_ready' ? renderCollectionReady(input) : renderExport(input);
  const attachments: MailAttachment[] = capped.attached.map((f) => ({
    filename: f.filename,
    contentType: f.contentType,
    content: f.body,
  }));

  let result: SendResult;
  try {
    result = await deliver({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, attachments, kind });
  } catch (err) {
    await logSafely({ collectionId, to, kind, status: 'failed', error: errorMessage(err) });
    console.error('[email] send failed', { kind, collectionId, to: maskAddress(to), error: errorMessage(err) });
    throw err;
  }
  await logSafely({ collectionId, to, kind, status: 'sent' });
  if (kind === 'collection_ready') {
    try {
      await markEmailSent(collectionId, new Date());
    } catch (err) {
      console.error('[email] could not set emailSentAt', { collectionId, error: errorMessage(err) });
    }
  }
  console.info('[email] sent', {
    kind,
    collectionId,
    to: maskAddress(to),
    provider: result.provider,
    attachments: attachments.map((a) => `${a.filename} (${a.content.length} B)`),
    note: capped.note,
  });
}

/* ------------------------------------------------------------------ */
/* recover_links                                                       */
/* ------------------------------------------------------------------ */

async function sendRecoverLinks(payload: JobPayloads['send_email']): Promise<void> {
  const to = normalizeAddress(payload.to);
  if (!to) {
    console.info('[email] recover_links without a valid address, skipping');
    return;
  }
  const rows = await findCollectionsByEmail(to, MAX_RECOVER_COLLECTIONS + 1);
  if (!rows.length) {
    await logSafely({ collectionId: null, to, kind: 'recover_links', status: 'skipped', error: 'no collections for this address' });
    console.info('[email] recover_links: no collections', { to: maskAddress(to) });
    return;
  }
  const listed = rows.slice(0, MAX_RECOVER_COLLECTIONS);
  const counts = await countBooksByCollection(listed.map((r) => r.id));
  const items: RecoverItem[] = listed.map((r) => ({
    id: r.id,
    title: r.title,
    ownerName: r.ownerName,
    bookCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt,
    status: r.status,
    publicUrl: publicCollectionUrl(r.id),
    editUrl: buildRecoveryUrl(r, RECOVER_LINK_HOURS),
  }));
  const locale = resolveLocale(payload.locale, listed[0].locale);
  const rendered = renderRecoverLinks({
    locale,
    appUrl: env().APP_URL.replace(/\/$/, ''),
    items,
    limited: rows.length > MAX_RECOVER_COLLECTIONS,
  });

  let result: SendResult;
  try {
    result = await deliver({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, kind: 'recover_links' });
  } catch (err) {
    await logSafely({ collectionId: null, to, kind: 'recover_links', status: 'failed', error: errorMessage(err) });
    console.error('[email] send failed', { kind: 'recover_links', to: maskAddress(to), error: errorMessage(err) });
    throw err;
  }
  await logSafely({ collectionId: null, to, kind: 'recover_links', status: 'sent' });
  console.info('[email] sent', { kind: 'recover_links', to: maskAddress(to), provider: result.provider, collections: items.length });
}

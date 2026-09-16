/**
 * Transactional e-mail templates (HTML + plain text) in the collection's locale.
 * Table layout, 600 px, inline styles, cream background, bottle-green buttons, gold accents,
 * Georgia headings. Every piece of user-provided text is HTML-escaped.
 */
import { getTranslator, type MessageKey, type Translator, type Vars } from '@/i18n';
import { topicDef, topicLabel } from '@/lib/taxonomy';
import type { BookDTO, CollectionStatus, CollectionWithBooksDTO, ExportFormat, Locale } from '@/lib/types';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface AttachmentInfo {
  format: ExportFormat;
  filename: string;
  size: number;
}

export interface DownloadLink {
  format: ExportFormat;
  url: string;
}

/** how attachments were limited by the size cap */
export type AttachmentNote = 'none' | 'pdfDropped' | 'tooLarge';

export interface CollectionEmailInput {
  locale: Locale;
  collection: CollectionWithBooksDTO;
  /** base URL of the app for the footer, e.g. https://www.exlibrisvideo.hu */
  appUrl: string;
  /** signed owner claim link (only when the recipient is the collection's own address) */
  editUrl: string | null;
  attachments: AttachmentInfo[];
  attachmentNote: AttachmentNote;
  failedFormats: ExportFormat[];
  downloads: DownloadLink[];
}

export interface RecoverItem {
  id: string;
  title: string | null;
  ownerName: string | null;
  bookCount: number;
  createdAt: Date | string;
  status: CollectionStatus;
  publicUrl: string;
  editUrl: string;
}

export interface RecoverEmailInput {
  locale: Locale;
  appUrl: string;
  items: RecoverItem[];
  /** true when more collections exist than are listed */
  limited: boolean;
}

/* ------------------------------------------------------------------ */
/* Escaping & small helpers                                            */
/* ------------------------------------------------------------------ */

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are ever put into href attributes. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Removes CR/LF and control characters (header injection) and collapses whitespace. */
export function headerSafe(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENTINEL = '\uE000';

/**
 * Translates, escapes the message text and the variables, and lets selected variables carry
 * pre-built (already safe) HTML.
 */
function th(tr: Translator, key: MessageKey, vars: Vars = {}, htmlVars: Record<string, string> = {}): string {
  const names = Object.keys(htmlVars);
  const withSentinels: Vars = { ...vars };
  names.forEach((name, i) => {
    withSentinels[name] = `${SENTINEL}${i}${SENTINEL}`;
  });
  let out = escapeHtml(tr.t(key, withSentinels));
  names.forEach((name, i) => {
    out = out.split(`${SENTINEL}${i}${SENTINEL}`).join(htmlVars[name]);
  });
  return out;
}

function thp(tr: Translator, key: MessageKey, count: number, vars: Vars = {}): string {
  return escapeHtml(tr.tp(key, count, vars));
}

function quoted(locale: Locale, s: string): string {
  return locale === 'hu' ? `„${s}”` : `“${s}”`;
}

export function displayTitle(collection: { title: string | null; ownerName: string | null }, locale: Locale): string {
  const tr = getTranslator(locale);
  const title = collection.title?.trim();
  if (title) return title;
  const owner = collection.ownerName?.trim();
  return owner ? tr.t('exporting.untitledOwner', { name: owner }) : tr.t('exporting.untitled');
}

export function formatBytes(bytes: number, locale: Locale): string {
  const nf = (v: number, digits: number) =>
    new Intl.NumberFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', { maximumFractionDigits: digits }).format(v);
  if (bytes < 1024) return `${nf(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${nf(bytes / 1024, 0)} KB`;
  return `${nf(bytes / (1024 * 1024), 1)} MB`;
}

function formatLabel(tr: Translator, format: ExportFormat): string {
  return tr.t(`exporting.format.${format}` as MessageKey);
}

/* ------------------------------------------------------------------ */
/* Design tokens & building blocks                                     */
/* ------------------------------------------------------------------ */

const T = {
  bg: '#f6efe2',
  card: '#fffdf8',
  border: '#e6dcc8',
  ink: '#1d1a16',
  muted: '#6b645a',
  green: '#1f4d3a',
  gold: '#a87a2e',
  cream: '#fbf6ec',
  chip: '#f3ead8',
  wood: '#7a5230',
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

const SPINE_PALETTE = ['#7a2e2a', '#1f4d3a', '#2f5d7c', '#a87a2e', '#5e2750', '#3e4a3d', '#8b5a2b', '#154360', '#9b3d2f', '#4d6b3c'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function spineColorOf(book: Pick<BookDTO, 'spineColor' | 'author' | 'title'>): string {
  const c = book.spineColor?.trim() ?? '';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
  return SPINE_PALETTE[hash(book.author ?? book.title) % SPINE_PALETTE.length];
}

function paragraph(html: string, opts: { size?: number; color?: string; margin?: string; align?: string } = {}): string {
  return `<p style="margin:${opts.margin ?? '0 0 16px'};font-family:${T.sans};font-size:${opts.size ?? 16}px;line-height:1.6;color:${opts.color ?? T.ink};${opts.align ? `text-align:${opts.align};` : ''}">${html}</p>`;
}

function heading(html: string, size = 28): string {
  return `<h1 class="h1" style="margin:0 0 14px;font-family:${T.serif};font-size:${size}px;line-height:1.25;font-weight:bold;color:${T.green};">${html}</h1>`;
}

function subheading(html: string): string {
  return `<h2 style="margin:28px 0 10px;font-family:${T.serif};font-size:19px;line-height:1.3;font-weight:bold;color:${T.green};">${html}</h2>`;
}

function button(label: string, url: string, variant: 'primary' | 'secondary' = 'primary'): string {
  const href = escapeHtml(url);
  const primary = variant === 'primary';
  const bg = primary ? T.green : T.card;
  const color = primary ? T.cream : T.green;
  const border = primary ? T.green : T.gold;
  const size = primary ? 18 : 15;
  const pad = primary ? '15px 34px' : '11px 24px';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:${primary ? '26px' : '14px'} auto;border-collapse:separate;">
<tr><td align="center" bgcolor="${bg}" style="border-radius:8px;background:${bg};border:2px solid ${border};">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:${pad};font-family:${T.serif};font-size:${size}px;line-height:1.2;font-weight:bold;color:${color};text-decoration:none;border-radius:8px;">${label}</a>
</td></tr></table>`;
}

function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;"><tr>
<td style="border-top:1px solid ${T.border};font-size:0;line-height:0;">&nbsp;</td>
<td width="24" align="center" style="font-family:${T.serif};font-size:14px;line-height:1;color:${T.gold};padding:0 8px;">&#9670;</td>
<td style="border-top:1px solid ${T.border};font-size:0;line-height:0;">&nbsp;</td>
</tr></table>`;
}

function statsRow(tr: Translator, books: BookDTO[]): string {
  const authors = new Set<string>();
  const topics = new Set<string>();
  for (const b of books) {
    for (const a of (b.author ?? '').split(';')) if (a.trim()) authors.add(a.trim().toLowerCase());
    if (b.category) topics.add(b.category);
  }
  const cells: [number, MessageKey][] = [
    [books.length, 'email.stat.books'],
    [authors.size, 'email.stat.authors'],
    [topics.size, 'email.stat.topics'],
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;"><tr>
${cells
  .map(
    ([n, key]) => `<td width="33%" align="center" style="padding:14px 6px;background:${T.chip};border-radius:8px;border:4px solid ${T.card};">
<div style="font-family:${T.serif};font-size:30px;line-height:1.1;font-weight:bold;color:${T.green};">${escapeHtml(tr.n(n))}</div>
<div style="font-family:${T.sans};font-size:13px;line-height:1.4;color:${T.muted};">${thp(tr, key, n)}</div>
</td>`,
  )
  .join('\n')}
</tr></table>`;
}

interface TopTopic {
  key: string;
  count: number;
}

export function topTopics(books: BookDTO[], limit = 3): TopTopic[] {
  const counts = new Map<string, number>();
  for (const b of books) if (b.category) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function topicChips(tr: Translator, locale: Locale, topics: TopTopic[]): string {
  return `<div style="margin:0 0 6px;">${topics
    .map((t) => {
      const icon = topicDef(t.key)?.icon ?? '';
      return `<span style="display:inline-block;margin:0 6px 8px 0;padding:6px 12px;border-radius:999px;background:${T.chip};border:1px solid ${T.border};font-family:${T.sans};font-size:14px;line-height:1.3;color:${T.ink};white-space:nowrap;">${escapeHtml(icon)} ${escapeHtml(topicLabel(t.key, locale))} <span style="color:${T.gold};font-weight:bold;">${escapeHtml(tr.n(t.count))}</span></span>`;
    })
    .join('')}</div>`;
}

/** Up to 20 coloured spines standing on a wooden shelf board. */
export function miniShelf(books: BookDTO[], max = 20): string {
  const shelf = [...books].sort((a, b) => (a.shelfPosition ?? 0) - (b.shelfPosition ?? 0)).slice(0, max);
  if (!shelf.length) return '';
  const specs = shelf.map((b) => {
    const h = hash(`${b.id}|${b.title}`);
    const pages = b.pageCount && b.pageCount > 0 ? b.pageCount : 150 + (h % 350);
    const width = Math.max(12, Math.min(26, Math.round(10 + pages / 40)));
    const height = 58 + (h % 34) + Math.min(10, Math.floor(b.title.length / 6));
    return { color: spineColorOf(b), width, height, title: b.title };
  });
  const total = specs.reduce((s, x) => s + x.width + 3, 0);
  const cells = specs
    .map((s) => {
      const pct = ((s.width + 3) / total) * 100;
      return `<td width="${pct.toFixed(2)}%" valign="bottom" style="padding:0 1px;vertical-align:bottom;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td height="${s.height}" bgcolor="${s.color}" title="${escapeHtml(s.title)}" style="height:${s.height}px;background:${s.color};border-radius:3px 3px 0 0;border-top:3px solid rgba(255,255,255,0.18);font-size:0;line-height:0;">&nbsp;</td>
</tr></table></td>`;
    })
    .join('\n');
  const shelfWidth = Math.min(100, Math.max(40, Math.round((total / 520) * 100)));
  return `<table role="presentation" width="${shelfWidth}%" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 0;">
<tr>${cells}</tr>
<tr><td colspan="${specs.length}" height="10" bgcolor="${T.wood}" style="height:10px;background:${T.wood};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>`;
}

function brandHeader(tr: Translator): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td align="center" valign="middle" width="46" height="46" bgcolor="${T.green}" style="width:46px;height:46px;border-radius:23px;background:${T.green};border:2px solid ${T.gold};font-family:${T.serif};font-size:9px;line-height:1.1;letter-spacing:1px;color:${T.cream};font-weight:bold;">EX<br>LIBRIS</td>
<td style="padding-left:12px;font-family:${T.serif};font-size:22px;line-height:1;color:${T.green};font-weight:bold;">${escapeHtml(tr.t('common.appName'))}</td>
</tr></table>`;
}

function layout(opts: { locale: Locale; subject: string; preheader: string; body: string; footerReason: string; appUrl: string }): string {
  const tr = getTranslator(opts.locale);
  const app = safeUrl(opts.appUrl);
  const appLabel = app ? escapeHtml(app.replace(/^https?:\/\//, '').replace(/\/$/, '')) : '';
  return `<!doctype html>
<html lang="${opts.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.subject)}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;}
a{color:${T.green};}
@media only screen and (max-width:620px){
.container{width:100% !important;max-width:100% !important;}
.px{padding-left:20px !important;padding-right:20px !important;}
.h1{font-size:25px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${T.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.bg};opacity:0;">${escapeHtml(opts.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.bg}" style="background:${T.bg};">
<tr><td align="center" style="padding:28px 10px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td class="px" align="center" style="padding:0 32px 20px;">${brandHeader(tr)}</td></tr>
<tr><td bgcolor="${T.card}" style="background:${T.card};border:1px solid ${T.border};border-top:4px solid ${T.green};border-radius:10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" style="padding:36px 40px 30px;">
${opts.body}
</td></tr></table>
</td></tr>
<tr><td class="px" align="center" style="padding:22px 32px 8px;font-family:${T.sans};font-size:12px;line-height:1.6;color:${T.muted};">
${escapeHtml(opts.footerReason)}<br>
<span style="font-family:${T.serif};font-style:italic;color:${T.gold};">${escapeHtml(tr.t('email.footer.tagline'))}</span>
${app ? `<br><a href="${escapeHtml(app)}" target="_blank" rel="noopener" style="color:${T.green};text-decoration:underline;">${appLabel}</a>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function textFooter(tr: Translator, reason: string, appUrl: string): string {
  const app = safeUrl(appUrl)?.replace(/\/$/, '');
  // "-- " (with the trailing space) is the standard plain-text signature separator
  return ['-- ', reason, `${tr.t('common.appName')} · ${tr.t('email.footer.tagline')}`, app ?? ''].filter(Boolean).join('\n');
}

function attachmentsBlock(tr: Translator, input: CollectionEmailInput): { html: string; text: string[] } {
  const html: string[] = [];
  const text: string[] = [];
  if (input.attachments.length) {
    const list = input.attachments.map((a) => `${formatLabel(tr, a.format)} – ${formatBytes(a.size, tr.locale)}`).join(', ');
    html.push(paragraph(th(tr, 'email.attach.attached', { formats: list }), { size: 15, color: T.muted, margin: '0 0 10px' }));
    text.push(tr.t('email.attach.attached', { formats: list }));
  }
  if (input.attachmentNote === 'pdfDropped') {
    html.push(paragraph(th(tr, 'email.attach.pdfDropped'), { size: 15, color: T.muted, margin: '0 0 10px' }));
    text.push(tr.t('email.attach.pdfDropped'));
  } else if (input.attachmentNote === 'tooLarge') {
    html.push(paragraph(th(tr, 'email.attach.tooLarge'), { size: 15, color: T.muted, margin: '0 0 10px' }));
    text.push(tr.t('email.attach.tooLarge'));
  }
  if (input.failedFormats.length) {
    const list = input.failedFormats.map((f) => formatLabel(tr, f)).join(', ');
    html.push(paragraph(th(tr, 'email.attach.failed', { formats: list }), { size: 15, color: T.muted, margin: '0 0 10px' }));
    text.push(tr.t('email.attach.failed', { formats: list }));
  }
  const links = input.downloads.map((d) => ({ ...d, url: safeUrl(d.url) })).filter((d): d is DownloadLink => Boolean(d.url));
  if (links.length) {
    html.push(paragraph(th(tr, 'email.attach.downloads'), { size: 15, color: T.muted, margin: '6px 0 6px' }));
    html.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">${links
        .map(
          (d) => `<tr><td style="padding:3px 8px 3px 0;font-family:${T.serif};font-size:15px;color:${T.gold};">&#9656;</td>
<td style="padding:3px 0;font-family:${T.sans};font-size:15px;line-height:1.5;"><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" style="color:${T.green};text-decoration:underline;">${escapeHtml(formatLabel(tr, d.format))}</a></td></tr>`,
        )
        .join('')}</table>`,
    );
    text.push(tr.t('email.attach.downloads'));
    for (const d of links) text.push(`- ${formatLabel(tr, d.format)}: ${d.url}`);
  }
  return { html: html.join('\n'), text };
}

function greeting(tr: Translator, ownerName: string | null): string {
  const name = ownerName?.trim();
  return name ? tr.t('email.greeting.named', { name }) : tr.t('email.greeting.anon');
}

/* ------------------------------------------------------------------ */
/* collection_ready                                                    */
/* ------------------------------------------------------------------ */

export function renderCollectionReady(input: CollectionEmailInput): RenderedEmail {
  const { locale, collection: c } = input;
  const tr = getTranslator(locale);
  const books = c.books ?? [];
  const count = books.length;
  const title = displayTitle(c, locale);
  const publicUrl = safeUrl(c.publicUrl);
  const editUrl = safeUrl(input.editUrl);
  const subject = headerSafe(tr.tp('email.subject.ready', count));
  const preheader = tr.tp('email.preheader.ready', count);
  const reviewCount = books.filter((b) => b.needsReview && !b.reviewed).length;
  const topics = topTopics(books, 3);

  const body: string[] = [];
  body.push(paragraph(escapeHtml(greeting(tr, c.ownerName)), { margin: '0 0 12px', color: T.muted }));
  body.push(heading(escapeHtml(tr.t('email.ready.heading'))));
  body.push(
    `<p style="margin:0 0 18px;font-family:${T.serif};font-size:20px;line-height:1.4;font-style:italic;color:${T.gold};">${escapeHtml(quoted(locale, title))}</p>`,
  );
  if (count > 0) {
    body.push(paragraph(thp(tr, 'email.ready.intro', count)));
    body.push(statsRow(tr, books));
    const shelf = miniShelf(books);
    if (shelf) {
      body.push(subheading(escapeHtml(tr.t('email.ready.shelf'))));
      body.push(shelf);
    }
    if (topics.length) {
      body.push(subheading(escapeHtml(tr.t('email.ready.topTopics'))));
      body.push(topicChips(tr, locale, topics));
    }
  } else {
    body.push(paragraph(escapeHtml(tr.t('email.ready.introEmpty'))));
  }
  if (publicUrl) {
    body.push(button(escapeHtml(tr.t('email.ready.button')), publicUrl));
    body.push(
      paragraph(
        `${escapeHtml(tr.t('email.ready.linkHint'))}<br><a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener" style="color:${T.green};font-weight:bold;word-break:break-all;">${escapeHtml(publicUrl.replace(/^https?:\/\//, ''))}</a>`,
        { size: 14, color: T.muted, align: 'center' },
      ),
    );
  }
  if (editUrl) {
    body.push(divider());
    body.push(subheading(escapeHtml(tr.t('email.ready.editHeading'))));
    body.push(paragraph(escapeHtml(tr.t('email.ready.editText')), { size: 15 }));
    body.push(button(escapeHtml(tr.t('email.ready.editButton')), editUrl, 'secondary'));
    body.push(paragraph(escapeHtml(tr.t('email.ready.editLater')), { size: 13, color: T.muted }));
  }
  const attach = attachmentsBlock(tr, input);
  if (attach.html) {
    body.push(divider());
    body.push(attach.html);
  }
  if (count > 0) {
    const tips: string[] = [];
    if (reviewCount > 0) tips.push(tr.tp('email.tips.review', reviewCount));
    tips.push(tr.t('email.tips.more'), tr.t('email.tips.status'), tr.t('email.tips.share'));
    body.push(subheading(escapeHtml(tr.t('email.tips.heading'))));
    body.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${tips
        .map(
          (tip) => `<tr><td valign="top" width="22" style="padding:4px 0;font-family:${T.serif};font-size:15px;line-height:1.55;color:${T.gold};">&#10087;</td>
<td style="padding:4px 0;font-family:${T.sans};font-size:15px;line-height:1.55;color:${T.ink};">${escapeHtml(tip)}</td></tr>`,
        )
        .join('')}</table>`,
    );
  }

  const reason = tr.t('email.footer.reasonCollection');
  const html = layout({ locale, subject, preheader, body: body.join('\n'), footerReason: reason, appUrl: input.appUrl });

  const text: string[] = [greeting(tr, c.ownerName), '', tr.t('email.ready.heading'), quoted(locale, title), ''];
  if (count > 0) {
    text.push(tr.tp('email.ready.intro', count), '');
    const authors = new Set(books.flatMap((b) => (b.author ?? '').split(';').map((a) => a.trim().toLowerCase()).filter(Boolean)));
    const topicCount = new Set(books.map((b) => b.category).filter(Boolean)).size;
    text.push(
      [
        `${tr.n(count)} ${tr.tp('email.stat.books', count)}`,
        `${tr.n(authors.size)} ${tr.tp('email.stat.authors', authors.size)}`,
        `${tr.n(topicCount)} ${tr.tp('email.stat.topics', topicCount)}`,
      ].join(' · '),
    );
    if (topics.length) {
      text.push(`${tr.t('email.ready.topTopics')}: ${topics.map((t) => `${topicLabel(t.key, locale)} (${tr.n(t.count)})`).join(', ')}`);
    }
  } else {
    text.push(tr.t('email.ready.introEmpty'));
  }
  if (publicUrl) text.push('', tr.t('email.text.open', { url: publicUrl }));
  if (editUrl) {
    text.push('', tr.t('email.ready.editHeading'), tr.t('email.ready.editText'), tr.t('email.text.edit', { url: editUrl }), tr.t('email.ready.editLater'));
  }
  if (attach.text.length) text.push('', ...attach.text);
  if (count > 0) {
    text.push('', tr.t('email.tips.heading'));
    if (reviewCount > 0) text.push(`- ${tr.tp('email.tips.review', reviewCount)}`);
    text.push(`- ${tr.t('email.tips.more')}`, `- ${tr.t('email.tips.status')}`, `- ${tr.t('email.tips.share')}`);
  }
  text.push('', textFooter(tr, reason, input.appUrl));

  return { subject, html, text: `${text.join('\n')}\n` };
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

export function renderExport(input: CollectionEmailInput): RenderedEmail {
  const { locale, collection: c } = input;
  const tr = getTranslator(locale);
  const books = c.books ?? [];
  const title = displayTitle(c, locale);
  const publicUrl = safeUrl(c.publicUrl);
  const editUrl = safeUrl(input.editUrl);
  const subject = headerSafe(tr.t('email.subject.export', { title }));
  const preheader = tr.t('email.preheader.export');

  const body: string[] = [];
  body.push(paragraph(escapeHtml(greeting(tr, c.ownerName)), { margin: '0 0 12px', color: T.muted }));
  body.push(heading(escapeHtml(tr.t('email.export.heading'))));
  body.push(paragraph(escapeHtml(tr.t('email.export.introTitled')), { margin: '0 0 6px' }));
  body.push(
    `<p style="margin:0 0 20px;font-family:${T.serif};font-size:20px;line-height:1.4;font-style:italic;color:${T.gold};">${escapeHtml(quoted(locale, title))} <span style="font-family:${T.sans};font-style:normal;font-size:14px;color:${T.muted};">(${thp(tr, 'email.export.count', books.length)})</span></p>`,
  );
  const attach = attachmentsBlock(tr, input);
  if (attach.html) body.push(attach.html);
  if (publicUrl) body.push(button(escapeHtml(tr.t('email.export.button')), publicUrl));
  if (editUrl) {
    body.push(divider());
    body.push(paragraph(escapeHtml(tr.t('email.ready.editText')), { size: 14, color: T.muted }));
    body.push(button(escapeHtml(tr.t('email.ready.editButton')), editUrl, 'secondary'));
  }

  const reason = tr.t('email.footer.reasonExport');
  const html = layout({ locale, subject, preheader, body: body.join('\n'), footerReason: reason, appUrl: input.appUrl });
  const text: string[] = [
    greeting(tr, c.ownerName),
    '',
    tr.t('email.export.heading'),
    `${tr.t('email.export.introTitled')} ${quoted(locale, title)} (${tr.tp('email.export.count', books.length)})`,
  ];
  if (attach.text.length) text.push('', ...attach.text);
  if (publicUrl) text.push('', tr.t('email.text.open', { url: publicUrl }));
  if (editUrl) text.push('', tr.t('email.text.edit', { url: editUrl }));
  text.push('', textFooter(tr, reason, input.appUrl));
  return { subject, html, text: `${text.join('\n')}\n` };
}

/* ------------------------------------------------------------------ */
/* recover_links                                                       */
/* ------------------------------------------------------------------ */

export function renderRecoverLinks(input: RecoverEmailInput): RenderedEmail {
  const { locale } = input;
  const tr = getTranslator(locale);
  const subject = headerSafe(tr.t('email.subject.recover'));
  const preheader = tr.t('email.preheader.recover');

  const body: string[] = [];
  body.push(heading(escapeHtml(tr.t('email.recover.heading'))));
  body.push(paragraph(escapeHtml(tr.t('email.recover.intro'))));

  const textItems: string[] = [];
  for (const item of input.items) {
    const title = displayTitle(item, locale);
    const editUrl = safeUrl(item.editUrl);
    const publicUrl = safeUrl(item.publicUrl);
    const created = tr.d(item.createdAt, { dateStyle: 'medium', timeZone: 'Europe/Budapest' });
    const meta = [tr.tp('email.recover.books', item.bookCount), tr.t('email.recover.created', { date: created })];
    if (item.status !== 'ready') meta.push(tr.t(`email.status.${item.status}` as MessageKey));
    body.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid ${T.border};border-left:4px solid ${T.gold};border-radius:8px;background:${T.card};">
<tr><td style="padding:16px 18px;">
<div style="font-family:${T.serif};font-size:19px;line-height:1.35;font-weight:bold;color:${T.green};">${escapeHtml(title)}</div>
<div style="margin-top:4px;font-family:${T.sans};font-size:13px;line-height:1.5;color:${T.muted};">${escapeHtml(meta.join(' · '))}</div>
${editUrl ? button(escapeHtml(tr.t('email.recover.editButton')), editUrl, 'secondary').replace('margin:14px auto', 'margin:12px 0 6px') : ''}
${publicUrl ? `<div style="font-family:${T.sans};font-size:13px;line-height:1.5;color:${T.muted};">${escapeHtml(tr.t('email.recover.publicLink'))}: <a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener" style="color:${T.green};">${escapeHtml(publicUrl.replace(/^https?:\/\//, ''))}</a></div>` : ''}
</td></tr></table>`);
    textItems.push(
      [
        `* ${title} (${meta.join(' · ')})`,
        editUrl ? `  ${tr.t('email.text.editRecover', { url: editUrl })}` : '',
        publicUrl ? `  ${tr.t('email.text.public', { url: publicUrl })}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (input.limited) body.push(paragraph(escapeHtml(tr.t('email.recover.limited', { count: input.items.length })), { size: 13, color: T.muted }));
  body.push(paragraph(escapeHtml(tr.t('email.recover.validity')), { size: 14, color: T.muted, margin: '18px 0 10px' }));
  body.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;"><tr><td style="padding:12px 14px;background:${T.chip};border-radius:8px;font-family:${T.sans};font-size:14px;line-height:1.55;color:${T.ink};">${escapeHtml(tr.t('email.recover.ignore'))}</td></tr></table>`,
  );

  const reason = tr.t('email.footer.reasonRecover');
  const html = layout({ locale, subject, preheader, body: body.join('\n'), footerReason: reason, appUrl: input.appUrl });
  const text: string[] = [tr.t('email.recover.heading'), '', tr.t('email.recover.intro'), '', ...textItems];
  if (input.limited) text.push('', tr.t('email.recover.limited', { count: input.items.length }));
  text.push('', tr.t('email.recover.validity'), '', tr.t('email.recover.ignore'), '', textFooter(tr, reason, input.appUrl));
  return { subject, html, text: `${text.join('\n')}\n` };
}

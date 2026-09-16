/**
 * Tiny typed i18n (no routing – the collection URL stays exlibrisvideo.hu/<id>).
 * Locale comes from the `exl_lang` cookie, else Accept-Language (hu → hu, otherwise en).
 *
 *   translate('hu', 'common.action.save')            → "Mentés"
 *   translate('en', 'common.unit.book', {count: 3})  → "{count} books" → "3 books"
 *   translatePlural('en', 'common.unit.book', 1)     → "1 book"
 */
import type { Locale } from '@/lib/types';
import { book } from './messages/book';
import { collection } from './messages/collection';
import { common } from './messages/common';
import { data } from './messages/data';
import { email } from './messages/email';
import { errors } from './messages/errors';
import { exporting } from './messages/exporting';
import { landing } from './messages/landing';
import { legal } from './messages/legal';
import { my } from './messages/my';
import { processing } from './messages/processing';
import { upload } from './messages/upload';
import { visual } from './messages/visual';

export const LOCALES: Locale[] = ['hu', 'en'];
export const DEFAULT_LOCALE: Locale = 'hu';
export const LOCALE_COOKIE = 'exl_lang';

const dictionaries = {
  common,
  landing,
  upload,
  processing,
  collection,
  book,
  visual,
  data,
  exporting,
  email,
  errors,
  legal,
  my,
};

type Dicts = typeof dictionaries;
type Area = keyof Dicts;
export type MessageKey = {
  [A in Area]: `${A}.${Extract<keyof Dicts[A]['hu'], string>}`;
}[Area];

export type Vars = Record<string, string | number | null | undefined>;

export function isLocale(v: unknown): v is Locale {
  return v === 'hu' || v === 'en';
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const first = header
    .split(',')
    .map((p) => p.trim().split(';')[0].toLowerCase())
    .find((p) => p && p !== '*');
  if (!first) return DEFAULT_LOCALE;
  return first.startsWith('hu') ? 'hu' : 'en';
}

function lookup(locale: Locale, key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const area = key.slice(0, dot) as Area;
  const rest = key.slice(dot + 1);
  const dict = dictionaries[area] as { hu: Record<string, string>; en: Record<string, string> } | undefined;
  if (!dict) return undefined;
  return dict[locale][rest] ?? dict.hu[rest];
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? m : String(v);
  });
}

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const s = lookup(locale, key);
  if (s === undefined) {
    if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] missing key ${key}`);
    return key;
  }
  return interpolate(s, vars);
}

/** Picks "<key>_one" when count === 1 (if defined), otherwise "<key>". `count` is injected as a var. */
export function translatePlural(locale: Locale, key: MessageKey, count: number, vars?: Vars): string {
  const one = count === 1 ? lookup(locale, `${key}_one`) : undefined;
  const s = one ?? lookup(locale, key) ?? key;
  return interpolate(s, { count: formatNumber(locale, count), ...vars });
}

export function formatNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(locale === 'hu' ? 'hu-HU' : 'en-GB').format(n);
}

export function formatDate(locale: Locale, d: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', opts ?? { dateStyle: 'medium' }).format(date);
}

/** Bound helpers for one locale. */
export function getTranslator(locale: Locale) {
  return {
    locale,
    t: (key: MessageKey, vars?: Vars) => translate(locale, key, vars),
    tp: (key: MessageKey, count: number, vars?: Vars) => translatePlural(locale, key, count, vars),
    n: (value: number) => formatNumber(locale, value),
    d: (value: Date | string, opts?: Intl.DateTimeFormatOptions) => formatDate(locale, value, opts),
  };
}
export type Translator = ReturnType<typeof getTranslator>;

import { cookies, headers } from 'next/headers';
import type { Locale } from '@/lib/types';
import { getTranslator, isLocale, LOCALE_COOKIE, localeFromAcceptLanguage } from './index';

/** Locale for the current request (Server Components / Route Handlers). */
export async function getRequestLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  return localeFromAcceptLanguage((await headers()).get('accept-language'));
}

/** Translator bound to the request locale. */
export async function getServerT() {
  return getTranslator(await getRequestLocale());
}

/** Locale for a Route Handler: ?lang= query param wins, then cookie, then Accept-Language. */
export function localeFromRequest(req: Request): Locale {
  const url = new URL(req.url);
  const q = url.searchParams.get('lang');
  if (isLocale(q)) return q;
  const cookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${LOCALE_COOKIE}=`))
    ?.split('=')[1];
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(req.headers.get('accept-language'));
}

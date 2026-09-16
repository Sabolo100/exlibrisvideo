import { cookies, headers } from 'next/headers';
import { userAgent } from 'next/server';
import { resolveUiMode, UI_MODE_COOKIE, type UiMode } from './ui-mode';

/** UI mode of the current request (cookie override, else phone user agent → app). */
export async function getUiMode(): Promise<UiMode> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const { device } = userAgent({ headers: headerStore });
  return resolveUiMode(cookieStore.get(UI_MODE_COOKIE)?.value, device.type);
}

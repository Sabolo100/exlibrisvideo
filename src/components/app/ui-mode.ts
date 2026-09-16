/**
 * "app" = the phone app shell (bottom tab bar, fixed full-screen layout, no page scroll);
 * "web" = the responsive website. Pure – shared by server and client.
 */
export type UiMode = 'app' | 'web';

/** Cookie that overrides the automatic choice ("app" | "web"), e.g. "Asztali nézet" in the app settings. */
export const UI_MODE_COOKIE = 'exl_ui';

export function isUiMode(value: unknown): value is UiMode {
  return value === 'app' || value === 'web';
}

/**
 * Phones get the app, tablets and computers the website. `deviceType` is the ua-parser device type
 * ("mobile", "tablet", undefined for desktops); a saved choice always wins.
 */
export function resolveUiMode(cookieValue: string | undefined, deviceType: string | undefined): UiMode {
  if (isUiMode(cookieValue)) return cookieValue;
  return deviceType === 'mobile' ? 'app' : 'web';
}

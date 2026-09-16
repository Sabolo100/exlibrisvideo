import { userAgent } from 'next/server';
import { describe, expect, it } from 'vitest';
import { resolveUiMode } from './ui-mode';

const deviceOf = (ua: string) => userAgent({ headers: new Headers({ 'user-agent': ua }) }).device.type;

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';

describe('resolveUiMode', () => {
  it('gives phones the app and everything else the website', () => {
    expect(resolveUiMode(undefined, deviceOf(IPHONE))).toBe('app');
    expect(resolveUiMode(undefined, deviceOf(ANDROID_PHONE))).toBe('app');
    expect(resolveUiMode(undefined, deviceOf(ANDROID_TABLET))).toBe('web');
    expect(resolveUiMode(undefined, deviceOf(IPAD))).toBe('web');
    expect(resolveUiMode(undefined, deviceOf(DESKTOP))).toBe('web');
  });

  it('lets a saved choice win in both directions', () => {
    expect(resolveUiMode('web', deviceOf(IPHONE))).toBe('web');
    expect(resolveUiMode('app', deviceOf(DESKTOP))).toBe('app');
  });

  it('ignores unknown cookie values', () => {
    expect(resolveUiMode('tablet', deviceOf(IPHONE))).toBe('app');
    expect(resolveUiMode('', deviceOf(DESKTOP))).toBe('web');
  });
});

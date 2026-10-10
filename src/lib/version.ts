/**
 * App version (package.json) and build id (content hash of the sources, see next.config.ts).
 * Safe in client and server code; the worker (no Next build) reports `dev` as build id.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

/** "v1.1.0 · 3fa9c21" */
export function versionLabel(): string {
  return `v${APP_VERSION} · ${BUILD_ID}`;
}

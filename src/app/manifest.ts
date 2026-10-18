import type { MetadataRoute } from 'next';

/** Web app manifest: "Add to Home Screen" / "Install app" opens Ex Libris full screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Ex Libris Video',
    short_name: 'Ex Libris',
    description: 'Filmezd le a könyvespolcodat – a könyveidből katalógus lesz.',
    lang: 'hu',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone'],
    prefer_related_applications: false,
    orientation: 'portrait',
    background_color: '#f6efe2',
    theme_color: '#f6efe2',
    categories: ['books', 'lifestyle', 'productivity'],
    // long-press menu of the home-screen icon (Android)
    shortcuts: [
      { name: 'Katalógusaim', short_name: 'Katalógusok', url: '/my?source=pwa', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

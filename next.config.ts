import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the tracing root to the project (a stray lockfile in a parent folder otherwise wins).
  outputFileTracingRoot: process.cwd(),
  // Allows parallel local dev servers (NEXT_DIST_DIR=.next-preview next dev -p 3101).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Native / heavy Node packages stay external to the server bundle.
  serverExternalPackages: ['sharp', 'pdfkit', 'exceljs', 'pg', 'nodemailer', '@anthropic-ai/sdk'],
  images: {
    // Covers come from Open Library / Google Books; spine crops are served by /api/media.
    remotePatterns: [
      { protocol: 'https', hostname: 'covers.openlibrary.org' },
      { protocol: 'https', hostname: 'books.google.com' },
      { protocol: 'http', hostname: 'books.google.com' },
    ],
  },
};

export default nextConfig;

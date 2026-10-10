import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import pkg from './package.json';

/**
 * Short build id = content hash of everything that goes into the build (sources, migrations, manifests).
 * The Docker build has no .git, so a commit hash is not available there; the same sources always give
 * the same id, and every change gives a new one.
 */
function contentHash(): string {
  const hash = crypto.createHash('sha256');
  const visit = (rel: string) => {
    const abs = path.join(process.cwd(), rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) visit(path.join(rel, name));
      return;
    }
    hash.update(rel.split(path.sep).join('/'));
    hash.update(fs.readFileSync(abs));
  };
  for (const rel of ['src', 'drizzle', 'public', 'package.json', 'package-lock.json', 'next.config.ts']) visit(rel);
  return hash.digest('hex').slice(0, 7);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the tracing root to the project (a stray lockfile in a parent folder otherwise wins).
  outputFileTracingRoot: process.cwd(),
  // Allows parallel local dev servers (NEXT_DIST_DIR=.next-preview next dev -p 3101).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Native / heavy Node packages stay external to the server bundle.
  serverExternalPackages: ['sharp', 'pdfkit', 'exceljs', 'pg', 'nodemailer', '@anthropic-ai/sdk'],
  // shown in the footer / app settings (src/lib/version.ts)
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID || contentHash(),
  },
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

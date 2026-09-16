import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // tsconfig keeps "jsx": "preserve" (required by Next.js); tests compile JSX with the automatic runtime
  // so server-render specs can import .tsx components.
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.tsx', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

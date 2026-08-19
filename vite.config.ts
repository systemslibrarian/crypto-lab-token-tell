import { defineConfig } from 'vitest/config';

import { offlinePlugin } from './tools/vite-plugin-offline.ts';

const BASE = process.env.VITE_BASE_PATH ?? '/crypto-lab-token-tell/';

// Real repo name — the lab deploys under this GitHub Pages subpath. Root-absolute asset
// paths 404 under a project subpath, so every in-page asset uses `./`, a Vite-imported
// asset, or a data: URI.
export default defineConfig({
  base: BASE,
  plugins: [offlinePlugin(BASE)],
  test: {
    // Playwright specs live in e2e/ — keep them out of the Vitest run.
    include: ['src/**/*.test.ts'],
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      // Gate coverage on the layers where a wrong number would be a wrong claim: the
      // watermark maths, the tokenizer, the statistics and the signing. The UI is
      // exercised by the Playwright claims and a11y suites instead.
      include: ['src/watermark/**/*.ts', 'src/tokenizer/**/*.ts', 'src/c2pa/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
        branches: 85,
      },
      reporter: ['text-summary', 'html'],
    },
  },
});

import { defineConfig, devices } from '@playwright/test';

// Accessibility and claims gate. Runs against the production build served by
// `vite preview`, so what passes here is what actually ships to GitHub Pages.
const BASE = '/crypto-lab-token-tell/';
const PORT = 4684; // surveyed free across 178 sibling labs' committed configs
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 90_000,
  webServer: {
    // Build before serving. `preview` only serves whatever is already in dist/;
    // without the build in front, a failing build leaves the previous good bundle
    // on disk and the suite passes green against code that no longer compiles —
    // which silently invalidates mutation checking.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `${ORIGIN}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  use: {
    baseURL: `${ORIGIN}${BASE}`,
    colorScheme: 'dark',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

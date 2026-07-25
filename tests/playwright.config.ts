import { defineConfig, devices } from '@playwright/test';

// Playwright config for the mcp-tutorial static site.
// Run from the `tests/` directory (`cd tests && npx playwright test`), so
// ../site points to the real site folder we serve.

const PORT = 8080;
const BASE = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: './playwright',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 2,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx http-server ../site -p ${PORT} -c-1 --silent`,
    cwd: __dirname,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

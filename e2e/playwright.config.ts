import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  // The target is a single dev-mode `uvicorn --reload` process (docker-compose.yml),
  // not a scaled multi-worker backend. Running specs across multiple parallel workers
  // was hammering it hard enough to cause intermittent slow responses and flaky
  // failures (confirmed: same spec passes 5/5 alone, flakes only under concurrency).
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'docker compose up -d',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    cwd: '..',
    timeout: 120_000,
  },
});

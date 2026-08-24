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
  // Two deployments to wait for, checked independently: the frontend (which
  // `make up` brings up along with the HTTP API) and the WebSocket service on
  // its own port. Checking :8001 separately matters because reuseExistingServer
  // only looks at the URL — with a single frontend check, a locally running
  // vite would satisfy it while nothing served sockets, and every realtime spec
  // would fail on a connection error instead of saying what was missing.
  webServer: [
    {
      command: 'make up',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 120_000,
    },
    {
      command: 'make ws',
      url: 'http://localhost:8001/health',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 120_000,
    },
  ],
});

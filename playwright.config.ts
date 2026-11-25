import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env.CAPTURE_README_SCREENSHOTS === '1'
    ? []
    : ['**/readme_screenshots.spec.ts'],
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  use: {
    channel: 'chrome',
    headless: true,
    launchOptions: { chromiumSandbox: true },
  },
  reporter: [['list']],
});

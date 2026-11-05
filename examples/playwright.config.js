import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'revocation.spec.js', workers: 1, timeout: 15_000, use: { browserName: 'chromium', headless: true } });

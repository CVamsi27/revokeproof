import { chromium } from '@playwright/test';
import { runSyntheticCase } from './synthetic.js';
import { revocationExitCode } from '@developer-pain-lab/revokeproof';
const mode = process.argv[2] ?? 'fixed';
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  console.log(JSON.stringify({ status: 'blocked', reason: 'Matching Playwright Chromium could not launch' }));
  process.exitCode = 2;
}
if (browser) {
  try {
    const result = await runSyntheticCase({ mode, method: 'helper', browser });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = revocationExitCode(result);
  } finally { await browser.close(); }
}

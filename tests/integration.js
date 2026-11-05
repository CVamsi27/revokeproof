import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { runSyntheticCase } from '../examples/synthetic.js';

let browser;
try { browser = await chromium.launch({ headless: true }); }
catch {
  console.log(JSON.stringify({ gate: 'revokeproof-real-browser', status: 'blocked', reason: 'Playwright Chromium could not launch; install the matching browser with npx playwright install chromium' }));
  process.exitCode = 2;
}
if (browser) {
  try {
    for (const [mode, expected] of [['broken', 'failed'], ['fixed', 'passed'], ['dead-source', 'incomplete']]) {
      for (const method of ['helper', 'baseline']) {
        const result = await runSyntheticCase({ mode, method, browser });
        assert.equal(result.status, expected, `${method}/${mode}`);
        assert.equal(result.cleanup, 'completed', `${method}/${mode} cleanup`);
        if (mode !== 'dead-source') {
          assert.equal(result.http.after.subject, 403, `${method}/${mode} fresh HTTP revoked`);
          assert.equal(result.canaries.after.control, true, `${method}/${mode} control source alive`);
        }
        if (mode === 'broken') assert.equal(result.canaries.after.subject, true);
        console.log(JSON.stringify({ gate: 'revokeproof-real-browser', method, mode, status: result.status, durationMs: result.durationMs }));
      }
    }
  } finally { await browser.close(); }
}

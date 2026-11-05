import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { runSyntheticCase } from './synthetic.js';

const repetitions = Number(process.env.REVOKEPROOF_MEASURE_REPEAT ?? '2');
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20) throw new TypeError('REVOKEPROOF_MEASURE_REPEAT must be 1..20');
const launchStart = performance.now();
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch {
  console.log(JSON.stringify({ schemaVersion: 1, project: 'revokeproof', status: 'blocked', reason: 'Matching Playwright Chromium could not launch', adoption: 'unvalidated' }));
  process.exitCode = 2;
}
if (browser) {
  const report = {
    schemaVersion: 1, project: 'revokeproof', status: 'completed', measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch, playwright: createRequire(import.meta.url)('@playwright/test/package.json').version, browser: browser.version() },
    browserLaunchMs: Math.round((performance.now() - launchStart) * 100) / 100,
    policy: { deadlineMs: 20, observationMs: 100, operationTimeoutMs: 3000 },
    scope: 'Synthetic loopback HTTP and two original Chromium WebSockets; fresh app and contexts for every case; warm installed browser; browser download excluded',
    repetitions, developerSetupTimeMs: null, adoption: 'unvalidated', samples: [],
  };
  try {
    for (let iteration = 0; iteration < repetitions; iteration++) {
      for (const [mode, expected] of [['broken', 'failed'], ['fixed', 'passed'], ['dead-source', 'incomplete']]) {
        // Alternate execution order so the helper is not always charged the first warm-up.
        for (const method of iteration % 2 ? ['baseline', 'helper'] : ['helper', 'baseline']) {
          const started = performance.now();
          const result = await runSyntheticCase({ mode, method, browser });
          report.samples.push({ iteration: iteration + 1, mode, method, expected, observed: result.status, matchesExpected: result.status === expected && result.cleanup === 'completed', wallMs: Math.round((performance.now() - started) * 100) / 100, observationAndCleanupMs: result.durationMs });
        }
      }
    }
  } finally { await browser.close(); }
  if (report.samples.some(sample => !sample.matchesExpected)) { report.status = 'failed'; process.exitCode = 1; }
  console.log(JSON.stringify(report, null, 2));
}

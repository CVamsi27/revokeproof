import { test, expect } from '@playwright/test';
import { runSyntheticCase } from './synthetic.js';

test('revoking access stops the original connection within the declared policy', async ({ browser }, testInfo) => {
  const result = await runSyntheticCase({ browser, mode: process.env.REVOKEPROOF_SYNTHETIC_MODE ?? 'fixed' });
  await testInfo.attach('revocation-evidence', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.status, JSON.stringify({ violations: result.violations, missing: result.missing })).toBe('passed');
});

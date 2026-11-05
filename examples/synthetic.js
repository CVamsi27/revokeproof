import { rehearseRevocation, playwrightWebSocketCapability } from '@developer-pain-lab/revokeproof';
import { startSyntheticFixture } from './fixture.js';
import { plainPlaywrightBaseline } from './baseline.js';

/** A browser and two original sockets. Each run gets fresh contexts and a fresh synthetic server. */
export async function runSyntheticCase({ mode = 'fixed', method = 'helper', browser, deadlineMs = 20, observationMs = 100 }) {
  if (!['helper', 'baseline'].includes(method)) throw new TypeError('Unsupported comparison method');
  const fixture = await startSyntheticFixture(mode);
  const contexts = [];
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    const results = await Promise.allSettled([...contexts.map(context => context.close()), fixture.close()]);
    if (results.some(result => result.status === 'rejected')) throw new Error('Synthetic cleanup failed');
  };
  try {
    const pages = {};
    const sockets = {};
    for (const who of ['subject', 'control']) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage();
      page.setDefaultTimeout(3_000);
      const socket = page.waitForEvent('websocket');
      await page.goto(`${fixture.url}/${who}`);
      sockets[who] = await socket;
      await page.evaluate(() => window.syntheticReady);
      pages[who] = page;
    }
    const revoke = async () => await fixture.post('/revoke') === 204;
    const emit = async id => await fixture.post('/emit', { id }) === 202;
    if (method === 'baseline') return await plainPlaywrightBaseline({ ...pages, revoke, emit, cleanup, deadlineMs, observationMs });
    return await rehearseRevocation({
      acquire: async () => Object.fromEntries(['subject', 'control'].map(who => [who, playwrightWebSocketCapability({
        socket: sockets[who],
        readHttp: async () => pages[who].evaluate(async () => (await fetch('/access', { cache: 'no-store' })).status),
        eventId: payload => JSON.parse(String(payload)).id,
      })])),
      revoke, emit, cleanup, deadlineMs, observationMs, operationTimeoutMs: 3_000,
    });
  } finally { await cleanup(); }
}

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/** Hand-written, plain Playwright baseline with the same observation windows and controls. */
export async function plainPlaywrightBaseline({ subject, control, revoke, emit, cleanup, deadlineMs, observationMs }) {
  const started = performance.now();
  const report = {
    status: 'incomplete', cleanup: 'completed',
    http: { before: null, after: null },
    canaries: { before: { subject: false, control: false }, after: { subject: false, control: false } },
    missing: [], violations: [],
  };
  const read = page => page.evaluate(async () => (await fetch('/access', { cache: 'no-store' })).status);
  const seen = (page, id) => page.evaluate(eventId => window.syntheticEvents.includes(eventId), id);
  try {
    report.http.before = { subject: await read(subject), control: await read(control) };
    if (report.http.before.subject !== 200 || report.http.before.control !== 200) {
      report.missing.push('Baseline HTTP access was not established');
    } else {
      const before = randomUUID();
      if (await emit(before) !== true) throw new Error('Canary not acknowledged');
      await sleep(observationMs);
      report.canaries.before = { subject: await seen(subject, before), control: await seen(control, before) };
      if (!report.canaries.before.subject || !report.canaries.before.control) {
        report.missing.push('Both original sockets must receive the baseline event');
      } else {
        if (await revoke() !== true) throw new Error('Revocation not acknowledged');
        await sleep(deadlineMs);
        report.http.after = { subject: await read(subject), control: await read(control) };
        if (report.http.after.subject >= 200 && report.http.after.subject < 300) report.violations.push('fresh-http-still-allowed');
        else if (![401, 403].includes(report.http.after.subject)) report.missing.push('Subject response did not prove denial');
        if (report.http.after.control !== 200) report.missing.push('Control HTTP became unavailable');
        const after = randomUUID();
        if (await emit(after) !== true) throw new Error('Canary not acknowledged');
        await sleep(observationMs);
        report.canaries.after = { subject: await seen(subject, after), control: await seen(control, after) };
        if (report.canaries.after.subject) report.violations.push('retained-capability-received-event');
        if (!report.canaries.after.control) report.missing.push('Post-revocation control source is silent');
      }
    }
  } catch { report.missing.push('Baseline operation failed; exception details intentionally excluded'); }
  finally {
    try { await cleanup(); }
    catch { report.cleanup = 'failed'; }
  }
  report.status = report.cleanup === 'failed' ? 'error' : report.violations.length ? 'failed' : report.missing.length ? 'incomplete' : 'passed';
  report.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return report;
}

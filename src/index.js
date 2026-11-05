import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

class PhaseTimeout extends Error {}
class ObservationMissing extends Error {}

function validate(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Expected rehearsal options');
  for (const name of ['acquire', 'revoke', 'emit', 'cleanup']) {
    if (typeof options[name] !== 'function') throw new TypeError(`${name} must be a function`);
  }
  for (const [name, maximum] of [['deadlineMs', 60_000], ['observationMs', 10_000], ['operationTimeoutMs', 60_000]]) {
    const value = options[name];
    const minimum = name === 'deadlineMs' ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
  }
}

async function bounded(callback, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => callback(controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PhaseTimeout()); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function allowed(status) { return Number.isInteger(status) && status >= 200 && status < 300; }
function denied(status) { return status === 401 || status === 403; }
function checkedStatus(status) {
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new ObservationMissing();
  return status;
}

/**
 * Observe exactly the acquired subject/control capabilities across an acknowledged revoke.
 * Callbacks own application setup and must respect their AbortSignal. No application state,
 * credentials, event payloads, URLs, or callback exception text is copied into the report.
 */
export async function rehearseRevocation(input) {
  const options = { observationMs: 250, operationTimeoutMs: 5_000, ...input };
  validate(options);
  const started = performance.now();
  const report = {
    schemaVersion: 1,
    status: 'incomplete', execution: 'completed', observations: 'incomplete', assertions: 'not_evaluated', cleanup: 'completed',
    policy: { deadlineMs: options.deadlineMs, observationMs: options.observationMs, operationTimeoutMs: options.operationTimeoutMs },
    http: { before: null, after: null },
    canaries: { before: { subject: false, control: false }, after: { subject: false, control: false } },
    violations: [], missing: [], timeline: [],
  };
  const eventIds = { before: randomUUID(), after: randomUUID() };
  report.canaryIds = { ...eventIds };
  const unsubscribers = [];
  let phase = 'acquire';
  let activeWindow = null;
  const note = kind => report.timeline.push({ kind, elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
  const missing = reason => { if (!report.missing.includes(reason)) report.missing.push(reason); };
  const run = callback => bounded(callback, options.operationTimeoutMs);
  const receive = owner => id => {
    for (const name of ['before', 'after']) {
      if (activeWindow === name && id === eventIds[name] && !report.canaries[name][owner]) {
        report.canaries[name][owner] = true;
        note(`${name}-canary-${owner}-received`);
      }
    }
  };

  try {
    const capabilities = await run(options.acquire);
    note('capabilities-acquired');
    if (!capabilities || capabilities.subject === capabilities.control) throw new ObservationMissing();
    for (const owner of ['subject', 'control']) {
      const capability = capabilities[owner];
      if (!capability || typeof capability.subscribe !== 'function' || typeof capability.readHttp !== 'function') throw new ObservationMissing();
      const unsubscribe = await run(signal => capability.subscribe(receive(owner), signal));
      if (typeof unsubscribe !== 'function') throw new ObservationMissing();
      unsubscribers.push(unsubscribe);
    }
    phase = 'baseline-http';
    report.http.before = {
      subject: checkedStatus(await run(signal => capabilities.subject.readHttp(signal))),
      control: checkedStatus(await run(signal => capabilities.control.readHttp(signal))),
    };
    if (!allowed(report.http.before.subject) || !allowed(report.http.before.control)) {
      missing('Both identities must prove HTTP access before revocation');
      throw new ObservationMissing();
    }
    phase = 'baseline-event';
    activeWindow = 'before';
    if (await run(signal => options.emit(eventIds.before, signal)) !== true) throw new ObservationMissing();
    await sleep(options.observationMs);
    activeWindow = null;
    note('baseline-window-observed');
    if (!report.canaries.before.subject || !report.canaries.before.control) {
      missing('Both original capabilities must receive the unique baseline event');
      throw new ObservationMissing();
    }
    phase = 'revoke';
    if (await run(options.revoke) !== true) {
      missing('Revocation acknowledgement was not confirmed');
      throw new ObservationMissing();
    }
    note('revocation-acknowledged');
    await sleep(options.deadlineMs);
    note('declared-revocation-deadline-reached');
    phase = 'after-http';
    report.http.after = { subject: null, control: null };
    report.http.after.subject = checkedStatus(await run(signal => capabilities.subject.readHttp(signal)));
    if (allowed(report.http.after.subject)) report.violations.push('fresh-http-still-allowed');
    else if (!denied(report.http.after.subject)) missing('Subject HTTP response did not establish a supported denial (401 or 403)');
    report.http.after.control = checkedStatus(await run(signal => capabilities.control.readHttp(signal)));
    if (!allowed(report.http.after.control)) missing('Unaffected control lost HTTP access');
    phase = 'after-event';
    activeWindow = 'after';
    // The post-deadline ID is never emitted before the acknowledged boundary and grace period.
    if (await run(signal => options.emit(eventIds.after, signal)) !== true) throw new ObservationMissing();
    await sleep(options.observationMs);
    activeWindow = null;
    note('post-deadline-window-observed');
    if (report.canaries.after.subject) report.violations.push('retained-capability-received-event');
    if (!report.canaries.after.control) missing('Unaffected control did not receive the unique post-deadline event');
    if (!report.missing.length) report.observations = 'complete';
  } catch (error) {
    if (error instanceof PhaseTimeout) {
      report.execution = 'timed_out';
      missing(`Operation timed out during ${phase}`);
    } else if (error instanceof ObservationMissing) {
      missing(`Required observation was not established during ${phase}`);
    } else {
      report.execution = 'interrupted';
      missing(`Adapter failed during ${phase}; exception details intentionally excluded`);
    }
  } finally {
    activeWindow = null;
    if (report.canaries.after.subject && !report.violations.includes('retained-capability-received-event')) {
      report.violations.push('retained-capability-received-event');
    }
    for (const unsubscribe of unsubscribers.reverse()) {
      try { await run(unsubscribe); }
      catch { report.cleanup = 'failed'; missing('A capability subscription failed to close'); }
    }
    try { await run(options.cleanup); }
    catch { report.cleanup = 'failed'; missing('Application-owned cleanup failed or timed out'); }
    note('cleanup-observed');
  }
  report.assertions = report.violations.length ? 'failed' : report.observations === 'complete' ? 'passed' : 'not_evaluated';
  report.status = report.cleanup === 'failed' || report.execution === 'interrupted' ? 'error'
    : report.assertions === 'failed' ? 'failed'
    : report.execution === 'completed' && report.observations === 'complete' && report.assertions === 'passed' ? 'passed'
    : 'incomplete';
  report.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return report;
}

/** 0 observed pass; 1 observed violation; 2 adapter/cleanup error; 3 incomplete or timed out. */
export function revocationExitCode(report) {
  if (!report || report.cleanup !== 'completed' || report.execution === 'interrupted') return 2;
  if (report.assertions === 'failed') return 1;
  if (report.execution === 'completed' && report.observations === 'complete' && report.assertions === 'passed' && report.status === 'passed') return 0;
  return 3;
}

/** Adapt the original Playwright WebSocket, never a URL or a reconnection factory. */
export function playwrightWebSocketCapability({ socket, readHttp, eventId } = {}) {
  if (!socket || typeof socket.on !== 'function' || typeof socket.off !== 'function'
      || typeof readHttp !== 'function' || typeof eventId !== 'function') {
    throw new TypeError('Expected an original Playwright socket, readHttp, and eventId mapping');
  }
  return {
    readHttp,
    async subscribe(listener) {
      const receive = event => {
        try {
          const id = eventId(event.payload);
          if (typeof id === 'string') listener(id);
        } catch { /* An unrecognized frame cannot establish a canary observation. */ }
      };
      socket.on('framereceived', receive);
      return async () => { socket.off('framereceived', receive); };
    },
  };
}

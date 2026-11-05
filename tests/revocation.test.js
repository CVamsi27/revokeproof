import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rehearseRevocation, revocationExitCode } from '../src/index.js';

function harness({ broken = false, silent = false, silentAfter = false, httpAfter = 403, cleanupFails = false, revokeHangs = false, delaySubject = 0, wrongEvent = false, leakOnUnsubscribe = false } = {}) {
  const subject = new EventEmitter();
  const control = new EventEmitter();
  const state = { revoked: false, acquired: 0, subscriptions: 0, cleanup: 0, emitted: [] };
  const timers = [];
  const capability = (events, isSubject) => ({
    readHttp: async () => isSubject && state.revoked ? httpAfter : 200,
    subscribe: async listener => { state.subscriptions++; events.on('event', listener); return async () => { if (leakOnUnsubscribe && isSubject && state.revoked) { await new Promise(resolve => setTimeout(resolve, 2)); events.emit('event', state.emitted.at(-1)); } events.off('event', listener); }; },
  });
  return {
    state,
    options: {
      deadlineMs: 1, observationMs: 15, operationTimeoutMs: 100,
      acquire: async () => { state.acquired++; return { subject: capability(subject, true), control: capability(control, false) }; },
      revoke: async () => { if (revokeHangs) return new Promise(() => {}); state.revoked = true; return true; },
      emit: async id => {
        state.emitted.push(id);
        if (silent || (silentAfter && state.revoked)) return true;
        const event = wrongEvent ? 'unrelated-event' : id;
        control.emit('event', event);
        if (!state.revoked || broken) {
          if (state.revoked && delaySubject) timers.push(setTimeout(() => subject.emit('event', event), delaySubject));
          else subject.emit('event', event);
        }
        return true;
      },
      cleanup: async () => { state.cleanup++; for (const timer of timers) clearTimeout(timer); if (cleanupFails) throw new Error('credential=do-not-serialize'); },
    },
  };
}

test('a repaired capability passes only with baseline proof and a live post-revoke control', async () => {
  const h = harness();
  const result = await rehearseRevocation(h.options);
  assert.equal(result.status, 'passed');
  assert.equal(result.assertions, 'passed');
  assert.equal(result.observations, 'complete');
  assert.equal(result.cleanup, 'completed');
  assert.equal(revocationExitCode(result), 0);
  assert.deepEqual(result.http, { before: { subject: 200, control: 200 }, after: { subject: 403, control: 200 } });
  assert.equal(h.state.acquired, 1);
  assert.equal(h.state.subscriptions, 2);
  assert.equal(h.state.cleanup, 1);
  assert.equal(h.state.emitted.length, 2);
  assert.notEqual(h.state.emitted[0], h.state.emitted[1]);
  assert.deepEqual(result.canaries.after, { subject: false, control: true });
});

test('the original socket receiving a post-deadline event is a failed assertion', async () => {
  const h = harness({ broken: true });
  const result = await rehearseRevocation(h.options);
  assert.equal(result.status, 'failed');
  assert.equal(result.assertions, 'failed');
  assert.ok(result.violations.includes('retained-capability-received-event'));
  assert.equal(revocationExitCode(result), 1);
});

test('an event source that never worked cannot establish revocation', async () => {
  const h = harness({ silent: true });
  const result = await rehearseRevocation(h.options);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.assertions, 'not_evaluated');
  assert.equal(h.state.revoked, false);
  assert.equal(revocationExitCode(result), 3);
});

test('a source dying after baseline cannot become a passing revocation test', async () => {
  const result = await rehearseRevocation(harness({ silentAfter: true }).options);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.observations, 'incomplete');
  assert.equal(result.canaries.after.control, false);
});

test('fresh HTTP access after revocation is a violation even when the socket is blocked', async () => {
  const result = await rehearseRevocation(harness({ httpAfter: 200 }).options);
  assert.equal(result.assertions, 'failed');
  assert.ok(result.violations.includes('fresh-http-still-allowed'));
});

test('a server error is unavailable evidence rather than proof of denied access', async () => {
  const result = await rehearseRevocation(harness({ httpAfter: 500 }).options);
  assert.equal(result.assertions, 'not_evaluated');
  assert.equal(result.status, 'incomplete');
});

test('cleanup failures prevent passing and never serialize callback exception secrets', async () => {
  const result = await rehearseRevocation(harness({ cleanupFails: true }).options);
  assert.equal(result.cleanup, 'failed');
  assert.equal(result.status, 'error');
  assert.equal(revocationExitCode(result), 2);
  assert.doesNotMatch(JSON.stringify(result), /do-not-serialize/);
});

test('a hung revoke callback times out and still runs cleanup', async () => {
  const h = harness({ revokeHangs: true });
  const result = await rehearseRevocation({ ...h.options, operationTimeoutMs: 25 });
  assert.equal(result.execution, 'timed_out');
  assert.notEqual(result.status, 'passed');
  assert.equal(h.state.cleanup, 1);
});

test('unrelated messages do not establish a live canary source', async () => {
  const result = await rehearseRevocation(harness({ wrongEvent: true }).options);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.canaries.before, { subject: false, control: false });
});

test('the entire declared observation window catches delayed retained delivery', async () => {
  const result = await rehearseRevocation(harness({ broken: true, delaySubject: 7 }).options);
  assert.equal(result.assertions, 'failed');
  assert.equal(result.canaries.after.subject, true);
});

test('invalid deadlines and missing cleanup are rejected before acquisition', async () => {
  const h = harness();
  await assert.rejects(rehearseRevocation({ ...h.options, deadlineMs: -1 }), TypeError);
  await assert.rejects(rehearseRevocation({ ...h.options, cleanup: undefined }), TypeError);
  assert.equal(h.state.acquired, 0);
});

test('a baseline HTTP denial prevents vacuous success', async () => {
  const h = harness();
  h.options.acquire = async () => ({
    subject: { readHttp: async () => 403, subscribe: async () => async () => {} },
    control: { readHttp: async () => 200, subscribe: async () => async () => {} },
  });
  const result = await rehearseRevocation(h.options);
  assert.equal(result.assertions, 'not_evaluated');
  assert.equal(result.status, 'incomplete');
});


test('events during asynchronous cleanup cannot mutate a closed observation window', async () => {
  const result = await rehearseRevocation(harness({ leakOnUnsubscribe: true }).options);
  assert.equal(result.status, 'passed');
  assert.equal(result.canaries.after.subject, false);
  assert.equal(result.assertions, 'passed');
});

test('a zero grace deadline checks immediately after acknowledged revocation', async () => {
  const result = await rehearseRevocation({ ...harness().options, deadlineMs: 0 });
  assert.equal(result.status, 'passed');
});

test('a delivered forbidden canary remains a finding when emit later throws', async () => {
  const h = harness({ broken: true });
  const emit = h.options.emit;
  h.options.emit = async id => { const accepted = await emit(id); if (h.state.revoked) throw new Error('late adapter error'); return accepted; };
  const result = await rehearseRevocation(h.options);
  assert.equal(result.assertions, 'failed');
  assert.ok(result.violations.includes('retained-capability-received-event'));
});

test('an allowed subject HTTP response remains a finding when the control probe fails', async () => {
  const h = harness({ httpAfter: 200 });
  const acquire = h.options.acquire;
  h.options.acquire = async () => {
    const caps = await acquire();
    const readControl = caps.control.readHttp;
    caps.control.readHttp = async () => { if (h.state.revoked) throw new Error('control unavailable'); return readControl(); };
    return caps;
  };
  const result = await rehearseRevocation(h.options);
  assert.equal(result.assertions, 'failed');
  assert.ok(result.violations.includes('fresh-http-still-allowed'));
  assert.equal(result.http.after.subject, 200);
});

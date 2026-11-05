import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { playwrightWebSocketCapability } from '../src/index.js';

test('the adapter observes only event IDs on the exact supplied socket and detaches cleanly', async () => {
  const socket = new EventEmitter();
  const unrelated = new EventEmitter();
  const observed = [];
  const capability = playwrightWebSocketCapability({ socket, readHttp: async () => 200, eventId: payload => JSON.parse(payload).id });
  const unsubscribe = await capability.subscribe(id => observed.push(id), new AbortController().signal);
  unrelated.emit('framereceived', { payload: '{"id":"other"}' });
  socket.emit('framereceived', { payload: '{"id":"canary-1","credential":"never-report-this"}' });
  socket.emit('framereceived', { payload: 'malformed' });
  assert.deepEqual(observed, ['canary-1']);
  await unsubscribe();
  socket.emit('framereceived', { payload: '{"id":"canary-2"}' });
  assert.deepEqual(observed, ['canary-1']);
});

test('the adapter passes the operation abort signal into the application HTTP probe', async () => {
  const controller = new AbortController();
  let received;
  const capability = playwrightWebSocketCapability({ socket: new EventEmitter(), readHttp: async signal => { received = signal; return 403; }, eventId: () => undefined });
  assert.equal(await capability.readHttp(controller.signal), 403);
  assert.equal(received, controller.signal);
});

test('the adapter refuses an absent socket or event mapping', () => {
  assert.throws(() => playwrightWebSocketCapability({ socket: null, readHttp: async () => 200, eventId: () => '' }), TypeError);
  assert.throws(() => playwrightWebSocketCapability({ socket: new EventEmitter(), readHttp: async () => 200 }), TypeError);
});

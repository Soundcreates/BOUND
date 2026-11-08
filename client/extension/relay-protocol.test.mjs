import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./relay.js', import.meta.url), 'utf8');
const channel = '01234567-0123-0123-0123-0123456789ab';
const binding = { id: '1:01234567-0123-0123-0123-0123456789ab', digest: 'a'.repeat(64), stateDigest: 'b'.repeat(64) };
const token = 'c'.repeat(32);
function fixture() {
  const sent = [], posted = [], timers = [];
  let listener, command, resolve, reject, onPost;
  const pending = new Promise((a,b) => { resolve = a; reject = b; });
  const window = { dispatchEvent() {}, addEventListener(type, fn) { listener = fn; }, postMessage(message) { posted.push(message); onPost?.(message); } };
  const runtime = { id: 'extension', onMessage: { addListener(fn) { command = fn; } }, sendMessage(message) { sent.push(message); return message.type === 'BOUND_REQUEST_V1' ? pending : Promise.resolve(); } };
  class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts.detail; } }
  vm.runInNewContext(source, { window, chrome: { runtime }, crypto: { randomUUID: () => channel }, location: { origin: 'https://example.com' }, CustomEvent, TextEncoder, setTimeout: (fn, ms) => timers.push({ fn, ms }), Promise, Map, Object });
  const emit = (data, options = {}) => listener({ source: options.source ?? window, origin: options.origin ?? 'https://example.com', data, stopImmediatePropagation() {} });
  const request = () => emit({ type: 'BOUND_REQUEST_V1', ...binding, request: { method: 'eth_sendTransaction' }, state: null });
  return { sent, posted, timers, emit, request, command, resolve, reject, onPost: fn => { onPost = fn; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('safe messages require exact shape and origin, no channel', () => {
  const f = fixture();
  for (const type of ['BOUND_SAFE_READY_V1', 'BOUND_SAFE_CONFIRM_V1']) {
    f.emit({ type, ticket: token });
    f.emit({ type, ticket: token, channel });
    f.emit({ type, ticket: 'bad' });
    f.emit({ type, ticket: token }, { origin: 'https://other.example' });
    f.emit({ type, ticket: token }, { source: {} });
  }
  assert.deepEqual(f.sent.map(m => m.type), ['BOUND_SAFE_READY_V1', 'BOUND_SAFE_CONFIRM_V1']);
  assert.ok(f.sent.every(m => !('channel' in m)));
});

test('cancellation waiter exists before post and accepts only one matching ack', async () => {
  const f = fixture(); f.request();
  const ack = { type: 'BOUND_CANCEL_DELIVERED_V1', channel, ...binding, ticket: token, cancelNonce: token };
  f.emit(ack);
  f.onPost(m => { if (m.safePage) { for (const patch of [{ id: 'wrong' }, { digest: undefined }, { stateDigest: undefined }, { ticket: 'd'.repeat(32) }, { cancelNonce: undefined }, { channel: 'wrong' }]) f.emit({ ...ack, ...patch }); f.emit(ack); f.emit(ack); } });
  f.resolve({ action: 'cancel', ...binding, safePage: true, ticket: token, cancelNonce: token }); await flush();
  const acks = f.sent.filter(m => m.type === 'BOUND_CANCEL_DELIVERED_V1');
  assert.equal(acks.length, 1); assert.equal('channel' in acks[0], false);
});

test('guard requires worker sender and exact command, acknowledgement is separate and correlated', async () => {
  const f = fixture(); f.request();
  const command = { type: 'BOUND_RETRY_GUARD_V1', ...binding, nonce: token };
  const ack = { ...command, type: 'BOUND_RETRY_GUARDED_V1', channel };
  f.emit(ack);
  f.command(command, { id: 'other' });
  f.command({ ...command, nonce: undefined }, { id: 'extension' });
  f.command({ ...command, id: '2:01234567-0123-0123-0123-0123456789ab' }, { id: 'extension' });
  assert.equal(f.posted.length, 0);
  f.command(command, { id: 'extension' });
  assert.equal(f.posted.length, 1);
  for (const patch of [{ nonce: undefined }, { digest: undefined }, { stateDigest: undefined }, { id: 'bad' }, { channel: 'bad' }]) f.emit({ ...ack, ...patch });
  f.emit(ack); f.emit(ack);
  assert.equal(f.sent.filter(m => m.type === 'BOUND_RETRY_GUARDED_V1').length, 1);
  assert.equal('channel' in f.sent.at(-1), false);
  f.resolve({ action: 'continue', ...binding, typedApproved: true }); await flush();
  assert.equal(f.posted.at(-1).typedApproved, true);
});

test('worker disconnect produces cancel decision', async () => {
  const f = fixture(); f.request(); f.reject(new Error('disconnected')); await flush();
  assert.equal(f.posted.at(-1).action, 'cancel');
});

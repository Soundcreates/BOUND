import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('./hook.js', import.meta.url), 'utf8');
const channel = '01234567-0123-0123-0123-0123456789ab';
const token = 'a'.repeat(32);
async function fixture(method = 'eth_sendTransaction') {
  const listeners = {}, posted = [], timers = [], forwarded = [];
  class Event { constructor(type) { this.type = type; } stopImmediatePropagation() {} }
  const window = { addEventListener(type, fn) { (listeners[type] ??= []).push(fn); }, dispatchEvent(event) { for (const fn of listeners[event.type] ?? []) fn(event); }, postMessage(data) { posted.push(data); }, setTimeout(fn, ms) { const t = { fn, ms }; timers.push(t); return t; }, clearTimeout(t) { t.cleared = true; } };
  window.ethereum = { request: async p => p.method === 'eth_chainId' ? '0x1' : p.method === 'eth_accounts' ? [] : (forwarded.push(p), 'wallet') };
  const context = vm.createContext({ window, Event, location: { origin: 'https://example.com' }, crypto: webcrypto, TextEncoder, Uint8Array, setTimeout, console });
  vm.runInContext(source, context);
  window.dispatchEvent({ type: 'BOUND_INIT_V1', target: window, detail: channel });
  const result = window.ethereum.request(vm.runInContext(method === 'wallet_requestPermissions' ? "({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]})" : "({ method: 'eth_sendTransaction', params: [{ value: '0x1' }] })", context));
  result.catch(() => {});
  for (let i = 0; i < 200 && !posted.some(p => p.type === 'BOUND_REQUEST_V1'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  const req = posted.find(p => p.type === 'BOUND_REQUEST_V1');
  assert.ok(req);
  const dispatch = data => window.dispatchEvent({ type: 'message', source: window, origin: 'https://example.com', data, stopImmediatePropagation() {} });
  const binding = { id: req.id, digest: req.digest, stateDigest: req.stateDigest };
  return { posted, timers, forwarded, result, dispatch, binding };
}
const decision = b => ({ type: 'BOUND_DECISION_V1', channel, ...b, action: 'cancel', safePage: true, ticket: token, cancelNonce: token });

test('safe cancellation validates binding and rejects before a single acknowledgement', async () => {
  const f = await fixture();
  for (const change of [{ id: 'wrong' }, { digest: 'b'.repeat(64) }, { stateDigest: undefined }, { channel: 'bad' }, { ticket: 'bad' }, { cancelNonce: undefined }]) f.dispatch({ ...decision(f.binding), ...change });
  assert.equal(f.posted.filter(m => m.type === 'BOUND_CANCEL_DELIVERED_V1').length, 0);
  f.dispatch(decision(f.binding));
  await assert.rejects(f.result, { code: 4001 });
  f.dispatch(decision(f.binding));
  assert.equal(f.posted.filter(m => m.type === 'BOUND_CANCEL_DELIVERED_V1').length, 1);
  assert.equal(f.forwarded.length, 0);
  assert.ok(f.timers.find(t => t.ms === 660000).cleared);
});

test('guard requires exact binding and typed approval; timeout rejects', async () => {
  for (const mode of ['plain', 'timeout', 'cancel', 'typed']) {
    const f = await fixture();
    const guard = { type: 'BOUND_RETRY_GUARD_V1', channel, ...f.binding, nonce: token };
    f.dispatch({ ...guard, stateDigest: undefined });
    assert.equal(f.posted.filter(m => m.type === 'BOUND_RETRY_GUARDED_V1').length, 0);
    f.dispatch(guard); f.dispatch(guard);
    assert.equal(f.posted.filter(m => m.type === 'BOUND_RETRY_GUARDED_V1').length, 1);
    if (mode === 'timeout') f.timers.find(t => t.ms === 660000).fn();
    else f.dispatch({ type: 'BOUND_DECISION_V1', channel, ...f.binding, action: mode === 'cancel' ? 'cancel' : 'continue', typedApproved: mode === 'typed', readOnly: true });
    if (mode === 'typed') { assert.equal(await f.result, 'wallet'); assert.equal(f.forwarded.length, 1); }
    else { await assert.rejects(f.result, { code: 4001 }); assert.equal(f.forwarded.length, 0); }
  }
});

test('ordinary timeout retains fail-open behavior', async () => {
  const f = await fixture(); f.timers.find(t => t.ms === 660000).fn();
  assert.equal(await f.result, 'wallet'); assert.equal(f.forwarded.length, 1);
});

test('opaque sandbox frames do not install an unusable message channel', () => {
  const request = () => Promise.resolve([]);
  const provider = { request };
  const window = { ethereum: provider };
  vm.runInNewContext(source, {window, location: {origin:'null'}});
  assert.equal(provider.request, request);
});

test('a continued permission request forwards once even if its decision is repeated', async () => {
  const f = await fixture('wallet_requestPermissions');
  const message = {type:'BOUND_DECISION_V1',channel,...f.binding,action:'continue',readOnly:true};
  f.dispatch(message); f.dispatch(message);
  assert.equal(await f.result, 'wallet');
  assert.equal(f.forwarded.length, 1);
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFrontendContext } from './decision-context.mjs';

test('frontend context fails closed when adapter is unavailable', async () => {
  const result = await readFrontendContext({siteOrigin:'https://example.com',chainId:"1",watcherOwner:'0x'+'1'.repeat(40),adapters:{},now:0});
  assert.equal(result.state, 'unavailable');
});

test('frontend context bounds a stalled adapter', async (t) => {
  const original = setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => original(fn, Math.min(ms, 5), ...args));
  const result = await readFrontendContext({siteOrigin:'https://example.com',chainId:"1",watcherOwner:'0x'+'1'.repeat(40),adapters:{readFrontendCommunity: () => new Promise(() => {})},now:0});
  assert.equal(result.state, 'unavailable');
});

test('decision context includes frontend community on every return path', async () => {
  const { createDecisionContext } = await import('./decision-context.mjs');
  const now = Date.parse('2026-11-08T12:00:00Z');
  const owner = '0x'+'1'.repeat(40);
  const community = {state:'fresh'};
  const verified = { snapshot: {schemaVersion:1,epoch:1,generatedAt:'2026-11-08T10:00:00Z',expiresAt:'2026-11-09T10:00:00Z',network:'sepolia',sharedContracts:{},sites:{'example.com':{'1':{trustedCounterparties:[],trustedContracts:[],deployers:[],source:'test'}}}},root:{epoch:1} };
  const base = {siteOrigin:'https://example.com',chainId:"1",watcherOwner:owner,now};
  const frontend = async () => community;
  const cases = [
    {...base, siteOrigin:'invalid', adapters:{readFrontendCommunity:frontend}},
    {...base, adapters:{readFrontendCommunity:frontend,readVerifiedSnapshot:async()=>null}},
    {...base, siteOrigin:'https://other.example', adapters:{readFrontendCommunity:frontend,readVerifiedSnapshot:async()=>verified}},
    {...base, adapters:{readFrontendCommunity:frontend,readVerifiedSnapshot:async()=>verified,readWatcherBundle:async()=>[]}}
  ];
  const results = await Promise.all(cases.map(createDecisionContext));
  assert.deepEqual(results.map(x=>x.status), ['invalid_context','snapshot_unavailable','watcher_baseline_unavailable','watcher_baseline_unavailable']);
  assert.equal(results[0].frontendCommunity.state, 'unavailable');
  for (const result of results.slice(1)) assert.equal(result.frontendCommunity, community);
  const completed = await createDecisionContext({...base, adapters:{readFrontendCommunity:frontend,readVerifiedSnapshot:async()=>verified,readWatcherBundle:async()=>[{owner,kind:'baseline',site:'example.com',chain:'1',expiresAt:'2026-11-09T00:00:00Z',witnessed:[]}]}});
  assert.equal(completed.frontendCommunity, community);
  assert.notEqual(completed.status, 'watcher_baseline_unavailable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function setup(version, provider) {
  const script = await readFile(new URL(`./${version}/app.js`, import.meta.url), 'utf8');
  const button = { disabled: false, addEventListener(_event, handler) { this.click = handler; } };
  const status = { textContent: '' };
  let destination;
  const window = { ethereum: provider, location: { origin: 'http://localhost:8082', assign(url) { destination = url; } } };
  vm.runInNewContext(script, { window, document: { querySelector: selector => selector === '#connect' ? button : status } });
  return { button, status, destination: () => destination };
}

test('normal demo requests a real wallet connection and does not navigate', async () => {
  const requests = [];
  const demo = await setup('a', { async request(request) { requests.push(request.method); return ['0x123']; } });
  await demo.button.click();
  assert.deepEqual(requests, ['eth_requestAccounts']);
  assert.match(demo.status.textContent, /Wallet connected/);
  assert.equal(demo.destination(), undefined);
});

test('risky demo navigates to Swarm without making a wallet request', async () => {
  let calls = 0;
  const demo = await setup('b', { request() { calls++; } });
  await demo.button.click();
  assert.equal(calls, 0);
  assert.match(demo.status.textContent, /Opening the safe page/);
  const target = new URL(demo.destination());
  assert.equal(target.origin, 'https://bzz.limo');
  const report = JSON.parse(decodeURIComponent(target.hash.slice('#presentation='.length)));
  assert.equal(report.origin, 'http://localhost:8082');
  assert.equal(report.score, 10);
  assert.ok(Number.isFinite(Date.parse(report.time)));
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { createNetworkPollAdapters } from './network.js';
const cert={fingerprint256:'AA:BB',issuer:{O:'Example CA',CN:'Issuer'},subjectaltname:'DNS:example.org, DNS:*.example.org'};
test('DoH and TLS adapters extract only validated DNS records and certificate facts', async () => {
  const calls=[];
  const fetchImpl=async url=>{calls.push(new URL(url));return {ok:true,json:async()=>({Status:0,Answer:[{type:1,data:'192.0.2.1'},{type:1,data:'192.0.2.2'}]})};};
  const connectImpl=()=>{ const socket=new EventEmitter(); socket.destroy=()=>{}; socket.getPeerCertificate=()=>cert; queueMicrotask(()=>socket.emit('secureConnect')); return socket; };
  const adapters=createNetworkPollAdapters({fetchImpl,connectImpl,lookupAsn:async()=>null});
  assert.deepEqual(await adapters.resolve('example.org','A'),['192.0.2.1','192.0.2.2']);
  assert.equal(calls[0].protocol,'https:');
  const result=await adapters.certificate('example.org',443);
  assert.equal(result.fingerprint,'AA:BB'); assert.deepEqual(result.names,['example.org','*.example.org']);
});
test('failed DNS and TLS reads are failures, never empty observations', async () => {
  const connectImpl=()=>{const socket=new EventEmitter();socket.destroy=()=>{};queueMicrotask(()=>socket.emit('error',Error('TLS failure')));return socket;};
  const adapters=createNetworkPollAdapters({fetchImpl:async()=>({ok:true,json:async()=>({Status:3})}),connectImpl,lookupAsn:async()=>null});
  await assert.rejects(adapters.resolve('example.org','A'),/DNS/);
  await assert.rejects(adapters.certificate('example.org',443),/TLS failure/);
});

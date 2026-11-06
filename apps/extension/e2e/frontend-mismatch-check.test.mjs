import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,runFrontendMismatchChecks} from './frontend-mismatch-check.mjs';
import {decodeSnapshotBytes} from '../../../packages/snapshot/src/digest.ts';

test('browser fixture uses valid independently digested curator data and never seeds frontend maturity',()=>{
 const time=Date.now(),site='127.0.0.1:8081';
 const frontend={schemaVersion:1,kind:'frontend',site,chainId:1,scripts:[],updatedAt:new Date(time).toISOString()};
 const data=browserFixture({site,time,frontend,state:'drift'});
 const cached=Object.entries(data.local).find(([key])=>key.startsWith('bound.trust.v2:'))[1];
 assert.equal(decodeSnapshotBytes(new TextEncoder().encode(cached.canonical)).digest,cached.root.digest);
 assert.deepEqual(data.local.boundWatcherBundle.records.find(r=>r.record.kind==='frontend').record.scripts,[]);
 assert.equal(data.local.boundSettings.watcherUrl,'','browser test does not send reports to a real watcher');
});
test('browser prerequisites fail before creating fixtures or launching a browser',async()=>{
 await assert.rejects(runFrontendMismatchChecks({extensionPath:'/tmp/extension'}),/launcher/);
});

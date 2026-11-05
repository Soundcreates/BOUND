import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openOutbox } from './outbox.js';
const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'rotating-key',event:'warned'};
async function pathFor(t) { const dir=await mkdtemp(join(tmpdir(),'bound-outbox-')); t.after(()=>rm(dir,{recursive:true,force:true})); return join(dir,'state.json'); }
test('outage queues data durably and restart replays a stable operation id', async t => {
  const path=await pathFor(t), calls=[];
  let box=await openOutbox({path,deliver:async (entry, id)=>{calls.push([entry,id]);throw Error('offline');}});
  await box.enqueue('event-1',record);
  await assert.rejects(box.flush(),/offline/);
  box=await openOutbox({path,deliver:async (entry,id)=>calls.push([entry,id])});
  await box.flush();
  assert.equal(calls.length,2); assert.equal(calls[0][1],calls[1][1]);
  assert.deepEqual(calls[1][0],record); assert.equal((await box.pending()).length,0);
});
test('same operation is idempotent, conflicting payload is rejected across restart', async t => {
  const path=await pathFor(t), calls=[];
  let box=await openOutbox({path,deliver:async(r,id)=>calls.push(id)});
  await box.enqueue('event-1',record); await box.flush();
  box=await openOutbox({path,deliver:async(r,id)=>calls.push(id)});
  await box.enqueue('event-1',record); await box.flush(); assert.equal(calls.length,1);
  await assert.rejects(box.enqueue('event-1',{...record,value:'0x'+'2'.repeat(40)}),/conflict/);
});
test('concurrent enqueue and corrupted state never silently discard data', async t => {
  const path=await pathFor(t), calls=[];
  const box=await openOutbox({path,deliver:async(r,id)=>calls.push(id)});
  await Promise.all([box.enqueue('event-1',record),box.enqueue('event-2',record)]);
  assert.equal((await readFile(path,'utf8')).includes('rotating-key'),true);
  await box.flush(); assert.deepEqual(calls,['event-1','event-2']);
  assert.equal((await readFile(path,'utf8')).includes('rotating-key'),false);
  await writeFile(path,'{bad'); await assert.rejects(openOutbox({path,deliver:async()=>{}}),/invalid/);
});
test('uncertain persistence fails closed until reopening', async t => {
  const dir=await mkdtemp(join(tmpdir(),'bound-outbox-fail-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'missing','state.json');
  const box=await openOutbox({path,deliver:async()=>{}});
  await assert.rejects(box.enqueue('event-1',record));
  await assert.rejects(box.pending(),/reopen required/);
});

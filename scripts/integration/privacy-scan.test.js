import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {scanPrivacy} from './privacy-scan.js';
const wallet='0x'+'ab'.repeat(20),counterparty='0x'+'cd'.repeat(20),digest='0x'+'12'.repeat(32);
test('finds text and binary canaries without returning their values',()=>{
 const result=scanPrivacy({artifacts:[{name:'arkiv',content:JSON.stringify({legitimateCounterparty:counterparty,leakedWallet:wallet.toUpperCase()})},{name:'swarm',content:Buffer.from(digest.slice(2),'hex')}],canaries:[{category:'wallet',value:wallet},{category:'request_digest',value:digest}],publicCounterparties:[counterparty]});
 assert.deepEqual(result.findings,[{artifact:'arkiv',category:'wallet'},{artifact:'swarm',category:'request_digest'}]);
 assert.equal(JSON.stringify(result).includes(wallet),false);assert.equal(JSON.stringify(result).includes(digest),false);
});
test('public counterparties are permitted and ambiguous or malformed scans fail',()=>{
 const result=scanPrivacy({artifacts:[{name:'report',content:counterparty}],canaries:[{category:'wallet',value:wallet}],publicCounterparties:[counterparty]});assert.deepEqual(result.findings,[]);
 assert.throws(()=>scanPrivacy({artifacts:[],canaries:[{category:'wallet',value:counterparty}],publicCounterparties:[counterparty]}),/conflicts/);
 assert.throws(()=>scanPrivacy({artifacts:[],canaries:[{category:'amount',value:'1'}]}),/canary/);
 assert.throws(()=>scanPrivacy({artifacts:[{name:'report',content:'x',extra:'secret'}],canaries:[{category:'wallet',value:wallet}]}),/artifact/);
});
test('privacy report reads synthetic artifacts and emits category only',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=await mkdtemp(join(tmpdir(),'bound-scan-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const artifact=join(dir,'artifact'),manifest=join(dir,'manifest.json');await writeFile(artifact,JSON.stringify({leak:wallet}));
 await writeFile(manifest,JSON.stringify({artifacts:[{name:'arkiv',path:artifact}],canaries:[{category:'wallet',value:wallet}],publicCounterparties:[counterparty]}));
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/integration/privacy-report.mjs',manifest]);
 assert.deepEqual(JSON.parse(stdout).findings,[{artifact:'arkiv',category:'wallet'}]);assert.equal(stdout.includes(wallet),false);
});

import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet} from 'ethers';
import {createConfig} from './config-example.mjs';

test('example config loads curated references and fails closed on incident recovery',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const oldFile=process.env.BOUND_WATCHER_CONFIG,oldKey=process.env.ARKIV_PRIVATE_KEY;
 t.after(()=>{if(oldFile===undefined)delete process.env.BOUND_WATCHER_CONFIG;else process.env.BOUND_WATCHER_CONFIG=oldFile;if(oldKey===undefined)delete process.env.ARKIV_PRIVATE_KEY;else process.env.ARKIV_PRIVATE_KEY=oldKey;});
 const key='0x'+'12'.repeat(32),wallet=new Wallet(key),file=join(dir,'config.json');
 const baseline={site:'example.org',chainId:1,sample:{nameservers:['ns1.example']}};
 await writeFile(file,JSON.stringify({arkiv:{url:'https://example.org',owner:wallet.address.toLowerCase(),target:'0x'+'34'.repeat(20),chainId:7794095},baselines:[baseline]}));
 process.env.BOUND_WATCHER_CONFIG=file;process.env.ARKIV_PRIVATE_KEY=key;
 const config=await createConfig();assert.deepEqual(await config.readBaseline('example.org',1),baseline.sample);assert.equal(await config.readBaseline('elsewhere.example',1),undefined);assert.equal(await config.canRecover('example.org',1),false);
 assert.equal(typeof config.arkiv.prepare,'function');
 await writeFile(file,JSON.stringify({arkiv:{url:'https://example.org',owner:wallet.address.toLowerCase(),target:'0x'+'34'.repeat(20),chainId:7794095},baselines:[baseline,baseline]}));
 await assert.rejects(createConfig(),/duplicate/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSafePage} from './build.mjs';
test('builds isolated remote and packaged artifacts with fixed endpoint and rejects unsafe inputs',async()=>{const dir=await mkdtemp(join(tmpdir(),'bound-safe-'));try{const result=await buildSafePage({outdir:join(dir,'remote'),packagedDir:join(dir,'packaged')});assert.match(await readFile(result.remote.html,'utf8'),/connect-src https:\/\/rpc\.rabdi/);assert.match(await readFile(result.packaged.html,'utf8'),/safe\.js/);for(const rpcUrl of ['http://example.com','https://user:pass@example.com','https://example.com/?key=x'])await assert.rejects(buildSafePage({rpcUrl}));await assert.rejects(buildSafePage({watchers:['0x'+'A'.repeat(40)]}));}finally{await rm(dir,{recursive:true,force:true});}});

import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireJournalLocks} from './journal-lock.js';

test('journal locks exclude another archive process and release only owned locks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-journal-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sender=join(dir,'sender.json'),registry=join(dir,'registry.json');
 const locks=await acquireJournalLocks([sender,registry]);
 await assert.rejects(acquireJournalLocks([registry,sender]),/already locked/);
 await locks.close();
 const reopened=await acquireJournalLocks([sender,registry]);
 await reopened.close();
 await assert.rejects(readFile(`${sender}.lock`),{code:'ENOENT'});
 await assert.rejects(readFile(`${registry}.lock`),{code:'ENOENT'});
});

test('partial acquisition rolls back earlier locks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-journal-lock-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sender=join(dir,'sender.json'),registry=join(dir,'registry.json');
 const held=await acquireJournalLocks([registry]);
 await assert.rejects(acquireJournalLocks([sender,registry]),/already locked/);
 await assert.rejects(readFile(`${sender}.lock`),{code:'ENOENT'});
 await held.close();
});

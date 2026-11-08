import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRecoveryApprovalPolicy} from './recovery-approval.js';
const site='example.org',incidentId='a'.repeat(64),approval={site,chainId:1,incidentId,expiresAt:100};
test('operator approval is scoped to a single unexpired incident',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'approvals');let clock=10;
 const policy=createRecoveryApprovalPolicy({path,now:()=>clock});assert.equal(await policy(site,1,{incidentId}),false);
 await writeFile(path,JSON.stringify({version:1,approvals:[approval]}));
 assert.equal(await policy(site,1,{incidentId}),true);assert.equal(await policy(site,1,{incidentId:'b'.repeat(64)}),false);
 assert.equal(await policy('other.example',1,{incidentId}),false);assert.equal(await policy(site,2,{incidentId}),false);
 clock=100;assert.equal(await policy(site,1,{incidentId}),false);
});
test('malformed or duplicate approvals fail closed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'approvals'),policy=createRecoveryApprovalPolicy({path,now:()=>0});
 await writeFile(path,JSON.stringify({version:1,approvals:[approval,approval]}));await assert.rejects(policy(site,1,{incidentId}),/approval file/);
 await writeFile(path,'{"version":1,"version":1,"approvals":[]}');await assert.rejects(policy(site,1,{incidentId}),/approval file/);
 await assert.rejects(policy(site,1,{incidentId:'not-valid'}),/scope/);
});

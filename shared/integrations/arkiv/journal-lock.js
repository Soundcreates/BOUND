import {open, readFile, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Fail closed on any existing lock. Stale locks require an operator to verify
// the owning process is gone before removing the lock file.
export async function acquireJournalLocks(paths) {
 if(!Array.isArray(paths)||paths.length===0||paths.some(path=>typeof path!=='string'||!path))throw new Error('invalid Arkiv journal paths');
 const unique=[...new Set(paths.map(path=>`${path}.lock`))].sort();
 const held=[];
 try {
  for(const path of unique){
   const token=`${process.pid}:${randomUUID()}`;
   let file;
   try { file=await open(path,'wx',0o600); await file.writeFile(token,'utf8'); await file.sync(); }
   catch(error){ if(file)await file.close(); throw new Error('Arkiv journal is already locked',{cause:error}); }
   await file.close(); held.push({path,token});
  }
 } catch(error) {
  await release(held);
  throw error;
 }
 let closed=false;
 async function close(){if(closed)return;closed=true;await release(held);}
 return {close};
}

async function release(held){
 for(const {path,token} of [...held].reverse()){
  try { if(await readFile(path,'utf8')===token)await unlink(path); }
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
}

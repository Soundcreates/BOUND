import {compileSnapshot} from '../../packages/snapshot/index.js';
import {validateRoot} from '../../packages/contracts/index.js';

// Stores immutable canonical bytes in Arkiv before publishing the ENS root pointer.
export function createCurator({network,arkiv,rootReader,rootPublisher,now=()=>Date.now()}){
 if(typeof network!=='string'||!arkiv||typeof arkiv.put!=='function'||typeof arkiv.read!=='function'||!rootReader||typeof rootReader.read!=='function'||!rootPublisher||typeof rootPublisher.publish!=='function'||typeof now!=='function')throw new Error('invalid curator configuration');
 let queue=Promise.resolve();
 async function publish(input){
  const compiled=compileSnapshot(input),snapshot=compiled.snapshot;
  const run=queue.then(async()=>{
   const time=now();
   if(!Number.isSafeInteger(time)||snapshot.network!==network||Date.parse(snapshot.generatedAt)>time||Date.parse(snapshot.expiresAt)<=time)throw new Error('invalid snapshot publication window');
   const current=await rootReader.read();
   if(!current||(current.root!==null&&(!validateRoot(current.root)||current.root.network!==network)))throw new Error('invalid current ENS root');
   if(current.root&&snapshot.epoch<=current.root.epoch)throw new Error('snapshot epoch must increase');
   const stored=await arkiv.put(compiled.bytes);
   if(!stored||stored.digest!==compiled.digest||typeof stored.key!=='string'||!/^0x[0-9a-f]{64}$/.test(stored.key)||typeof stored.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(stored.owner))throw new Error('invalid Arkiv publication');
   const checked=await arkiv.read(stored.key,stored.owner);
   if(!(checked instanceof Uint8Array)||checked.length!==compiled.bytes.length||checked.some((byte,index)=>byte!==compiled.bytes[index]))throw new Error('Arkiv snapshot readback mismatch');
   const root={schemaVersion:1,network,epoch:snapshot.epoch,digest:compiled.digest,arkivKey:stored.key,arkivOwner:stored.owner};
   const publication=await rootPublisher.publish(root);
   if(!publication||typeof publication.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(publication.transactionHash))throw new Error('invalid ENS publication receipt');
   return {root,transactionHash:publication.transactionHash,canonical:compiled.canonical};
  });
  queue=run.catch(()=>{});return run;
 }
 return {publish};
}

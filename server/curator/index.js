import {compileSnapshot} from '../../shared/snapshot/index.js';
import {validateRoot} from '../../shared/contracts/index.js';

// Uploads immutable bytes before publishing a coherent ENS root. Swarm and ENS
// adapters are injected so the same path can be exercised without live writes.
export function createCurator({network,swarm,rootReader,rootPublisher,now=()=>Date.now()}){
 if(typeof network!=='string'||!swarm||typeof swarm.put!=='function'||typeof swarm.verifyIndependent!=='function'||!rootReader||typeof rootReader.read!=='function'||!rootPublisher||typeof rootPublisher.publish!=='function'||typeof now!=='function')throw new Error('invalid curator configuration');
 let queue=Promise.resolve();
 async function publish(input){
  const compiled=compileSnapshot(input),snapshot=compiled.snapshot;
  const run=queue.then(async()=>{
   const time=now();
   if(!Number.isSafeInteger(time)||snapshot.network!==network||Date.parse(snapshot.generatedAt)>time||Date.parse(snapshot.expiresAt)<=time)throw new Error('invalid snapshot publication window');
   const current=await rootReader.read();
   if(!current||(current.root!==null&&(!validateRoot(current.root)||current.root.network!==network)))throw new Error('invalid current ENS root');
   if(current.root&&snapshot.epoch<=current.root.epoch)throw new Error('snapshot epoch must increase');
   const stored=await swarm.put(compiled.bytes);
   if(!stored||stored.digest!==compiled.digest||typeof stored.reference!=='string'||!/^[0-9a-f]{64}$/.test(stored.reference))throw new Error('invalid Swarm publication');
   const checked=await swarm.verifyIndependent(stored.reference,compiled.digest);
   if(!(checked instanceof Uint8Array)||checked.length!==compiled.bytes.length||checked.some((byte,index)=>byte!==compiled.bytes[index]))throw new Error('Swarm publication mismatch');
   const root={schemaVersion:1,network,epoch:snapshot.epoch,digest:compiled.digest,swarmReference:stored.reference};
   const publication=await rootPublisher.publish(root);
   if(!publication||typeof publication.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(publication.transactionHash))throw new Error('invalid ENS publication receipt');
   return {root,transactionHash:publication.transactionHash,canonical:compiled.canonical};
  });
  queue=run.catch(()=>{});return run;
 }
 return {publish};
}

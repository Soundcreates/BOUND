import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openWatcherDeployment} from './deployment.js';

const configPath=process.argv[2];
if(!configPath||process.argv.length!==3)throw new Error('usage: node services/watcher/run.mjs /absolute/path/to/config.mjs');
const module=await import(pathToFileURL(resolve(configPath)).href);
if(typeof module.createConfig!=='function')throw new Error('watcher configuration must export createConfig');
const config=await module.createConfig();
if(config?.watcher&&config.watcher.onFailure===undefined){
 config.watcher={...config.watcher,onFailure:event=>process.stderr.write(`watcher job failed: ${typeof event?.task==='string'?event.task:'unknown'}\n`)};
}
const deployment=await openWatcherDeployment(config);
let stopping=false;
async function stop(){
 if(stopping)return;stopping=true;
 try{await deployment.close();}catch{process.stderr.write('watcher shutdown failed; verify journal locks before restart\n');process.exitCode=1;}
}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const address=await deployment.start(config.listen);
 process.stdout.write(`watcher listening on ${address.address}:${address.port}\n`);
}catch{
 await stop();process.stderr.write('watcher startup failed; check configuration and service dependencies\n');process.exitCode=1;
}

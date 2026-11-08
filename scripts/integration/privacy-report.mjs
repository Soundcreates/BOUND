import {readFile,stat} from 'node:fs/promises';
import {parseUniqueJSON} from '../../shared/contracts/index.js';
import {scanPrivacy} from './privacy-scan.js';

if(process.argv.length!==3)throw new Error('usage: node scripts/integration/privacy-report.mjs /path/to/synthetic-manifest.json');
const metadata=await stat(process.argv[2]);if(!metadata.isFile()||metadata.size>1000000)throw new Error('invalid privacy manifest');
const manifest=parseUniqueJSON(await readFile(process.argv[2],'utf8'));
if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.keys(manifest).sort().join(',')!=='artifacts,canaries,publicCounterparties'||!Array.isArray(manifest.artifacts)||manifest.artifacts.length>100)throw new Error('invalid privacy manifest');
const artifacts=[];let total=0;
for(const item of manifest.artifacts){
 if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='name,path'||typeof item.path!=='string')throw new Error('invalid privacy manifest artifact');
 const info=await stat(item.path);if(!info.isFile()||info.size>8000000||(total+=info.size)>8000000)throw new Error('privacy scan artifacts too large');
 artifacts.push({name:item.name,content:await readFile(item.path)});
}
process.stdout.write(JSON.stringify(scanPrivacy({artifacts,canaries:manifest.canaries,publicCounterparties:manifest.publicCounterparties}),null,2)+'\n');

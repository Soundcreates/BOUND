// Isolated test evidence only. These reserved .example names are not real sites.
import {createHash} from 'node:crypto';
import {validateRecord} from '../../packages/contracts/index.js';
const hash=value=>'sha256-'+createHash('sha256').update(value).digest('base64');
export function syntheticDomainFixture({site='suspicious-wallet.example',now=Date.now()}={}) {
 if(!['suspicious-wallet.example','fake-swap.example','wallet-verify.example','reward-claim.example','token-bridge.example','secure-airdrop.example'].includes(site)||!Number.isSafeInteger(now)||now<3_600_000)throw Error('invalid synthetic fixture');
 const chainId=11155111,updatedAt=new Date(now).toISOString(),firstSeen=new Date(now-3_600_000).toISOString();
 const frontend={schemaVersion:1,kind:'frontend',site,chainId,updatedAt,scripts:[{path:'/app.js',hash:hash('synthetic-clean-script'),reporters:3,firstSeen,lastSeen:updatedAt,established:true}]};
 const status={schemaVersion:1,kind:'status',site,chainId,state:'drift',feedReference:'0x'+'a'.repeat(64),incidentReference:null,updatedAt};
 const drift={schemaVersion:1,kind:'drift',site,chainId,changes:[{kind:'ns',before:['ns.clean.example'],after:['ns.changed.example']}],corroborated:true,evidenceReference:'b'.repeat(64),detectedAt:updatedAt};
 if(![frontend,status,drift].every(validateRecord))throw Error('invalid synthetic record');
 const observed={version:1,documentUrl:`https://${site}/`,scripts:[{path:'/app.js',hash:hash('synthetic-modified-script')}],coverage:{total:1,compared:1,inlineExcluded:0,queryExcluded:0,crossOriginExcluded:0,privatePathExcluded:0,unavailable:0,overCap:0}};
 return {synthetic:true,frontend,status,drift,observed};
}

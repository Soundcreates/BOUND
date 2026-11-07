import {createArkivRpcReader} from '../../integrations/arkiv/rpc.js';
import {localArkivConfig} from '../../services/watcher/local-arkiv-config.mjs';

const [site, chainText] = process.argv.slice(2);
if (!site || !chainText || process.argv.length !== 4 || !/^[1-9]\d*$/.test(chainText) || !Number.isSafeInteger(Number(chainText))) throw Error('Usage: node --env-file=.env scripts/watcher/incident-history.mjs <hostname[:port]> <wallet-chain-id>');
const origin = new URL(`https://${site}`);
if (origin.host !== site || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw Error('Enter an exact hostname, without https://');
const {url,owner,chainId}=localArkivConfig(process.env);
if (!url || !owner || chainId !== 7794095) throw Error('Configure the Rabdi RPC, writer owner and chain ID in .env');
const reader=createArkivRpcReader({url,accessKey:process.env.ARKIV_ACCESS_KEY || undefined,schemaTag:'bound.record.v1',expectedChainId:chainId});
const rows=await reader.query({owner});
const relevant=rows.filter(({record})=>record.site===site && record.chainId===Number(chainText));
const incidents=relevant.filter(({record})=>record.kind==='incident').map(({key,record})=>({key,reportedAt:record.createdAt,trigger:record.trigger,severity:record.severity,counterparty:record.counterparty,score:null,scoreNote:'Incident entity does not contain a BOUND score; related warning observations are listed separately.'}));
const warnings=relevant.filter(({record})=>record.kind==='observation' && record.event==='warned').map(({key,record})=>({key,reportedAt:record.observedAt??null,score:record.score??null,counterparty:record.value}));
console.log(JSON.stringify({site,chainId:Number(chainText),owner,queriedAt:new Date().toISOString(),meaning:'Only current, unexpired records from this writer. No records means unknown, not proof that no incident occurred. BOUND score is not a probability.',incidents,warnings},null,2));

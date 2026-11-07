import {readFile, writeFile} from 'node:fs/promises';
const base='.bound/ens-financial-registry/';
const plan=JSON.parse(await readFile(base+'plan.json','utf8'));
const journal=JSON.parse(await readFile(base+'journal.json','utf8'));
const verified=new Map(journal.transactions.filter(t=>t.state==='verified').map(t=>[t.name,t]));
const rows=['# BOUND Sepolia ENS registry records','','These are BOUND-managed wildcard resolver records, not tokenized registrations or protocol attestations. Hashes are public fetch observations and are not trusted baselines. Transaction links show the corresponding Sepolia write.','','| Candidate site | BOUND ENS subname | Script hashes | Transaction |','| --- | --- | --- | --- |'];
for(const entry of plan.entries){const tx=verified.get(entry.name);const n=JSON.parse(entry.observation).scripts.length;rows.push(`| ${entry.site} | \`${entry.name}\` | ${n || 'unavailable'} | ${tx?`[verified](https://sepolia.etherscan.io/tx/${tx.hash})`:'not yet verified'} |`)}
await writeFile('fixtures/financial-registry/ENS-RECORDS.md',rows.join('\n')+'\n');
console.log(`${verified.size}/${plan.entries.length} verified entries documented`);

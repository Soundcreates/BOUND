import {readFile,stat} from 'node:fs/promises';
import {parseUniqueJSON} from '../../packages/contracts/index.js';
import {summarizeMetrics} from './metrics.js';

if(process.argv.length!==3)throw new Error('usage: node scripts/integration/metrics-report.mjs /path/to/samples.json');
const path=process.argv[2],info=await stat(path);
if(!info.isFile()||info.size>1000000)throw new Error('metric input must be a file no larger than 1 MB');
const samples=parseUniqueJSON(await readFile(path,'utf8'));
process.stdout.write(JSON.stringify(summarizeMetrics(samples),null,2)+'\n');

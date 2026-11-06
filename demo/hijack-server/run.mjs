import {createInterface} from 'node:readline';
import {createDemoCutover} from './index.js';

const portText = process.env.BOUND_DEMO_PORT ?? '4173';
if (!/^[0-9]+$/.test(portText)) throw new Error('BOUND_DEMO_PORT must be an integer');

const demo = await createDemoCutover({
  port: Number(portText),
  token: process.env.BOUND_DEMO_TOKEN,
  spender: process.env.BOUND_DEMO_SPENDER,
  scannerClean: process.env.BOUND_DEMO_SCANNER_CLEAN === '1',
});
process.stdout.write('Local demo origin: ' + demo.origin + ' (normal page)\n');
process.stdout.write('Type hijack, normal, or quit. The switch is local stdin control.\n');

const input = createInterface({input: process.stdin, output: process.stdout});
let closed = false;
const shutdown = async () => {
  if (closed) return;
  closed = true;
  await demo.close();
};

input.on('line', async line => {
  const command = line.trim();
  if (command === 'hijack' || command === 'normal') {
    demo.setMode(command);
    process.stdout.write('Mode: ' + demo.mode + '\n');
  } else if (command === 'quit') {
    input.close();
    await shutdown();
  } else {
    process.stdout.write('Use hijack, normal, or quit.\n');
  }
});
input.on('close', () => { void shutdown(); });
process.on('SIGINT', async () => {
  await shutdown();
  process.exitCode = 0;
});

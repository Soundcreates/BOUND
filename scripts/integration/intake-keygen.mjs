// Creates the aggregator's report-encryption key (P-256, for HPKE).
//
//   node scripts/integration/intake-keygen.mjs            # refuses if a key exists
//   node scripts/integration/intake-keygen.mjs --rotate   # replaces it (old reports in flight become unreadable)
//   node scripts/integration/intake-keygen.mjs --print-env # prints the existing private JWK, for a hosting secret
//
// The private key is written as a JWK to .bound/intake-key.json (mode 0600) and is
// never printed. Put the printed BOUND_INTAKE_PUBLIC_KEY line in .env and rebuild
// the extension, which pins that public key.
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyId, toBase64Url } from '../../shared/integrations/report-crypto/index.mjs';

const args = process.argv.slice(2);
for (const a of args) if (a !== '--rotate' && a !== '--print-env') throw new Error(`unknown option ${a}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.resolve(process.env.BOUND_INTAKE_KEY_FILE ?? path.join(root, '.bound', 'intake-key.json'));
const exists = await access(file).then(() => true, () => false);

// Prints only the JWK, so it can be piped straight into a secret store, e.g. the
// BOUND_INTAKE_PRIVATE_JWK variable on the hosting platform. It is a private key:
// never paste it into chat, issues or logs.
if (args.includes('--print-env')) {
  if (!exists) throw new Error(`${file} does not exist; run this script without options first`);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  process.stdout.write(JSON.stringify(stored.privateKey));
  process.exit(0);
}
if (exists && !args.includes('--rotate')) throw new Error(`${file} already exists; pass --rotate to replace it`);

const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const id = await keyId(raw);

await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
await writeFile(file, JSON.stringify({ version: 1, keyId: id, privateKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } }), { mode: 0o600 });
await chmod(file, 0o600);
console.log(`private key written to ${file} (keyId ${id})`);
console.log('add this line to .env, then rebuild the extension:');
console.log(`BOUND_INTAKE_PUBLIC_KEY=${toBase64Url(raw)}`);

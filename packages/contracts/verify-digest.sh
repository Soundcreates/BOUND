#!/bin/sh
# Verify the public fixture with a JSON-RPC implementation of Keccak-256.
set -eu
cd "$(dirname "$0")/../.."
request=$(node --input-type=module -e '
import { readFileSync } from "node:fs";
const bytes = readFileSync("fixtures/contracts/snapshot-canonical.json");
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"web3_sha3",params:["0x"+bytes.toString("hex")]}));
')
response=$(printf '%s' "$request" | curl -fsS --max-time 15 -H 'content-type: application/json' --data-binary @- https://rpc.rabdi.db-chain.testnet.arkiv.network)
printf '%s' "$response" | node --input-type=module -e '
import { readFileSync } from "node:fs";
const actual = JSON.parse(readFileSync(0, "utf8"));
const expected = JSON.parse(readFileSync("fixtures/contracts/snapshot-digest.json", "utf8"));
if (actual.result !== expected.digest) { console.error("Digest mismatch or RPC error:", actual); process.exit(1); }
console.log("Keccak-256 matches:", actual.result);
'

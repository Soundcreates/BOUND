#!/usr/bin/env node
/**
 * bound-curator — the curator's own command-line tool.
 *
 *   bound-curator compile  <input.json> <out-prefix>   # offline: writes <out-prefix>.bin + .json
 *   bound-curator publish  <compiled-bytes.bin>         # reads env, needs network + a private key
 *   bound-curator read                                   # reads env, read-only verification
 *
 * `compile` never touches the network or a private key — see compile.ts. `publish` and
 * `read` both call `loadCuratorConfig()` (env.ts), so every required credential is named in
 * one error message rather than failing deep inside a network call.
 */
import { writeFile, readFile } from "node:fs/promises";
import { loadCuratorConfig, MissingEnvError } from "./env.ts";
import { loadCompileInput, compileSnapshot } from "./compile.ts";
import { publishSnapshot, PublishRefusedError } from "./publish.ts";
import { readAndVerifyRoot, RootVerificationError } from "./read.ts";
import { decodeSnapshotBytes } from "@bound/snapshot";

function usage(): never {
  process.stderr.write(
    "usage:\n" +
      "  bound-curator compile <input.json> <out-prefix>\n" +
      "  bound-curator publish <compiled-bytes.bin>\n" +
      "  bound-curator read\n",
  );
  process.exit(2);
}

async function cmdCompile(inputPath: string, outPrefix: string): Promise<void> {
  const input = await loadCompileInput(inputPath);
  const { snapshot, bytes, digest } = compileSnapshot(input);
  await writeFile(`${outPrefix}.bin`, bytes);
  await writeFile(`${outPrefix}.json`, JSON.stringify({ snapshot, digest, byteLength: bytes.length }, null, 2));
  process.stdout.write(
    `compiled epoch ${snapshot.epoch} — digest ${digest} — ${bytes.length} bytes\n` +
      `  bytes:    ${outPrefix}.bin\n` +
      `  metadata: ${outPrefix}.json\n`,
  );
}

async function cmdPublish(bytesPath: string): Promise<void> {
  const config = loadCuratorConfig();
  const bytes = await readFile(bytesPath);
  // Re-decode rather than trust the bytes blindly: `publish` must refuse exactly what any
  // other reader would refuse, not a looser check just because the caller compiled them.
  const decoded = decodeSnapshotBytes(new Uint8Array(bytes));
  const result = await publishSnapshot(config, decoded.snapshot, { bytes: decoded.bytes, digest: decoded.digest });
  process.stdout.write(
    `published epoch ${result.epoch}` +
      (result.previousEpoch !== undefined ? ` (previous: ${result.previousEpoch})` : " (first publish)") +
      `\n  swarmRef: ${result.swarmRef}\n  digest:   ${result.digest}\n  tx:       ${result.txHash}\n`,
  );
}

async function cmdRead(): Promise<void> {
  const config = loadCuratorConfig();
  const { root, snapshot } = await readAndVerifyRoot(config);
  process.stdout.write(
    `live root verified — epoch ${root.epoch}, network ${root.network}\n` +
      `  digest:   ${root.digest}\n` +
      `  swarmRef: ${root.swarmRef}\n` +
      `  sites:    ${Object.keys(snapshot.sites).length}\n` +
      `  expires:  ${snapshot.expiresAt}\n`,
  );
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "compile": {
        const [input, outPrefix] = args;
        if (!input || !outPrefix) usage();
        await cmdCompile(input, outPrefix);
        return;
      }
      case "publish": {
        const [bytesPath] = args;
        if (!bytesPath) usage();
        await cmdPublish(bytesPath);
        return;
      }
      case "read":
        await cmdRead();
        return;
      default:
        usage();
    }
  } catch (e) {
    if (e instanceof MissingEnvError || e instanceof PublishRefusedError || e instanceof RootVerificationError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

void main();

#!/usr/bin/env node
/**
 * bound-curator — the curator's own command-line tool.
 *
 *   bound-curator compile  <input.json> <out-prefix>   # offline: writes <out-prefix>.bin + .json
 *   bound-curator publish  <compiled-bytes.bin>         # reads env, needs network + a private key
 *   bound-curator read                                   # reads env, read-only verification
 *   bound-curator attest-grant <protocol-address>    # admin grants protocol ROLE_SET_TEXT on bound.attest.v1
 *   bound-curator attest-write <ens-name> <site-host> <addr1[,addr2,...]> [expiry-days]
 *                                                        # publish a protocol self-attestation
 *   bound-curator attest-read  <ens-name>               # read a live protocol self-attestation
 *
 * `compile` never touches the network or a private key — see compile.ts. `publish` and
 * `read` both call `loadCuratorConfig()` (env.ts), so every required credential is named in
 * one error message rather than failing deep inside a network call.
 *
 * `attest-write` and `attest-read` use BOUND_PROTOCOL_PRIVATE_KEY (separate from the
 * curator key) and BOUND_RESOLVER_ADDRESS from env, satisfying plan §3 "protocol account —
 * separate scoped setter for that protocol's attestation record; cannot change the BOUND
 * root or another protocol's record."
 */
import { writeFile, readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { loadCuratorConfig, MissingEnvError } from "./env.ts";
import { loadCompileInput, compileSnapshot } from "./compile.ts";
import { publishSnapshot, PublishRefusedError } from "./publish.ts";
import { readAndVerifyRoot, RootVerificationError } from "./read.ts";
import { decodeSnapshotBytes, type Attestation } from "@bound/snapshot";
import {
  makePublicClient,
  makeWalletClient,
  publishAttestation,
  readAttestation,
  grantProtocolRole,
  ENSV2_SEPOLIA,
  RootReadError,
} from "@bound/integrations-ens";

function usage(): never {
  process.stderr.write(
    "usage:\n" +
      "  bound-curator compile <input.json> <out-prefix>\n" +
      "  bound-curator publish <compiled-bytes.bin>\n" +
      "  bound-curator read\n" +
      "  bound-curator attest-grant <protocol-address>    # admin grants protocol ROLE_SET_TEXT on bound.attest.v1\n" +
      "  bound-curator attest-write <ens-name> <site-host> <addr1[,addr2,...]> [expiry-days]\n" +
      "  bound-curator attest-read  <ens-name>\n",
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

/**
 * Grant a protocol account ROLE_SET_TEXT on textResource("bound.attest.v1").
 * Uses BOUND_CURATOR_PRIVATE_KEY (which must hold admin roles) as the granting wallet.
 * This is a one-time setup step; after this, the protocol account can call attest-write.
 */
async function cmdAttestGrant(protocolAddress: `0x${string}`): Promise<void> {
  // Must use BOUND_OWNER_PRIVATE_KEY (resolver deployer/admin), NOT the curator key.
  // The curator only holds ROLE_SET_TEXT on textResource("bound.root.v1");
  // granting roles requires adminOf(ROLE_SET_TEXT) = ROLE_SET_TEXT << 128 on the
  // target resource, which only the resolver owner holds.
  // Using the curator key causes MissingRole revert (selector 0xd1a3b355).
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  const ownerKey = process.env.BOUND_OWNER_PRIVATE_KEY;
  const resolverAddress = (process.env.BOUND_RESOLVER_ADDRESS ?? ENSV2_SEPOLIA.permissionedResolverImpl) as `0x${string}`;

  if (!rpcUrl) throw new MissingEnvError("BOUND_SEPOLIA_RPC_URL", "Sepolia JSON-RPC endpoint");
  if (!ownerKey) throw new MissingEnvError("BOUND_OWNER_PRIVATE_KEY", "resolver admin/owner key — NOT the curator key; needed to grant roles");

  const ownerAccount = privateKeyToAccount(ownerKey as `0x${string}`);
  const walletClient = makeWalletClient(rpcUrl, ownerAccount);

  process.stdout.write(
    `attest-grant: granting ROLE_SET_TEXT(bound.attest.v1) to ${protocolAddress}\n` +
      `  admin/granter:   ${ownerAccount.address}\n` +
      `  resolver:        ${resolverAddress}\n`,
  );

  const txHash = await grantProtocolRole(walletClient, resolverAddress, protocolAddress);
  process.stdout.write(`  tx: ${txHash}\n`);
}

/**
 * Publish a protocol self-attestation under <ens-name> using the PROTOCOL account key
 * (BOUND_PROTOCOL_PRIVATE_KEY) — separate from the curator key (plan §3 governance table).
 *
 * The protocol account must hold ROLE_SET_TEXT on textResource("bound.attest.v1") on the
 * resolver; the curator has ROLE_SET_TEXT on textResource("bound.root.v1") only, so these
 * two roles are mutually exclusive in practice.
 */
async function cmdAttestWrite(
  ensName: string,
  siteHost: string,
  addrsCsv: string,
  expiryDays: number,
): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  const protocolKey = process.env.BOUND_PROTOCOL_PRIVATE_KEY;
  const resolverAddress = (process.env.BOUND_RESOLVER_ADDRESS ?? ENSV2_SEPOLIA.permissionedResolverImpl) as `0x${string}`;

  if (!rpcUrl) throw new MissingEnvError("BOUND_SEPOLIA_RPC_URL", "Sepolia JSON-RPC endpoint");
  if (!protocolKey) throw new MissingEnvError("BOUND_PROTOCOL_PRIVATE_KEY", "protocol account key (separate from curator)");

  const protocolAccount = privateKeyToAccount(protocolKey as `0x${string}`);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, protocolAccount);

  const addrs = addrsCsv.split(",").map((a) => a.trim().toLowerCase());
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const attestation: Attestation = {
    schemaVersion: 1,
    site: siteHost,
    addresses: { "11155111": addrs },
    expiresAt,
  };

  process.stdout.write(
    `attest-write: protocol=${protocolAccount.address}  name=${ensName}\n` +
      `  site: ${siteHost}\n` +
      `  addresses: ${addrs.join(", ")}\n` +
      `  expiresAt: ${expiresAt}\n`,
  );

  const txHash = await publishAttestation(walletClient, publicClient, ensName, resolverAddress, attestation);
  process.stdout.write(`  tx: ${txHash}\n`);
}

/** Read a live protocol self-attestation from ENS via UniversalResolverV2.resolve(). */
async function cmdAttestRead(ensName: string): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new MissingEnvError("BOUND_SEPOLIA_RPC_URL", "Sepolia JSON-RPC endpoint");

  const publicClient = makePublicClient(rpcUrl);
  const attestation = await readAttestation(publicClient, ensName);

  process.stdout.write(
    `attestation at ${ensName}:\n` +
      `  schemaVersion: ${attestation.schemaVersion}\n` +
      `  site:          ${attestation.site}\n` +
      `  expiresAt:     ${attestation.expiresAt}\n` +
      `  addresses:     ${JSON.stringify(attestation.addresses)}\n`,
  );

  const now = new Date();
  const expiry = new Date(attestation.expiresAt);
  if (expiry <= now) {
    process.stdout.write(`  ⚠ attestation is EXPIRED (expired ${attestation.expiresAt})\n`);
  } else {
    process.stdout.write(`  ✓ not expired\n`);
  }
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
      case "attest-grant": {
        const [protocolAddress] = args;
        if (!protocolAddress) usage();
        await cmdAttestGrant(protocolAddress as `0x${string}`);
        return;
      }
      case "attest-write": {
        const [ensName, siteHost, addrsCsv, expiryDaysStr] = args;
        if (!ensName || !siteHost || !addrsCsv) usage();
        await cmdAttestWrite(ensName, siteHost, addrsCsv, expiryDaysStr ? parseInt(expiryDaysStr, 10) : 7);
        return;
      }
      case "attest-read": {
        const [ensName] = args;
        if (!ensName) usage();
        await cmdAttestRead(ensName);
        return;
      }
      default:
        usage();
    }
  } catch (e) {
    if (e instanceof MissingEnvError || e instanceof PublishRefusedError || e instanceof RootVerificationError || e instanceof RootReadError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

void main();

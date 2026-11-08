/**
 * Curator CLI configuration from environment variables.
 *
 * Deliberately env-based rather than a config file: plan §4.4 says "keep keys, RPC tokens,
 * Swarm postage credentials, and local environment files out of git," and an env var is the
 * one input shape that disappears when the process exits and never gets accidentally
 * `git add`ed.
 */
import { privateKeyToAccount, type Account } from "viem/accounts";
import { SEPOLIA_CHAIN_ID, type BoundEnsConfig } from "@bound/integrations-ens";

export class MissingEnvError extends Error {
  constructor(name: string, purpose: string) {
    super(`missing required env var ${name} (${purpose})`);
    this.name = "MissingEnvError";
  }
}

function required(name: string, purpose: string): string {
  const v = process.env[name];
  if (!v) throw new MissingEnvError(name, purpose);
  return v;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * Where compiled snapshot bytes get uploaded. Two modes, never silently interchangeable:
 * `bee` uses our own node and postage batch, so we control how long the bytes survive;
 * `gateway` posts unstamped to a public Bee gateway, which stamps with its own batch for
 * free. The trade is persistence, not integrity — the root record's digest is what makes
 * served bytes unforgeable, so a gateway upload can go missing but can never go wrong.
 */
export type SwarmUploadTarget =
  | { readonly mode: "bee"; readonly apiUrl: string; readonly batchId: string }
  | { readonly mode: "gateway"; readonly apiUrl: string };

export interface CuratorConfig {
  readonly rpcUrl: string;
  readonly curatorAccount: Account;
  readonly ens: BoundEnsConfig;
  readonly swarmUpload: SwarmUploadTarget;
  /** At least 2, required for the multi-gateway read-back check. */
  readonly gatewayUrls: readonly string[];
}

/**
 * Loads and validates every env var the CLI needs, failing with one specific
 * `MissingEnvError` per missing variable rather than a generic "config invalid" — the plan's
 * one-hour-per-Phase-0-probe budget (plan §5) does not leave room for guessing which of six
 * env vars was the one left unset.
 */
export function loadCuratorConfig(): CuratorConfig {
  const rpcUrl = required("BOUND_SEPOLIA_RPC_URL", "Sepolia JSON-RPC endpoint for reads and writes");
  const privateKey = required("BOUND_CURATOR_PRIVATE_KEY", "curator's testnet-only private key, 0x-prefixed 32 bytes");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new TypeError("BOUND_CURATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  const rootName = required("BOUND_ROOT_NAME", "the ENS name BOUND publishes its root record under, e.g. bound-demo.eth");
  // Deliberately required with no default. This used to fall back to
  // `ENSV2_SEPOLIA.permissionedResolverImpl`, which is ENS's SHARED implementation: it was
  // never initialize()d with our admin, holds none of this deployment's grants, and reverts
  // MissingRole (0xd1a3b355) on every write. A default that cannot possibly work is worse
  // than no default, because it turns a missing-config error into an on-chain revert.
  const resolverAddress = required(
    "BOUND_RESOLVER_ADDRESS",
    "the PermissionedResolver PROXY deployed for this name — not ENS's shared implementation",
  ) as `0x${string}`;
  const gatewayCsv = required(
    "BOUND_SWARM_GATEWAYS",
    "comma-separated Swarm gateway base URLs; at least 2, for the required second-gateway check",
  );
  const gatewayUrls = gatewayCsv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (gatewayUrls.length < 2) {
    throw new TypeError("BOUND_SWARM_GATEWAYS must list at least 2 gateway URLs (plan §3: require a second gateway)");
  }

  // Our own Bee node is preferred but optional. Both vars together or neither: one without
  // the other is always a mistake (a node with no batch cannot stamp; a batch with no node
  // has nowhere to go), and guessing which the operator meant would pick a payer silently.
  const beeApiUrl = optional("BOUND_BEE_API_URL");
  const postageBatchId = optional("BOUND_POSTAGE_BATCH_ID");
  if ((beeApiUrl === undefined) !== (postageBatchId === undefined)) {
    throw new TypeError(
      "BOUND_BEE_API_URL and BOUND_POSTAGE_BATCH_ID must be set together (upload through our own " +
        "Bee node) or both left unset (upload unstamped to a public gateway, which stamps it)",
    );
  }
  const swarmUpload: SwarmUploadTarget =
    beeApiUrl !== undefined && postageBatchId !== undefined
      ? { mode: "bee", apiUrl: beeApiUrl, batchId: postageBatchId }
      : { mode: "gateway", apiUrl: optional("BOUND_SWARM_UPLOAD_URL") ?? gatewayUrls[0]! };

  return {
    rpcUrl,
    curatorAccount: privateKeyToAccount(privateKey as `0x${string}`),
    ens: { chainId: SEPOLIA_CHAIN_ID, rootName, resolverAddress },
    swarmUpload,
    gatewayUrls,
  };
}

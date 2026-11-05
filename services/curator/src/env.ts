/**
 * Curator CLI configuration from environment variables.
 *
 * Deliberately env-based rather than a config file: plan §4.4 says "keep keys, RPC tokens,
 * Swarm postage credentials, and local environment files out of git," and an env var is the
 * one input shape that disappears when the process exits and never gets accidentally
 * `git add`ed.
 */
import { privateKeyToAccount, type Account } from "viem/accounts";
import { ENSV2_SEPOLIA, SEPOLIA_CHAIN_ID, type BoundEnsConfig } from "@bound/integrations-ens";

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

export interface CuratorConfig {
  readonly rpcUrl: string;
  readonly curatorAccount: Account;
  readonly ens: BoundEnsConfig;
  readonly beeApiUrl: string;
  readonly postageBatchId: string;
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
  const resolverAddress = (optional("BOUND_RESOLVER_ADDRESS") ?? ENSV2_SEPOLIA.permissionedResolverImpl) as `0x${string}`;
  const beeApiUrl = required("BOUND_BEE_API_URL", "the curator's own Bee node HTTP API, e.g. http://localhost:1633");
  const postageBatchId = required("BOUND_POSTAGE_BATCH_ID", "a usable postage batch id on that Bee node");
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

  return {
    rpcUrl,
    curatorAccount: privateKeyToAccount(privateKey as `0x${string}`),
    ens: { chainId: SEPOLIA_CHAIN_ID, rootName, resolverAddress },
    beeApiUrl,
    postageBatchId,
    gatewayUrls,
  };
}

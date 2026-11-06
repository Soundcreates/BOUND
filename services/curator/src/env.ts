/** Curator CLI configuration. Keys and local journal paths are supplied through env only. */
import { privateKeyToAccount, type Account } from "viem/accounts";
import { SEPOLIA_CHAIN_ID, type BoundEnsConfig } from "@bound/integrations-ens";
import { FetchRequest, JsonRpcProvider, Wallet } from "ethers";
import { createArkivSigner } from "../../../integrations/arkiv/signer.js";

export class MissingEnvError extends Error {
  constructor(name: string, purpose: string) {
    super(`missing required env var ${name} (${purpose})`);
    this.name = "MissingEnvError";
  }
}

function required(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value) throw new MissingEnvError(name, purpose);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

type ArkivSignRequest = { owner: string; chainId: number; target: string; value: string; data: string };

export interface CuratorConfig {
  readonly rpcUrl: string;
  readonly curatorAccount: Account;
  readonly ens: BoundEnsConfig;
  readonly arkiv: {
    readonly url: string;
    readonly accessKey?: string;
    readonly owner: `0x${string}`;
    readonly target: `0x${string}`;
    readonly chainId: number;
    readonly schemaTag: string;
    readonly senderJournal: string;
    readonly registryJournal: string;
    readonly lifetimes: Readonly<Record<string, number>>;
    readonly prepare?: (request: ArkivSignRequest) => Promise<string>;
    readonly inspect?: (raw: string) => { from: string | null; to: string | null; chainId: number; value: string; data: string };
  };
}

export function loadCuratorConfig(): CuratorConfig {
  const rpcUrl = required("BOUND_SEPOLIA_RPC_URL", "Sepolia JSON-RPC endpoint for ENS reads and writes");
  const privateKey = required("BOUND_CURATOR_PRIVATE_KEY", "curator's testnet-only Sepolia private key, 0x-prefixed 32 bytes");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new TypeError("BOUND_CURATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");

  const rootName = required("BOUND_ROOT_NAME", "the ENS name BOUND publishes its root record under");
  const resolverAddress = required(
    "BOUND_RESOLVER_ADDRESS",
    "the PermissionedResolver proxy deployed for this name, not ENS's shared implementation",
  ) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(resolverAddress)) throw new TypeError("BOUND_RESOLVER_ADDRESS must be a 20-byte address");

  const arkivUrl = required("BOUND_ARKIV_RPC_URL", "Arkiv Rabdi RPC URL");
  const arkivOwner = required("BOUND_ARKIV_OWNER", "public address that owns curator snapshot entities").toLowerCase();
  const arkivTarget = required("BOUND_ARKIV_SYSTEM_ADDRESS", "Arkiv entity system contract address").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(arkivOwner) || !/^0x[0-9a-f]{40}$/.test(arkivTarget)) {
    throw new TypeError("BOUND_ARKIV_OWNER and BOUND_ARKIV_SYSTEM_ADDRESS must be lowercase 20-byte addresses");
  }

  const arkivChainId = Number(optional("BOUND_ARKIV_CHAIN_ID") ?? "7794095");
  if (!Number.isSafeInteger(arkivChainId) || arkivChainId < 1) throw new TypeError("BOUND_ARKIV_CHAIN_ID must be a positive integer");
  const arkivLifetime = Number(optional("BOUND_ARKIV_LIFETIME_BLOCKS") ?? "7884000");
  if (!Number.isSafeInteger(arkivLifetime) || arkivLifetime < 4 || arkivLifetime > 7884000) {
    throw new TypeError("BOUND_ARKIV_LIFETIME_BLOCKS must be between 4 and 7884000");
  }
  const accessKey = optional("ARKIV_ACCESS_KEY");
  let arkivSigner: ReturnType<typeof createArkivSigner> | undefined;
  const arkivPrivateKey = optional("BOUND_ARKIV_PRIVATE_KEY");
  if (arkivPrivateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(arkivPrivateKey)) throw new TypeError("BOUND_ARKIV_PRIVATE_KEY must be a 0x-prefixed 32-byte private key");
    const request = new FetchRequest(arkivUrl);
    if (accessKey) request.setHeader("x-api-key", accessKey);
    const provider = new JsonRpcProvider(request, arkivChainId);
    const wallet = new Wallet(arkivPrivateKey);
    if (wallet.address.toLowerCase() !== arkivOwner) throw new TypeError("BOUND_ARKIV_PRIVATE_KEY does not match BOUND_ARKIV_OWNER");
    arkivSigner = createArkivSigner({ wallet, provider, owner: arkivOwner, target: arkivTarget, chainId: arkivChainId });
  }

  const schemaTag = "bound.record.v1";
  const lifetimes = Object.fromEntries(
    ["observation", "baseline", "drift", "incident", "status", "evidence", "trust_snapshot"].map(kind => [kind, arkivLifetime]),
  );
  lifetimes.trust_snapshot = 7_884_000;

  return {
    rpcUrl,
    curatorAccount: privateKeyToAccount(privateKey as `0x${string}`),
    ens: { chainId: SEPOLIA_CHAIN_ID, rootName, resolverAddress },
    arkiv: {
      url: arkivUrl,
      ...(accessKey ? { accessKey } : {}),
      owner: arkivOwner as `0x${string}`,
      target: arkivTarget as `0x${string}`,
      chainId: arkivChainId,
      schemaTag,
      senderJournal: optional("BOUND_ARKIV_SENDER_JOURNAL") ?? "",
      registryJournal: optional("BOUND_ARKIV_REGISTRY_JOURNAL") ?? "",
      lifetimes,
      ...(arkivSigner ? arkivSigner : {}),
    },
  };
}

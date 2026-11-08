/**
 * Known anon-rpc worker specifiers (spec §4: an `IWorkerSpecifier` contract address that
 * hash-pins a worker bundle on-chain), taken verbatim from upstream `adopters.json5`
 * (github.com/ethereum/anon-rpc) rather than invented — getting a specifier address wrong
 * means booting nothing, or booting the wrong worker, with no symptom until a `fetch` hangs.
 *
 * Arch §12.2 **[ASSUMPTION]**: "an example worker performing an ordinary fetch is not
 * anonymous and no privacy claim is made on that basis." `kind: "reference"` entries
 * (`passthrough`) are exactly that and MUST NOT be used for BOUND's EF Anon-RPC prize claim
 * or for any production counterparty lookup — they exist only for local wiring tests where no
 * privacy claim is being made. `kind: "network"` entries genuinely anonymize.
 *
 * BOUND's own deployment targets Sepolia (see `@bound/integrations-ens`'s `SEPOLIA_CHAIN_ID`),
 * and `nox` is the one upstream worker published there, so it is BOUND's default. `tor-js` and
 * `passthrough` are mainnet-published; kept here for local/dev use against a mainnet bootstrap
 * RPC, not for the Sepolia path BOUND actually ships.
 */

export type WorkerKind = "network" | "reference";

export interface KnownWorker {
  readonly id: string;
  readonly label: string;
  /** The IWorkerSpecifier contract address (spec §4), checksum as published upstream. */
  readonly specifier: `0x${string}`;
  /** The chain the specifier contract itself lives on. Absent means Ethereum mainnet (1). */
  readonly chainId: number;
  readonly kind: WorkerKind;
  readonly note: string;
}

export const KNOWN_WORKERS: readonly KnownWorker[] = [
  {
    id: "passthrough",
    label: "Passthrough — plain fetch (no anonymization)",
    specifier: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27",
    chainId: 1,
    kind: "reference",
    note: "Reference worker only. Fulfils calls with an ordinary fetch — not anonymized. Never use for a privacy claim.",
  },
  {
    id: "tor-js",
    label: "tor-js — fetch over Tor",
    specifier: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    chainId: 1,
    kind: "network",
    note: "Runs a Tor client compiled to WebAssembly inside the sandbox. Needs a gateway in config and has a bootstrap delay.",
  },
  {
    id: "nym",
    label: "Nym — fetch over the Nym mixnet",
    specifier: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0",
    chainId: 1,
    kind: "network",
    note: "Runs a Nym mixnet client (WASM) inside the sandbox. ~18 MB bundle; several seconds to bootstrap.",
  },
  {
    id: "nox",
    label: "Nox — fetch over a Sphinx mixnet",
    specifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
    chainId: 11155111,
    kind: "network",
    note: "Published on Sepolia — BOUND's own target chain. Routes each request through entry/mix/exit nodes over KPS; TLS runs inside the worker so the exit node cannot read the request.",
  },
] as const;

export function getKnownWorker(id: string): KnownWorker | undefined {
  return KNOWN_WORKERS.find((w) => w.id === id);
}

/**
 * All genuinely anonymizing (`kind: "network"`) workers published on a given chain, in the
 * upstream list's order. Use this to pick BOUND's default rather than hardcoding one id —
 * `nox` today, but a future upstream addition on the same chain should not require a code
 * change to prefer the first still-maintained option.
 */
export function networkWorkersOnChain(chainId: number): readonly KnownWorker[] {
  return KNOWN_WORKERS.filter((w) => w.kind === "network" && w.chainId === chainId);
}

export class UnknownWorkerError extends Error {
  constructor(id: string) {
    super(`no known anon-rpc worker with id ${JSON.stringify(id)}`);
    this.name = "UnknownWorkerError";
  }
}

export function assertKnownWorker(id: string): KnownWorker {
  const w = getKnownWorker(id);
  if (!w) throw new UnknownWorkerError(id);
  return w;
}

# Developer 2 — Trust and chain reads

Owns: `packages/snapshot/**`, `services/curator/**`, `integrations/ens/**`,
`integrations/swarm/**`, `integrations/anon-rpc/**`, `fixtures/snapshots/**`.

Mission (plan §4): own snapshot/compiler/verifier, ENSv2 root and protocol attestation,
curator role, Swarm snapshot/report storage library, Anon-RPC transport adapter and chain
reads. Export stable trust, Swarm, and chain-read adapters for Developer 1 (extension) and
Developer 3 (watcher/integration harness) to consume.

## Packages in this lane

| Package | What it is | Depends on |
|---|---|---|
| `@bound/snapshot` | Pure, offline logic: strict JSON, RFC 8785 canonicalization, the keccak256 root digest, schema validation, CREATE-address lineage, the extension-side verifier state machine, the trust-cap index, and the curator-side compiler. No network code anywhere in this package — that split is deliberate (see its own module docstrings). | nothing but `@noble/hashes` |
| `@bound/integrations-ens` | Real viem clients against the deployed Sepolia PermissionedResolver/UniversalResolverV2/ETHRegistry. Root record + protocol attestation read/write, least-privilege curator role grants, registrar commit/register/finish flow. | `@bound/snapshot`, `viem` |
| `@bound/integrations-swarm` | Bee `/bytes` upload + self-verified round-trip, postage batch usability checks, multi-gateway read-with-agreement for the "second gateway" requirement. | `@bound/snapshot` |
| `@bound/integrations-anon-rpc` | Known-worker inventory (verified against upstream `anon-rpc` `adopters.json5`), the signing-time 1.5s budget, call telemetry, a JSON-RPC-over-anon-fetch transport adapter, EIP-1967/nonce chain-read primitives, and the `AnonRpcWorker` factory for the extension's service worker. Ships `probe-extension/`, a standalone loadable MV3 extension — the only way to prove the harness actually boots, since there is no DOM under `node --test`. | `@anon-rpc/browser-extension-harness`, `@anon-rpc/browser-harness` |
| `@bound/curator` (`services/curator`) | The curator's own CLI (`compile` / `publish` / `read`) plus the Phase 0 probe scripts below. Ties the other four packages together into the actual publish path. | all of the above |
| `fixtures/snapshots/**` | Sample compile-input JSON for the curator CLI; see `demo-seed.compile-input.json`. | — |

## Running everything

```sh
npm install   # from the repo root; npm workspaces wires @bound/* together
for d in packages/snapshot integrations/ens integrations/swarm integrations/anon-rpc services/curator; do
  (cd $d && npm run typecheck && npm test)
done
```

All five packages typecheck clean and their unit/property tests pass with no network access —
that is Phase 1's "isolated tests pass from a clean checkout" gate for this lane. As of this
writing: 85 + 7 + 22 + 33 + 18 = 165 tests, 0 failures.

## What is NOT exercised above (and why)

Per plan §2: "Mocks are required for fast unit tests, but they do not satisfy the integration
gate. The required integrations must be exercised against their real supported test
environments before demo or release readiness." This sandbox's outbound network is restricted
to the npm registry and GitHub — direct RPC, Swarm gateway, and Arkiv-RPC calls are blocked
here (confirmed by hand before building any of this). So every real-network code path in this
lane (ENS reads/writes, Swarm upload/fetch, the actual anon-rpc worker boot) is:

1. Built against the **real, verified** contract addresses/ABIs, package versions, and
   protocol constants — never invented. Where something was hand-recalled and then checked
   against an independent computation (e.g. the EIP-1967 slot constants, a CREATE-address
   known-answer vector), the check caught a real transposed digit before it shipped; see the
   docstrings in `integrations/anon-rpc/src/chain-facts.ts` and `packages/snapshot/test/lineage.test.ts`.
2. Unit-tested with a mocked `fetch`/provider for every branch that doesn't require an actual
   live endpoint (budget expiry, gateway disagreement, malformed responses, role-check logic,
   env-var validation, etc.).
3. Left to the **Phase 0 probe scripts** below for the parts that genuinely need a live
   testnet, a running Bee node, or a real browser — run those yourself with your own
   credentials and record the results in the Phase 0 evidence log.

## Phase 0 probe scripts (`services/curator/probe/`)

Plan §5, Developer 2's Phase 0 responsibilities, one script each, each scoped to finish
"within one hour" (plan §5):

| Script | Proves | Needs |
|---|---|---|
| `probe-ens.ts` | ENSv2 Sepolia reachability; curator holds `ROLE_SET_TEXT` on the pinned resolver's root key; publish→read-back round trip on a disposable epoch; an unauthorized key **cannot** write the root key. | `BOUND_SEPOLIA_RPC_URL`, `BOUND_CURATOR_PRIVATE_KEY`, `BOUND_ROOT_NAME` (a disposable test name — never the live demo root), optionally `BOUND_UNAUTHORIZED_PRIVATE_KEY` |
| `probe-swarm.ts` | Postage batch usability; upload + self-verified read-back on the curator's own Bee node; read-back agreement across ≥2 independent gateways (the "second gateway" requirement). | `BOUND_BEE_API_URL`, `BOUND_POSTAGE_BATCH_ID`, `BOUND_SWARM_GATEWAYS` (comma-separated, ≥2) |
| `probe-anon-rpc.ts` | The chosen worker (`nox`, Sepolia) is a genuinely anonymizing (`kind: "network"`) worker, not a passthrough reference, and its specifier contract is real deployed bytecode on the chain BOUND targets. **This is only half the gate** — it explicitly does not and cannot prove the harness boots (needs a DOM); see below. | `BOUND_SEPOLIA_RPC_URL` |

Run each with `node --experimental-strip-types probe/probe-<name>.ts` from `services/curator/`.

**The Anon-RPC gate has a second half that is not a Node script at all:**
`integrations/anon-rpc/probe-extension/` is a real, loadable MV3 extension that boots `nox`
and makes one actual anonymized `eth_chainId` call. Plan §5 is explicit that "a standalone
worker probe alone does not pass" — both `probe-anon-rpc.ts` and the browser extension must
be run and their results recorded before this gate is marked passed.

## The curator CLI (`@bound/curator`)

```sh
# 1. compile — pure, offline, no credentials needed
node --experimental-strip-types src/cli.ts compile <input.json> <out-prefix>
#   writes <out-prefix>.bin (canonical bytes to publish) and <out-prefix>.json (metadata)

# 2. publish — needs BOUND_SEPOLIA_RPC_URL, BOUND_CURATOR_PRIVATE_KEY, BOUND_ROOT_NAME,
#    BOUND_BEE_API_URL, BOUND_POSTAGE_BATCH_ID, BOUND_SWARM_GATEWAYS (see env.ts for exact names)
node --experimental-strip-types src/cli.ts publish <out-prefix>.bin

# 3. read — read-only verification of whatever is currently live
node --experimental-strip-types src/cli.ts read
```

`publish` refuses to publish an epoch that is not strictly greater than the **live** root's
current epoch (plan §5 Phase 1 gate, verbatim: "Make the curator CLI refuse an epoch less
than or equal to the published epoch") — see `src/publish.ts` and
`@bound/snapshot`'s `assertMonotonicEpoch`. It reads the live root fresh on every call rather
than trusting a locally cached "last epoch," so a rollback attempt is judged against reality,
not against whatever the curator's own machine last remembered.

Try the sample input first:

```sh
node --experimental-strip-types src/cli.ts compile ../../fixtures/snapshots/demo-seed.compile-input.json /tmp/demo-seed
```

## Unresolved limitations (plan §4.8: submitted here, not edited into the shared README)

- **Live network verification is not run in CI from this environment.** Every real-network
  path above is built and typed against the real, verified contract surface, but the actual
  network calls were never executed here — the sandbox this was built in cannot reach them.
  Running all three probe scripts plus the probe extension, against real Sepolia/Bee/gateway
  endpoints, is required before any Phase 0 gate in this lane can be marked passed.
- **Protocol self-attestation write path is implemented but not demonstrated with a second,
  independent key.** `publishAttestation()` exists and is typed correctly, but proving "the
  protocol's own key, not the curator, controls the attestation" (plan §7) needs a second real
  test account exercising it — `probe-ens.ts` step 7 documents this as still open.
- **ENS resolver re-pointing (`bindResolverToLabel`-style helper) was deliberately not
  written.** The registrar's `finishRegistration()` sets the resolver correctly at
  registration time, which covers BOUND's actual need; a later re-point would need the
  `anyId` parameter's semantics verified against the live contract first, not guessed from
  the bare ABI signature — see the comment in `integrations/ens/src/registrar.ts`.
- **Swarm postage funding/lifetime and Bee node operation are out of this lane's code** —
  `assertUsablePostageBatch()` checks a batch is usable, but provisioning one (buying postage,
  running a Bee node) is an operational task for whoever runs Phase 0, not something this
  package automates.

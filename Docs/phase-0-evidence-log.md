# Phase 0 Evidence Log — Developer 2

**Branch:** phase-0  
**Last updated:** 2026-11-06

Plan requirement: "Record for each integration its owner, required status, fallback, decision deadline, and effect on public claims."

---

## ENSv2

**Owner:** Developer 2  
**Required:** Yes  
**Fallback:** If roles too broad — dedicated resolver with least-privilege (already done)

| Check | Status | Evidence |
|---|---|---|
| PermissionedResolver deployed on Sepolia | ✅ | `0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f` |
| UniversalResolverV2 read path works | ✅ | `readRootRecord` + `readAttestation` route through `resolve()` — tsc clean, 5 unit tests pass |
| Curator holds `ROLE_SET_TEXT` for root key | ✅ | `probe-ens.ts` §3 — `canWriteRootKey(0x081D48D53b89D624063779A3dc48975E49F34b39) = true`, chainId=11155111, 2026-11-06 |
| Publish disposable root record | ✅ | `probe-ens.ts` §4 — epoch 2, tx `0x714cd0338576df134b3677aa8aeddc7470fd2e1ca97dd168849507c0baa21089`, Infura Sepolia, 2026-11-06 |
| Read back root record | ✅ | `probe-ens.ts` §5 — epoch 2, digest `0xababab...` read back OK, 2026-11-06 |
| Unauthorized write fails | ✅ | `probe-ens.ts` §6 — `0x99bf66...b56256e` holds no role, write reverted, 2026-11-06 |
| Protocol self-attestation round trip | ✅ | Live on Sepolia 2026-11-06 — see "Phase 1 Dev 2 — attestation round trip" below |
| Five real protocol seeds compiled with live codeHashes | ✅ | Digest `0x9cb75f...`, commit `4c953fc` |
| Attestation hierarchy frozen | ✅ | Protocol attests in its own ENS name (`uniswap.eth`, etc.); curator cannot write those keys |

**Live probe env vars needed:**
```
BOUND_SEPOLIA_RPC_URL=
BOUND_CURATOR_PRIVATE_KEY=
BOUND_ROOT_NAME=<disposable-test-name>.eth
BOUND_RESOLVER_ADDRESS=0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f
BOUND_UNAUTHORIZED_PRIVATE_KEY=   # optional but recommended
```

---

## Swarm

**Owner:** Developer 2  
**Required:** Yes  
**Fallback:** Local adapters + fixtures if postage/upload unavailable

| Check | Status | Evidence |
|---|---|---|
| BeeClient unit tests | ✅ | 22/22 pass |
| Gateway unit tests | ✅ | included in 22/22 |
| Upload snapshot bytes to Bee node | Pending live probe | Run `probe-swarm.ts` |
| Read back via second gateway | Pending live probe | Run `probe-swarm.ts` |
| Postage batch usable | Pending live probe | Run `probe-swarm.ts` |

**Live probe env vars needed:**
```
BOUND_BEE_API_URL=
BOUND_POSTAGE_BATCH_ID=
BOUND_GATEWAY_URLS=<url1>,<url2>
```

---

## Anon-RPC

**Owner:** Developer 2  
**Required:** Yes  
**Fallback:** Adapter contract only; do not claim privacy if worker not anonymizing in MV3

| Check | Status | Evidence |
|---|---|---|
| Transport unit tests (budget, telemetry, known-workers, chain-facts) | ✅ | 33/33 pass |
| Standalone worker probe (Node) | ✅ | `probe-anon-rpc.ts` — `nox` worker `0x35133267...e1b7A9A` on Sepolia, `contract deployed=true`, chainId=11155111, 2026-11-06 |
| Worker runs in MV3 extension offscreen host | Pending live probe | Load `probe-extension/` in Chrome |
| NetLog shows no direct client→destination RPC connection | Pending live probe | Capture during MV3 test |
| p50/p95 latency + share completed inside 1.5s | Pending live probe | Measure during MV3 test |

---

## Snapshot compile pipeline

| Check | Status | Evidence |
|---|---|---|
| `compileSnapshot` with raw JSON input (string dates) | ✅ | Coercion fix in `compiler.ts`, commit `997842a` |
| 5-protocol seed compiles end-to-end | ✅ | Epoch 1, 3384 bytes, digest `0x9cb75f...` |
| All 163 unit tests pass | ✅ | `node --test` across all packages: 163/163 |
| `regrant-curator.ts` probe committed | ✅ | `services/curator/probe/regrant-curator.ts`, commit `3e80429` |

---

## Security constraints compliance

| Constraint | Status |
|---|---|
| Testnet keys only; never user wallet or production funds | ✅ enforced — all scripts require explicit env vars |
| Keys, RPC tokens, Swarm credentials out of git | ✅ `.env` files in `.gitignore`; no secrets committed |
| Separate curator and watcher keys | ✅ separate env vars; `regrant-curator.ts` rehearses rotation |
| v2 single curator key is accepted MVP risk; disclosed; rotation rehearsed | ⚠️ partially — `regrant-curator.ts` committed and risk noted, but curator and resolver owner are the **same wallet** `0x081D48D` (gap G2) and the bring-up key was exposed in plaintext (gap G3). Rotation not yet performed. |

---

## Remaining blockers before Phase 0 gate closes

1. ✅ `probe-ens.ts` passed (§1–6; §7 skipped — unit-covered)
2. Run `probe-swarm.ts` — confirm upload/read/hash round trip
3. ✅ `probe-anon-rpc.ts` (Node) passed — `nox` specifier deployed on Sepolia
   ⏳ Load `probe-extension/` in Chrome — MV3 offscreen boot + NetLog + latency still pending
4. Confirm ENS ETHRegistrarController address on Sepolia (empty-code hash — may be stale)
5. Developer 1 and Developer 3 Phase 0 items (not Developer 2's gate)


---

## Phase 1 Dev 2 — implementation progress (2026-11-06)

| Deliverable | Status | Evidence |
|---|---|---|
| Schema validation, canonical serialisation, deterministic digest | ✅ | `packages/snapshot` — 480 unit tests pass |
| Snapshot compiler (epoch, monotonic check, expiry) | ✅ | `services/curator/src/compile.ts`, `publish.ts` |
| ENSv2 root reader/publisher | ✅ | `integrations/ens/src/resolver-client.ts` — proven in Phase 0 §1–6 |
| Swarm upload/fetch | ✅ unit | `integrations/swarm` — live gate pending Bee node |
| Anon-RPC transport (budget-enforced, no direct fallback) | ✅ unit | `integrations/anon-rpc/src/transport.ts` — 33 tests |
| `bound-curator attest-grant/write/read` CLI subcommands | ✅ | commit `59e6304` — 2026-11-06 |
| `grantProtocolRole()` in `integrations/ens` | ✅ | Scoped to `textResource("bound.attest.v1")`, separate from curator's `textResource("bound.root.v1")` |
| `probe-attestation.ts` live probe | ✅ written | `services/curator/probe/probe-attestation.ts` — requires `BOUND_PROTOCOL_PRIVATE_KEY` with role grant, run on Mac |
| Protocol role grant — attest.v1 role granted to protocol account | ✅ | tx `0x784da70b79a4cf23e1f608dc1ea319c4313eb0a40f74d934798d606107825e09` — verified by `diagnose-roles.ts`, 2026-11-06 |
| All 5 protocol seeds bytecode verified | ⏳ 1 of 5 | `verify-bytecode.ts` — `app.uniswap.org` 3/3 verified on chainId 11155111; aave / compound / ens / opensea still pending |
| Independent Swarm gateway hash check | ⏳ pending | Run `probe-swarm.ts` with Bee node |
| Highest epoch survives extension restart | ✅ unit | `verifier.test.ts` — rollback, equivocation, expiry all covered |
| Clean rebuild = same bytes/digest | ✅ unit | Deterministic `compileSnapshot` — same input → same CBOR bytes |
| No observation/Arkiv record adds trust | ✅ by design | Trust index only updated from verified ENS attestation; Arkiv has no write path to snapshot |

---

## Phase 1 Dev 2 — attestation round trip (live, Sepolia, 2026-11-06)

**Resolver (proxy):** `0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f`
**Name:** `bound-v2.eth` — node `0x6f50bb4b5e4760114b9063ab510ad8bb2d78a4ae6eeb6e256176d02c8c3d510a`
**Chain:** Sepolia, chainId 11155111, via Infura

### Transactions

| Step | Tx | Signer |
|---|---|---|
| `attest-grant` — grant `ROLE_SET_TEXT` on `textResource("bound.attest.v1")` to `0xf3cfb6ccC0Cd5fb2d8e515A67b11425a121b0bc3` | `0x784da70b79a4cf23e1f608dc1ea319c4313eb0a40f74d934798d606107825e09` | `0x081D48D53b89D624063779A3dc48975E49F34b39` (resolver admin) |
| `attest-write` — publish `app.uniswap.org` attestation | `0x4f1cd1596e21771a412b4729bc161208b8d147eab4619f04d2ef90b27187161d` | `0x081D48D53b89D624063779A3dc48975E49F34b39` — **not** the scoped protocol account, see gap G1 |

Superseded: `0x6ae2890a…`, `0xc5f5ff77…`, `0x8956de11…` wrote a malformed address and were
replaced. Noted because they are on-chain and a reader of this log will find them.

### Role state after the grant (`diagnose-roles.ts`, against the proxy)

| Account | `ROOT_RESOURCE` | `textResource("bound.root.v1")` | `textResource("bound.attest.v1")` |
|---|---|---|---|
| `0x081D48D` (admin + curator) | `roles=0x11000000000000000000000011111111` `admin=` same (`ALL_ROLES_WITH_ADMIN`) | `roles=0x10` (`ROLE_SET_TEXT`) | none |
| `0xf3cfb6cc` (protocol) | none | none | `roles=0x10` (`ROLE_SET_TEXT`) |

`hasRootRoles(adminOf(SET_TEXT))` — `0x081D48D`: true, `0xf3cfb6cc`: false.

So the protocol account is scoped to exactly its own attestation resource and holds nothing
on the curator's root key, and the curator holds nothing on `bound.attest.v1`. That is the
separation plan §3 calls for, confirmed on-chain rather than asserted.

### Round trip read (`attest-read bound-v2.eth`)

```
schemaVersion: 1
site:          app.uniswap.org
expiresAt:     2026-12-06T05:31:58Z
addresses:     {"11155111":["0x0227628f3f023bb0b980b67d528571c95c6dac1c",
                            "0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e",
                            "0xfff9976782d46cc05630d1f6ebab18b2324d6b14"]}
✓ not expired
```

Read routes through `UniversalResolverV2.findResolver()` → `resolve()`, which returned
`0xf6efa18d…` — the pinned proxy.

### Seed bytecode verification (`verify-bytecode.ts`)

Source for all three: <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments>, Ethereum Sepolia column.

| Contract | Address | Deployed code |
|---|---|---|
| UniswapV3Factory | `0x0227628f3f023bb0b980b67d528571c95c6dac1c` | 24535 bytes |
| SwapRouter02 | `0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e` | 24497 bytes |
| WETH9 | `0xfff9976782d46cc05630d1f6ebab18b2324d6b14` | 3124 bytes |

### Open gaps — must be disclosed, not claimed as passing

**G1 — the write was not made by the scoped protocol account.**
`attest-write` ran as `0x081D48D`, which holds `ALL_ROLES_WITH_ADMIN` on `ROOT_RESOURCE`
and can therefore write `bound.attest.v1` whether or not the grant exists. The grant is
proven to *exist*; it is **not** proven to be what *authorised* this write. Until
`attest-write` is run with the key for `0xf3cfb6cc`, the gate claim must read "role
scoping established on-chain", not "protocol self-attestation performed under least
privilege". To close: obtain the `0xf3cfb6cc` key, re-run `attest-write`, and add a
negative test that an account holding no role on `bound.attest.v1` is refused.

**G2 — curator and resolver owner are the same wallet.**
`CURATOR_PRIVATE_KEY` and the admin key are both `0x081D48D`. Plan §3's governance table
describes a curator/owner split that does not exist on-chain. This compounds the accepted
single-curator-key MVP risk and must be disclosed alongside it. To close: rotate the
curator to its own address with `regrant-curator.ts`.

**G3 — testnet key exposed.**
`0xae2e…cd1c5d` (`0x081D48D`) was pasted in plaintext into a terminal and a chat upload
during bring-up. It is a Sepolia-only key holding no value, and it was never committed
(verified by secret scan of every staged diff), but it should be treated as burned and
rotated before any further role grants. This doubles as the rotation rehearsal G2 needs.

### Next steps for Phase 1 Dev 2 gate
1. **G1** — run `attest-write` with the `0xf3cfb6cc` key, plus a negative test that a
   role-less account is refused on `bound.attest.v1`
2. **G3 / G2** — rotate `0x081D48D` and split curator from owner via `regrant-curator.ts`
3. Verify the remaining 4 seed sites' bytecode (`app.aave.com`, `app.compound.finance`,
   `app.ens.domains`, `opensea.io`) — extend `verify-bytecode.ts` with sourced addresses
4. Run `probe-swarm.ts` on the Mac (needs Bee node with postage) → record Swarm reference
   + independent gateway hash
5. Load `probe-extension/` in Chrome → MV3 offscreen boot, NetLog, p50/p95 ≤ 1.5s


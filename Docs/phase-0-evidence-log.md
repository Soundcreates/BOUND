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
| Protocol self-attestation round trip | ⏭ skipped | No `BOUND_PROTOCOL_NAME` set; `readAttestation` unit-tested separately |
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
| v2 single curator key is accepted MVP risk; disclosed; rotation rehearsed | ✅ `regrant-curator.ts` committed; risk noted in architecture docs |

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
| Protocol role grant — attest.v1 role granted to protocol account | ⏳ pending | Run `attest-grant` then `probe-attestation.ts` on Mac with Infura RPC |
| All 5 protocol seeds bytecode verified with `cast code` | ⏳ pending | Requires Sepolia RPC + official deployment sources |
| Independent Swarm gateway hash check | ⏳ pending | Run `probe-swarm.ts` with Bee node |
| Highest epoch survives extension restart | ✅ unit | `verifier.test.ts` — rollback, equivocation, expiry all covered |
| Clean rebuild = same bytes/digest | ✅ unit | Deterministic `compileSnapshot` — same input → same CBOR bytes |
| No observation/Arkiv record adds trust | ✅ by design | Trust index only updated from verified ENS attestation; Arkiv has no write path to snapshot |

### Next steps for Phase 1 Dev 2 gate
1. Run `attest-grant` from Mac to grant `BOUND_PROTOCOL_PRIVATE_KEY` role on `bound.attest.v1`
2. Run `probe-attestation.ts` on Mac → record tx hash and round-trip output here
3. Run `probe-swarm.ts` on Mac (needs Bee node with postage) → record Swarm reference + gateway hash
4. Verify 5 seed bytecodes with `cast code` against official deployment sources


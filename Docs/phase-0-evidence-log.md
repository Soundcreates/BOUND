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
| PermissionedResolver deployed on Sepolia | ✅ | `0xc405306d78707eda003bcef387a8277ab5dc36a9` |
| UniversalResolverV2 read path works | ✅ | `readRootRecord` + `readAttestation` route through `resolve()` — tsc clean, 5 unit tests pass |
| Curator holds `ROLE_SET_TEXT` for root key | Pending live probe | Run `probe-ens.ts` §3 |
| Publish disposable root record | Pending live probe | Run `probe-ens.ts` §4 |
| Read back root record | Pending live probe | Run `probe-ens.ts` §5 |
| Unauthorized write fails | Pending live probe | Run `probe-ens.ts` §6 |
| Protocol self-attestation round trip | Pending live probe | Run `probe-ens.ts` §7 |
| Five real protocol seeds compiled with live codeHashes | ✅ | Digest `0x9cb75f...`, commit `4c953fc` |
| Attestation hierarchy frozen | ✅ | Protocol attests in its own ENS name (`uniswap.eth`, etc.); curator cannot write those keys |

**Live probe env vars needed:**
```
BOUND_SEPOLIA_RPC_URL=
BOUND_CURATOR_PRIVATE_KEY=
BOUND_ROOT_NAME=<disposable-test-name>.eth
BOUND_RESOLVER_ADDRESS=0xc405306d78707eda003bcef387a8277ab5dc36a9
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
| Standalone worker probe (Node) | Pending live probe | Run `probe-anon-rpc.ts` |
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

1. Run `probe-ens.ts` on Sepolia — confirm all 7 sections pass
2. Run `probe-swarm.ts` — confirm upload/read/hash round trip
3. Run `probe-anon-rpc.ts` (Node) + load `probe-extension/` in Chrome — confirm MV3 path
4. Confirm ENS ETHRegistrarController address on Sepolia (empty-code hash — may be stale)
5. Developer 1 and Developer 3 Phase 0 items (not Developer 2's gate)


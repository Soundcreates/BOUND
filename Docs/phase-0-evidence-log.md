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
| BeeClient unit tests | ✅ | now 26/26 (4 added for the host-stamped path) |
| Gateway unit tests | ✅ | included |
| Upload snapshot bytes | ✅ live | `probe-swarm-gateway.ts` 2026-11-06 — no node, no postage batch |
| Read back, byte-compared | ✅ live | round trip MATCH on sha256 |
| Two distinct origins agree | ⚠️ live, same operator | mechanism proven; independence **not** proven — see below |
| Postage batch usable | n/a — not used | gateway stamps with its own batch |

### Live Swarm round trip (`probe-swarm-gateway.ts`, 2026-11-06)

Run from an unrestricted machine: this repo's sandbox and the desktop VM are both
proxy-blocked (403 at CONNECT) for `*.ethswarm.org` and Infura.

| Step | Result |
|---|---|
| `POST /bytes`, no stamp headers | **201** — reference `dd187ff794bb9d574d88bebc06b8150c6b57c52f2cbc36663f139a4fd5f6cc32` |
| `GET /bytes/<ref>` on api.gateway | 200, 3384 bytes, sha256 **MATCH** |
| `uploadAndSelfVerify` + `stampedByHost` | ✅ `55e70eb6e42837471b18b0d3552108c84d8d3ec339d0bf165819e2862e3b7244`, canonical ref |
| `fetchFromGateways` across 2 origins, `minAgree: 2` | ✅ 3384 bytes, **MATCH** |

The last two rows matter more than the first two: they run `@bound/integrations-swarm`,
which is the code `publishSnapshot` and the extension's `fetchSnapshot` actually call. The
first two only characterise the gateway.

**Two traps confirmed, not assumed:**

- `gateway.ethswarm.org` (the **web** host) answered **200 with 960 bytes for an all-zeros
  reference that was never uploaded** — byte-for-byte the same shape as the real response.
  A hash check against that host proves nothing. Only `api.gateway`/`download.gateway`
  `/bytes` paths are usable.
- `/bzz/<ref>` served the raw upload with 200, contradicting the documented
  manifests-only behaviour. Nothing depends on it — the extension reads `/bytes` — but the
  probe keeps checking so a change gets noticed.

**What this does NOT show.** `api.gateway.ethswarm.org`, `download.gateway.ethswarm.org`
and `bzz.link` are all operated by ethswarm.org and are blocked and unblocked together.
Two of them agreeing demonstrates the two-origin *mechanism* in
`trust-engine.mjs:fetchSnapshot`; it does not demonstrate operator independence, which is
what plan §5's "an independent Swarm gateway returns bytes whose digest matches" asks for.
`dev1-test-guide.md` is explicit that a pass elsewhere does not substitute for this case.
Closing it needs a gateway run by someone else, or our own Bee node for the second read.

**Accepted limitation — persistence.** A gateway-stamped upload sits on *the gateway's*
postage batch. We cannot renew it and cannot prevent its collection, so a published root
can in principle outlive its snapshot bytes. Integrity is unaffected: the root record's
digest is what makes served bytes unforgeable, so what is given up is availability, never
trust. The extension already fails closed on this — `fetchSnapshot` throws, and `read()`
falls back to a cached snapshot only while unexpired, else surfaces the error.

**No env vars needed for the free path.** `BOUND_BEE_API_URL` and
`BOUND_POSTAGE_BATCH_ID` are now optional and must be set together; leaving both unset
selects an unstamped gateway upload. `BOUND_SWARM_GATEWAYS` (≥2, distinct origins) is
still required, and `BOUND_SWARM_UPLOAD_URL` optionally overrides the upload host.

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
2. ✅ Swarm upload/read/hash round trip passed — `probe-swarm-gateway.ts` plus a live
   `publish`/`read` at epoch 3. Done through a public gateway rather than our own Bee
   node and postage batch; the two-origin read is same-operator, so independence is
   disclosed as unmet (see the Swarm section).
3. ✅ `probe-anon-rpc.ts` (Node) passed — `nox` specifier deployed on Sepolia
   ⏳ Load `probe-extension/` in Chrome — MV3 offscreen boot + NetLog + latency still pending
4. ✅ Resolved — the empty-code address was removed from the seed and replaced with three
   measured ENSv2 Sepolia contracts; 11/11 seed entries now verify
5. Developer 1 and Developer 3 Phase 0 items (not Developer 2's gate)


---

## Phase 1 Dev 2 — implementation progress (2026-11-06)

| Deliverable | Status | Evidence |
|---|---|---|
| Schema validation, canonical serialisation, deterministic digest | ✅ | `packages/snapshot` — 480 unit tests pass |
| Snapshot compiler (epoch, monotonic check, expiry) | ✅ | `services/curator/src/compile.ts`, `publish.ts` |
| ENSv2 root reader/publisher | ✅ | `integrations/ens/src/resolver-client.ts` — proven in Phase 0 §1–6 |
| Swarm upload/fetch | ✅ live | epoch-3 publish + `read`; bytes public at `/bytes/39676f98…9e0d`, 3898 B via plain `curl` |
| Anon-RPC transport (budget-enforced, no direct fallback) | ✅ unit | `integrations/anon-rpc/src/transport.ts` — 33 tests |
| `bound-curator attest-grant/write/read` CLI subcommands | ✅ | commit `59e6304` — 2026-11-06 |
| `grantProtocolRole()` in `integrations/ens` | ✅ | Scoped to `textResource("bound.attest.v1")`, separate from curator's `textResource("bound.root.v1")` |
| `probe-attestation.ts` live probe | ✅ written | `services/curator/probe/probe-attestation.ts` — requires `BOUND_PROTOCOL_PRIVATE_KEY` with role grant, run on Mac |
| Protocol role grant — attest.v1 role granted to protocol account | ✅ | tx `0x784da70b79a4cf23e1f608dc1ea319c4313eb0a40f74d934798d606107825e09` — verified by `diagnose-roles.ts`, 2026-11-06 |
| All 5 protocol seeds bytecode verified | ✅ 11/11 | `npm run probe:verify-bytecode` — 0 mismatched, 0 with no code, 0 without evidence, chainId 11155111 |
| Independent Swarm gateway hash check | ⚠️ mechanism only | Two distinct origins agree byte-for-byte, but both are ethswarm.org-operated — operator independence **not** shown |
| Highest epoch survives extension restart | ✅ unit | `verifier.test.ts` — rollback, equivocation, expiry all covered |
| Clean rebuild = same bytes/digest | ✅ live | Two clean compiles byte-identical, and the published root carries that same digest `0x88ae5988…ba6b` |
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

### Seed bytecode verification (`npm run probe:verify-bytecode`, 2026-11-06)

**11 verified, 0 mismatched, 0 with no code, 0 without recorded evidence (of 11 entries).**
Closes the Phase 1 Dev 2 gate line "verify all five protocol seeds from official
deployment sources; check contract bytecode and retain source URL, chain, and deployment
provenance." Every address is sourced from the protocol's own deployment page and every
`codeHash` is measured on Sepolia, never transcribed from the page.

| Site | Address | Code | Source |
|---|---|---|---|
| app.uniswap.org | `0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e` | 24497 B | docs.uniswap.org v3 deployments |
| app.uniswap.org | `0x000000000022d473030f116ddee9f6b43ac78ba3` | 9152 B | docs.uniswap.org permit2 |
| app.aave.com | `0x6ae43d3271ff6888e7fc43fd7321a503ff738951` | 2333 B | docs.aave.com v3 testnet |
| app.aave.com | `0x012bac54348c0e635dcac9d5fb99f06f24136c9a` | 9779 B | docs.aave.com v3 testnet |
| app.compound.finance | `0xaec1f48e02cfb822be958b68c7957156eb3f0b6e` | 1878 B | docs.compound.finance |
| app.ens.domains | `0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e` | 3174 B | docs.ens.domains (legacy ENSv1 Registry — live, but ENS marks the set no longer in use) |
| app.ens.domains | `0x4a4c8b7cdab6b19dc2cdb417cdb53a2ccbaf5322` | 2196 B | docs.ens.domains ENSv2 — BatchRegistrar |
| app.ens.domains | `0xdc4a563d00f5c3012b699794eb9e13a561be386f` | 14327 B | docs.ens.domains ENSv2 — PublicResolverV2 |
| app.ens.domains | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` | 8037 B | docs.ens.domains ENSv2 — ETHRegistrar |
| opensea.io | `0x00000000000000adc04c56bf30ac9d3c0aaf14dc` | 24367 B | docs.opensea.io seaport |
| shared | `0x000000000022d473030f116ddee9f6b43ac78ba3` | 9152 B | docs.uniswap.org permit2 |

**A bug this caught.** The seed previously vouched for
`0xfed6a969aaa60e4961fcd3ebf1a2e8913ac65b16` under app.ens.domains — an address with
**nothing deployed at it**. Its recorded `codeHash` was `keccak256("")`, a perfectly
valid-looking 32-byte value, so the entry passed every check that compared a recorded hash
to an actual one. `verify-bytecode.ts` now tests emptiness *before* comparing hashes, which
is the only ordering that catches it. `seed-codehash.ts` refuses to emit a hash for an
empty address, so the same entry cannot be reintroduced by tooling.

**Still a judgment call.** Which contracts a dapp actually *calls* is behavioural, and no
deployment page settles it. The ENSv2 three above are the plausible user-facing
transaction targets; confirming it means loading the extension against the live site and
observing the requests. Recorded here as unconfirmed rather than asserted.

### Snapshot compile (epoch 3)

| Property | Value |
|---|---|
| Digest | `0x88ae59882c453ec380342218716b1c5452caf4aaaadff660c157ad663ffeba6b` |
| Size | 3898 bytes |
| Reproducible | ✅ byte-identical across two clean runs |

Epoch is 3 because the live root sits at epoch 2 from the disposable probe record;
`assertMonotonicEpoch` refuses anything at or below the published epoch, so a compile at
the seed's original epoch 1 would have been rejected at publish time.

### First live snapshot publish — epoch 3, superseded (2026-11-06)

The full curator publish path, which had never run end to end before this. One command
does all three steps and each failure mode is distinct, so a problem names itself.

| Step | Value |
|---|---|
| Epoch | 3 (previous: 2) |
| Digest | `0x88ae59882c453ec380342218716b1c5452caf4aaaadff660c157ad663ffeba6b` |
| Swarm reference | `39676f980759bc0b9f6c8592a9a5f2be6b2bd3fa560ccb34d1e5e5288b289e0d` |
| ENS root tx | `0x904e2da49ee6cafae312415fe01c8d622c5e6e0f6fb1bfddc4a7324135f14956` |
| Size | 3898 bytes |
| Upload | unstamped `POST /bytes`, gateway-stamped — no Bee node, no postage batch, no xBZZ/xDAI |

The published digest equals the one computed by two independent local compiles, so the
reproducible-build gate holds across compile *and* publish rather than only across local
runs.

**Read-back verification (`curator read`).** This is the load-bearing step, not the
publish: it reads the live root from Sepolia, fetches the referenced bytes from both
configured gateways, requires them byte-identical, decodes, and checks the digest against
the root — rather than trusting what was just written.

```
live root verified — epoch 3, network sepolia
  digest:   0x88ae59882c453ec380342218716b1c5452caf4aaaadff660c157ad663ffeba6b
  swarmRef: 39676f980759bc0b9f6c8592a9a5f2be6b2bd3fa560ccb34d1e5e5288b289e0d
  sites:    5
  expires:  2026-12-06T00:00:00Z
```

Retrievable by anyone with no BOUND tooling — `curl` returns 3898 bytes:
`https://api.gateway.ethswarm.org/bytes/39676f980759bc0b9f6c8592a9a5f2be6b2bd3fa560ccb34d1e5e5288b289e0d`

**What this closes and what it does not.** It closes the gate's "clean rebuild produces the
same snapshot bytes and digest" and the Swarm half of the publish path. The
extension-side read — `readRoot` → `fetchSnapshot` → `checkSnapshot` in
`apps/extension/trust-engine.mjs` — has still never run against live data; until it does,
`apps/extension/PHASE0.md` stands: without a verified snapshot the evaluator shows grey.

**Key note.** This publish was signed by `0x081D48D`, the bring-up key that was pasted in
plaintext (G3) and should be treated as burned. It also remains both curator and resolver
owner (G2). Neither gap is closed by this publish succeeding, and the rotation still has
to happen before any grant that matters.

### Live root in use — epoch 4 (2026-11-06)

Epoch 3 above is **superseded and was never usable by the extension**: it was compiled with
`rootName: bound-demo.eth` and published to `bound-v2.eth`, and
`trust-engine.mjs:checkSnapshot` rejects a snapshot whose `rootName` differs from the name
the root was read from. `curator read` reported it verified because it compared only digest
and epoch. Both holes are closed — `publishSnapshot` refuses the mismatch before spending
gas, and `readAndVerifyRoot` now checks network, rootName and generatedAt as well.

| Step | Value |
|---|---|
| Epoch | 4 (previous: 3) |
| Digest | `0x2a691b30fc842b6b567204eb73e413c9c0566d014172375ca209f13073ddf6f1` |
| Swarm reference | `ff58c62ec34c8ab19c6fbc71587abbd9bf98ae18d87e7782fef88c868d1f6550` |
| ENS root tx | `0x34a43bdfc84d602b1e51335f2395f6abbba1252288d455c0a7c6d6acc07f81bb` |
| Size | 3896 bytes |
| Sites | 5 |
| Expires | 2026-12-06T00:00:00Z |
| rootName | `bound-v2.eth` — matches the publishing name |

Verified by the strengthened `curator read`, which performs every check
`checkSnapshot` performs except the cache-specific ones. The extension will therefore
accept these bytes.

**A receipt race found here.** The first `read` after the epoch-4 publish failed with the
rootName error, naming epoch 3's data. Nothing was wrong with epoch 4: `writeContract`
resolves when a transaction enters the mempool, not when it is mined, so the read resolved
the still-live epoch-3 root. Every value in that error was real and one epoch stale, which
is the most confusing shape a failure can take. `publishSnapshot` now waits for the receipt
and raises on a revert.

This was the **third** occurrence of that race: `attest-write` (05a3891) and `attest-grant`
(9513545) both had it and were both fixed in the CLI, which did nothing for the publish
path. The fix now sits in the library. The recurring lesson across this and two other bugs
today — the resolver default and the rootName binding — is that fixing an instance in a
caller leaves identical siblings live; the guards that have held are the ones pushed down
into `integrations/*` and `publishSnapshot`.

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
3. ✅ Done — 11/11 seed entries verified across all five sites
4. ✅ Done — snapshot published and read back at epoch 3. Remaining: a genuinely
   third-party gateway, or our own Bee node for the second read, to close the
   independence half
5. Load `probe-extension/` in Chrome → MV3 offscreen boot, NetLog, p50/p95 ≤ 1.5s
6. Load `apps/extension/dist` unpacked and point it at the live root — the extension side
   of `readRoot` → `fetchSnapshot` → `checkSnapshot` has still never run against live data


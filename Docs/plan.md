# BOUND implementation plan

**Purpose:** turn the project architecture into a three-developer implementation plan with independent work lanes, explicit phase gates, and live end-to-end proof for every required integration.

**Architecture basis:** BOUND Final Architecture v2.0. At plan creation, the repository contained only the two architecture documents. Since then, Developer 3 has added the workspace and executable contract package, a durable watcher and incident pipeline, Arkiv read/write composition, and local integration harnesses. The current local suite exercises those paths with fakes. The live Arkiv create/patch/expiry gate now passes; the browser extension, ENSv2, Swarm, Anon-RPC, and controlled DNS/TLS drift remain unverified in this checkout. Treat architecture claims as design input until executable evidence is present here.

**Phase status (2026-11-06): Phase 0 remains open.** Local unit tests exercise the Developer 3 implementation, and the live Rabdi Arkiv create, patch, owner-query, and expiry checks passed; evidence is in `shared/contracts/feasibility.md`. Controlled DNS/TLS drift still requires an end-to-end cutover. Developer 1 and 2 browser, ENSv2, Swarm, and Anon-RPC gates remain outstanding. No later phase is accepted as complete until every shared exit gate below is evidenced.

## 1. Source of truth and current baseline

Read these documents before taking a task:

- **BOUND_Final_Architecture.md** — current product scope and architecture. Its header explicitly says it supersedes the v1.0 proposal and Witness design.
- **BOUND_Technical_Architecture_and_Security_Whitepaper.md** — useful threat-model detail, interfaces, and test ideas. Its older architecture includes features cut from v2.

Use v2 for scope where the documents disagree. In particular, the MVP does not include the Safe Mode recovery application, a PolicyAnchor contract or guardian freeze, an ERC-7730 importer and Arkiv descriptor mirror as its data layer, Semaphore witnesses, transaction simulation, or a broad crawler. The older whitepaper treats ERC-7730 as candidate evidence, not authority; preserve that distinction if an importer is added later. Do not implement cut v1 features unless the project owner revises scope.

The v2 document says a decoder and hook already have 113 passing checks, but neither source files nor tests are present in this checkout. Recreate or recover those test cases and prove them here; if the original files are unavailable, update the architecture's prototype claims before submission.

## 2. Product goal and boundaries

Build a Chromium MV3 extension that compares a mediated wallet request with a curator-controlled, chain-specific site policy, then explains the result in an extension-owned surface. Keep the trust snapshot separate from public, changing site observations. Use ENSv2 for the curator-controlled snapshot root, Swarm for immutable snapshot and incident-report bytes, Arkiv for expiring observations and status, and a real anonymizing Anon-RPC path for sensitive chain reads.

The product warns and leaves the decision with the user. It does not promise universal interception, transaction safety, or recovery of prior approvals. A page-side provider hook can be bypassed; report coverage honestly. A trusted contract may still be unsafe to call. Do not publish a user's wallet address, amount, transaction hash, browsing history, request digest, or override choice.

### Required MVP integrations

| Integration | What must work |
|---|---|
| Browser and wallet | MV3 extension mediates EIP-1193 request, send, and sendAsync paths where patching is possible; reports unsupported and bypass-possible states without a green verdict; warning UI is extension-owned. |
| Snapshot and ENSv2 | Curator publishes a new snapshot root, epoch, and Swarm reference through a real ENSv2 resolver role; extension reads and validates the live root. |
| Swarm | Snapshot and public incident report upload and read back through a second gateway; extension verifies the snapshot digest before trusting it. |
| Arkiv | Watcher writes observations, baseline, drift, incident, and status records; the extension queries live records and verifies writer ownership. Seeded trust never comes from Arkiv. |
| Anon-RPC | Sensitive chain lookups use an actually anonymizing worker by default. Capture network evidence. On timeout, proceed without those signals after the 1.5-second budget; never silently fall back to public RPC. |
| Watcher | Controlled-domain DNS and TLS drift is detected; incident thresholds and status propagation are exercised end to end. |

Mocks are required for fast unit tests, but they do not satisfy the integration gate. The required integrations must be exercised against their real supported test environments before demo or release readiness.

## 3. Fixed contracts for parallel work

All developers use these contracts from the start. Build local adapters or fakes where needed; do not wait for another lane's implementation.

### Trust snapshot

- Versioned JSON snapshot with schema version, monotonically increasing epoch, generated and expiry timestamps, defined network label, shared contracts by chain, and site entries keyed by canonical host then chain ID.
- A site-chain entry contains trusted counterparties, trusted called contracts, deployer lineage, and source evidence. It contains no user observations.
- Use lowercase address strings and sorted arrays; reject duplicate keys and unknown schema fields. Bound integer values to exactly representable JSON integers or encode them as decimal strings. Include vectors for IDNA hosts and non-default ports.
- The curator records provenance for every seeded address. For deployer lineage, store the onchain creation transaction/receipt and sender or factory evidence during offline curation; do not assume standard signing-time JSON-RPC exposes a deployer. If lineage cannot be independently established, omit it and leave the address untrusted.
- Canonicalize the snapshot bytes once and define a test vector. Use Keccak-256 of RFC 8785 canonical UTF-8 JSON as the root digest. The ENSv2 root stores the digest, epoch, and plain Swarm reference. Never hash a parsed object after a different serializer has changed its bytes.
- Prefer one versioned ENS text-record value containing digest, epoch, Swarm reference, network, and schema version so publication is one record update. If live ENSv2 constraints require multiple writes, publish a commit pointer last and make readers reject an incoherent tuple.
- Pin the ENS chain, name, resolver, and root-record key in extension configuration. Use HTTPS for root reads and require agreement from two independent RPC providers, or a pinned provider with the residual RPC trust disclosed. Default to a dedicated resolver; the curator receives only the scoped setter role, never resolver admin/upgrade/link roles.
- Require snapshot epoch to equal root epoch. Reject a digest mismatch, lower or conflicting same epoch, malformed schema, wrong network/name, or expired snapshot. Persist the highest fully validated epoch in extension storage, keyed by ENS chain/name/resolver/record; update it only after all checks pass. A restart must not permit rollback.
- On root/network failure, use a previously verified cached snapshot only while it remains unexpired. On hash mismatch, retain that prior snapshot only if current. With no current verified snapshot, show grey and do not grant trust.
- Canonical site identity is the extension-derived HTTPS host, IDNA-normalized and lowercase, with non-default port preserved. No suffix matching. Trust is always scoped to site and chain.

### Decision and coverage

The evaluator receives the immutable request bytes, extension-derived top-level host and requesting-frame origin, chain ID, signer accounts fetched from the captured provider at decision time, validated snapshot/root state, cached Arkiv baseline/status/corroborated drift, and available Anon-RPC facts with timeout state. Do not infer signer accounts from page parameters or provider events. Every signal that affects a verdict has an owner and a test; the secondary signals listed in §7 stay disabled until implemented.

Keep verdict and coverage separate. Verdict is green, amber, red, escalated, or grey. Request coverage is mediated or unsupported. The extension may show bypass_possible when it detects an unpatchable provider/frame, but a provider reference retained before injection or an unobserved wallet path cannot be detected reliably; disclose those limits rather than implying every bypass is reported. Only a mediated, evaluated request may display green.

Classify methods and payloads distinctly. Freeze the read-only method allowlist in Phase 0; include documented chain/account reads and already-signed eth_sendRawTransaction. Supported value-moving methods are decoded. Unknown method names are unsupported: no score, extension-owned warning, explicit user choice. Well-formed unknown ABI or typed-data payloads are opaque, not unsupported: inspect the called contract and bounded address scan, mark heuristic hits unverified, and let them lower the score only. A trusted called contract with no unverified hits may retain its normal score so common router calls can stay green. Any unverified hit caps at 65; unknown typed-data fields are capped at 65. Permit2 SignatureTransfer is always labeled destination-not-fixed and capped at 65. Truncated known selectors, invalid bytes, oversized/depth-bomb input, and decoder exceptions are malformed and capped at 35. One opaque/malformed call makes the whole EIP-5792 batch opaque/malformed and the strictest item cap applies. eth_sign scores zero/escalated; personal_sign carries no decoded counterparty. No class may become an unqualified pass.

The message path is MAIN-world hook → isolated relay → service worker → extension-owned warning window. The service worker creates a pending request ID and binds it to tab ID, frame/document ID, top-level origin, requesting-frame origin, method, frozen-payload digest, chain/account state, and expiry. Origins and browser identifiers come from extension sender/tab/navigation metadata, never from page fields. Continue/cancel is accepted once from the matching extension-origin warning UI only; forged, wrong-tab/frame, mismatched-payload, expired, or replayed decisions are rejected. Navigation, chain/account changes, disconnect, or service-worker restart invalidates the pending decision; an invalidated request is cancelled.

The MAIN/isolated bridge uses a random per-document channel ID, strict message source/origin checks, per-tab/frame pending maps, payload limits, request-rate limits, and deadlines. The page may create a wallet request, but it cannot supply trusted origin/context or fabricate a policy decision. MAIN-world code holds no governance secrets.

Trusted snapshot verification and policy evaluation belong in extension-controlled code. The MAIN hook captures the provider path and immutable request bytes; it must not accept an ALLOW value from a page-controlled message. If browser constraints force any scoring into MAIN, capture required intrinsics at document_start and use a null-prototype read-only allowlist; prove prototype poisoning cannot change a verdict. If the relay cannot pass that proof, report unsupported and do not claim the request is protected.

Only service-worker evaluation state keyed by request ID may create coverage records or observations. Page messages are always untrusted input and cannot directly create an ALLOW, green badge, or Arkiv report.

For a mediated request, deep-clone and freeze the exact request that is scored and forwarded. Refuse accessor-bearing or oversized input. Re-check chain and relevant account state before forwarding; invalidate a pending decision on chainChanged, accountsChanged, disconnect, or navigation. Cancel returns EIP-1193 code 4001. Keep the payload digest local; never publish it to Arkiv or the watcher.

Decode and tag all addresses as rights, destination, called contract, or token. Decode every call in an EIP-5792 batch; one undecodable item makes the batch opaque. Treat Permit2 signature-transfer destination as not fixed by the signature. Treat EIP-7702 delegate as rights; flag chainId zero. Decoder errors, malformed calldata, and unknown signing methods never become an unqualified pass. Never use JavaScript Number for uint256 values.

Keep the complete v2 score-cap rule: an untrusted rights-role address on a seeded site is capped at 35, or 15 with corroborated drift; an untrusted destination that is not the signer's own account is capped at 65; on an uncurated site, a witnessed untrusted address is capped at 65 and an unwitnessed one at 35, or 15 with corroborated drift. No baseline means grey. For mixed roles, use the most restrictive applicable cap. Only the four v2 trust sources can lift a cap: verified snapshot, protocol ENSv2 attestation, global shared-contract list, or trusted deployer lineage. Observations and witness counts never create trust or lift a cap. Starting thresholds are 70–100 green, 40–69 amber, 16–39 red, 0–15 escalated, and no baseline grey. Freeze a verdict matrix for seeded/uncurated, rights/destination, opaque/malformed, and mixed-role cases before integration. Include a false-hold fixture for a normal DEX flow. Keep weights and N/M/K values configurable and tune them against the five seeded sites; do not tune away a cap.

### Arkiv records and privacy

Use the v2 record kinds: observation, baseline, drift, incident, and status. Every query for watcher-owned data filters on the watcher's owner address and re-checks the returned owner. A schema tag, entity attribute, or self-asserted field is not authentication. Seeded trust is accepted only from the validated snapshot or explicit ENSv2 protocol attestation. Incident entities include the plain Swarm reference and report digest.

Download seeded baselines and statuses as one bundle on a timer. Route any per-site status read and uncurated-site query through Anon-RPC so the Arkiv RPC does not learn each site opened.

For the pre-Semaphore MVP, identify a reporter only with a rotating pseudonymous key. Deduplicate and rate-limit by reporter key/site/counterparty within a frozen counting window. Count distinct keys as a provisional abuse signal, not as proof of distinct people; Sybil resistance is explicitly absent, and these reports never lift a score cap. Freeze K and the report window before Phase 1. The two incident triggers are corroborated drift plus at least one warned report, or K distinct rotating reporter keys warning on the same counterparty without drift.

Emit a site-level warned event when a red warning opens, before the user chooses Continue or Cancel, and never include that choice. Keep warned events separate from normal baseline observations; an override still contributes no positive observation for that counterparty. Do not accept observations made during an active incident.

The extension sends only site, kind, value, chain, and rotating reporter key needed for a site-level observation, after random delay and batching. Drop any candidate value matching the user's active accounts, transaction from, or typed-data owner before publication. Do not send wallet, amount, transaction hash, request digest, override choice, or precise user timing. Arkiv data is public and the watcher may see the reporter's network IP; disclose that limit. For normal observations, send only the first sighting per site/counterparty plus a weekly refresh, and queue/retry locally if the watcher is offline. Reports and incident records contain only public evidence and plain Swarm references; never publish a secret-bearing or encrypted Swarm reference.

An eligible benign green/amber observation must be proven end to end: extension queue → watcher intake/deduplication → Arkiv observation → hourly baseline aggregation → refreshed extension bundle. A pre-seeded baseline alone does not pass this test.

### Dependency failure outcomes

| Failure | Required outcome |
|---|---|
| ENS/Swarm unreachable, cached snapshot current | Use the validated cached snapshot and show its age. |
| Cached snapshot expired, or no verified cache | Grey/no trust; never silently reuse expired seeds. |
| New Swarm bytes fail digest, prior cache still current | Discard new bytes and retain the current verified cache. |
| Arkiv unavailable | Use last cached bundle with stale/offline state; without cache, grey. |
| Watcher unavailable | Preserve counterparty evaluation; show last update age and mark drift/status stale. |
| Anon-RPC unavailable or over 1.5 seconds | Score without those chain facts and say the check timed out; never use a direct public-RPC fallback. |
| ENSv2 protocol attestation lookup unavailable | Treat the address as unattested. |
| Swarm incident report unavailable | Keep the warning/status and disable only the report link. |

### Anon-RPC evidence

Inventory ENS root, protocol-attestation, counterparty, proxy-fact, uncurated-site, and status reads. Route eligible trust/counterparty reads through the configured Anon-RPC transport. Any direct bootstrap/config read must be listed as an exclusion, pinned, and disclosed; there is no direct fallback for an eligible sensitive read. Verify the worker bundle hash against its configured specifier, capture browser NetLog showing no direct client-to-destination RPC connection, and measure p50/p95 latency plus the share completed inside 1.5 seconds. Set a minimum usable coverage during Phase 0.

### Governance keys

| Key | Authority |
|---|---|
| ENS name owner/admin | Offline root authority that can change resolver or roles; highest-trust key, separate from curator. |
| Curator | Scoped setter for the snapshot root record only; single key is an accepted, disclosed v2 MVP risk. |
| Protocol account | Separate scoped setter for that protocol's attestation record; cannot change the BOUND root or another protocol's record. |
| Watcher | Arkiv publishing only; no ENS role and no snapshot authority. |
| Swarm postage | Upload funding only; no trust authority. |
| User wallet | User-controlled signing only; never held or accessed by BOUND. |

### Service boundary

Keep separate adapters for snapshot/root access, Swarm bytes, Arkiv bundle/status/write, and Anon-RPC facts. The extension consumes validated results and does not trust data because it came from a gateway. Watcher writes observations and drift; curator alone publishes trust. A watcher key must not have authority to publish a snapshot.

## 4. Developer lanes and file ownership

Each lane is independent during Phase 1. The plan is the contract source until Developer 3 commits executable schemas in Phase 0. Use deterministic local fakes until integration. Keep edits in assigned paths. Developer 3 owns shared/contracts; consumers may request a versioned change, but keep working against the current contract until a phase boundary. No one waits on an unfinished library.

| Developer | Owns | Mission |
|---|---|---|
| **Developer 1 — Browser and user path** | client/extension/**, shared/decoder/**, shared/policy-core/**, client/demo/test-dapp/** | Own provider interception, bridge and warning UI, decoder/evaluator, observation minimization/emission, test dApp and fake EIP-6963 providers, plus the MV3 offscreen host shell for Anon-RPC. Wire extension consumers to stable adapter contracts. |
| **Developer 2 — Trust and chain reads** | shared/snapshot/**, server/curator/**, shared/integrations/ens/**, shared/integrations/swarm/**, shared/integrations/anon-rpc/**, fixtures/snapshots/** | Own snapshot/compiler/verifier, ENSv2 root and protocol attestation, curator role, Swarm snapshot/report storage library, Anon-RPC transport adapter and chain reads. Export stable trust, Swarm, and chain-read adapters. |
| **Developer 3 — Live data and integration harness** | shared/contracts/**, fixtures/contracts/**, server/watcher/**, shared/shared/integrations/arkiv/**, server/demo/hijack-server/**, arkiv/**, scripts/integration/**, root package/workspace/CI files, README/LICENSE | Own executable schemas/conformance fixtures, repo skeleton and CI, watcher intake/composition, Arkiv write/query/owner checks, hijack server and integration harness, and final project/Arkiv documentation. Consume Developer 2's Swarm and Anon-RPC contracts. |

### Instructions for all three developers

1. Read both architecture documents and this plan before coding. Follow v2 on scope and record any remaining contradictions as explicit decisions rather than silently inventing behavior.
2. Work in the owned paths. Do not edit another lane's files to make a local integration pass; use the fixed contracts and fakes until the phase gate.
3. Every external address must have a source URL and chain recorded. Verify deployed bytecode with cast code before adding it to a seed. Never copy an address from a stale snippet without verification.
4. Use separate curator and watcher keys. The v2 single curator key is an accepted MVP risk and must be disclosed; rehearse rotation. Keep keys, RPC tokens, Swarm postage credentials, and local environment files out of git. Testnet keys only; never use a user's wallet or production funds.
5. Add the test oracle beside every security-sensitive branch. Prefer deterministic fixtures, property tests, and negative cases. No network outage may create an implicit green result.
6. Do not claim universal wallet coverage, privacy beyond the actual Anon-RPC threat model, or measured accuracy without reproducible evidence.
7. At each gate, provide the exact command, result, environment, and unresolved failures. A gate passes only when its listed evidence is reviewable.
8. Developer 1 wires the extension consumers, Developer 2 exports the trust/Swarm libraries, and Developer 3 owns watcher composition and integration orchestration. Developer 3 also gathers documentation/evidence; Developers 1 and 2 submit their supported-method list, publication receipts, and unresolved limitations without editing the shared README.
9. Developer 3 creates the root workspace/test-runner skeleton at the start of Phase 0. Developer 1 and 2 may use package-local scripts until it lands; neither waits to begin implementation.

## 5. Phased execution

All three developers work in parallel inside each phase. The team moves to the next phase only after every gate for the current phase passes. A fake integration can unblock local development, but never the phase exit gate for a required live integration.

### Phase 0 — Baseline, feasibility, and contract freeze

**Developer 1:** own the fictional test dApp and fake EIP-6963 providers; establish the minimal extension/offscreen shell and demonstrate an actual extension-owned warning window opening from a wallet request; inventory provider injection, built-in poisoning, bridge authentication, and MV3 lifecycle constraints.

**Developer 2:** validate ENSv2 test-network availability and record-key permissions, deploy/use a dedicated resolver, prove curator cannot edit unrelated keys, publish/read a disposable root and protocol self-attestation, upload/read/hash a snapshot through the team's Bee/postage batch and a second gateway, and verify Anon-RPC worker configuration.

**Developer 3:** validate current Arkiv network, chain ID, writer/query/owner semantics, create/query an expiring test entity, exercise DNS/TLS polling against a controlled domain, choose the ASN data source for corroboration, and commit the executable schemas/conformance fixtures plus initial workspace commands. The controlled test dApp stays owned by Developer 1; Developer 3 owns the second-server hijack harness.

**Shared exit gate:**

- Repository baseline is documented; the v2 scope and the fixed wire contracts above are accepted.
- The extension can observe one real wallet request in the selected test setup, and limitations are documented.
- The real wallet request can open and complete an extension-owned warning window; tab/frame/document binding is recorded from extension metadata.
- ENSv2, Swarm, Arkiv, Anon-RPC, and watcher prechecks each have a reproducible pass, a named owner/key, and a documented test environment.
- The Anon-RPC path works in the built MV3 extension's offscreen host; a standalone worker probe alone does not pass.
- The curator cannot write unrelated resolver keys; the ENS name owner/admin is separate and offline; protocol self-attestation hierarchy and permissions are frozen.
- Freeze the chain matrix for the ENS root, five real protocol seeds, fictional test dApp, Arkiv, and Anon-RPC.
- Snapshot digest vector, coherent root record format, ENS record keys and attestation schema, chain IDs, Arkiv entity fields, watcher identity, executable JSON schemas/conformance fixtures, API request/response shapes, and clean workspace commands are frozen.
- Freeze the explicit read-only RPC allowlist, including chain/account reads and eth_sendRawTransaction; decide whether wallet_addEthereumChain passes or receives an unsupported warning.
- Current score parameters and K/N/M handling are documented; K counts distinct rotating reporter keys only, not verified people. Any unresolved network capability is a blocker for the relevant live integration, not a reason to count a mock as complete.
- Finish each external feasibility probe within one hour. Record for each integration its owner, required status, fallback, decision deadline, and effect on public claims. A failed required integration blocks that integration gate; other developers continue on local fakes. Only an explicit scope change can drop a required gate.

| Precheck failure | Continue-working path | Gate and claim effect |
|---|---|---|
| MV3 cannot open the extension-owned warning window | Prototype the documented captured native-confirm fallback while other lanes continue. | The protection gate stays open until the fallback is approved and its weaker warning claim is disclosed. |
| ENSv2 record roles are too broad | Use a dedicated resolver with least-privilege roles. | If that still fails, do not claim the ENSv2 governance integration; the required gate remains open. |
| Swarm postage/upload or Arkiv testnet is unavailable | Continue with local adapters and fixtures. | The live integration gate remains open; fixtures never count as completion. |
| Selected Anon-RPC worker is not anonymizing or cannot run in MV3 | Continue implementation against its adapter contract. | Do not claim Anon-RPC privacy or pass its required integration gate. |

### Phase 1 — Independent component implementation

**Developer 1 deliverables and gates**

- Implement request, send, and sendAsync through one gate; instrument EIP-6963 providers; use extension-owned warning UI; report mediated, unsupported, and bypass-possible coverage.
- Implement canonical origin handling, decoder IR and roles, deterministic scoring/caps, frozen request forwarding, chain/account invalidation, and clear Continue/Cancel behavior.
- Bind every pending decision to a one-time request ID and payload digest plus browser-sourced tab/frame/document/top-level/frame origins. Invalidate on navigation or service-worker restart.
- Authenticate the MAIN/isolated bridge with a per-document channel ID and strict source/origin checks; bound message size, request rate, and wait time.
- Pass unit/property tests for ERC-20 approve/increaseAllowance/transfer/transferFrom, ERC-721 setApprovalForAll/safeTransferFrom, Permit2 approve/PermitSingle/SignatureTransfer/Witness transfer, EIP-2612 permit, Seaport consideration recipients, personal_sign, eth_sign, EIP-7702 chainId zero, EIP-5792 atomic batches, opaque address scans, and a truncated known selector.
- Test the same address on a different chain, an iframe with its own origin in the warning, a mutated spender, real benign DEX fixtures, signer accounts fetched at decision time, and page poisoning of JSON/Array/Set/string built-ins after hook installation.
- Gate: all supported and cap-matrix requests classify to their frozen expected verdict; mutation cannot change forwarded bytes; forged page decisions, wrong message source/origin, wrong tab/frame, mismatched payload, replayed confirmation, request flood/oversize/timeout, navigation, and worker-restart cases cannot forward a request; no unsupported, malformed, or bypass-possible path gets green; the warning never relies on page DOM.

**Developer 2 deliverables and gates**

- Implement schema validation, canonical serialization, deterministic digest, snapshot compiler, expiry and monotonic epoch checks, ENSv2 root reader/publisher, Swarm upload/fetch, and Anon-RPC transport for trust/counterparty reads.
- Make the curator CLI refuse an epoch less than or equal to the published epoch. Run rollback/equivocation tests against a separate test name or fixture; never lower the live demo root.
- Implement one real ENSv2 protocol self-attestation read/write path with role-scoped ownership, separate from the curator root.
- Verify all five protocol seeds from official deployment sources; check contract bytecode with cast code and retain source URL, chain, and deployment provenance. Do not use explorer-only creator claims; exclude CREATE2 lineage unless independently verified.
- Demonstrate a real authorized curator role publishing one coherent root record, an unauthorized account and the curator on an unrelated key failing to update it, and the extension verifier accepting matching bytes and rejecting altered bytes, mismatched root/snapshot epochs, conflicting same-epoch roots, lower epochs after restart, wrong network/name, and expiry.
- Gate: clean rebuild produces the same snapshot bytes and digest; root update is least-privilege; an independent Swarm gateway returns bytes whose digest matches; highest accepted epoch survives extension restart; no observation or Arkiv record can add trust; Anon-RPC transport hash and network evidence are captured with no direct fallback for eligible reads.

**Developer 3 deliverables and gates**

- Implement watcher polling and corroboration rules, privacy-minimized report intake and batching, Arkiv entity schemas/expiry/query/owner verification, baseline/status bundles, and the second-server hijack harness.
- Demonstrate that a forged seed-shaped Arkiv record from another writer is ignored; a watcher-owned baseline/status is found; a controlled DNS/TLS change creates drift; and incident thresholds distinguish repeated unique rotating reporter keys from duplicate/replayed reports. State plainly that rotating keys are Sybil-prone and not proof of independent people.
- Test the watcher→Arkiv→extension path, first-sighting dedupe, weekly refresh, local queue/retry, owner checks, and privacy filters. Keep witness-group/Semaphore work out of this phase.
- Gate: Arkiv write/read/expiry and owner checks pass; watcher outputs are deterministic on fixtures; K−1, duplicate, replayed, same-key reports, and different-counterparty reports do not create a false incident; drift alone and one uncorroborated warning do not create one; drift plus one warning and K distinct keys on the same counterparty do; the controlled domain emits expected drift. Rotating-key Sybil attacks remain an accepted, disclosed risk.

**Phase 1 combined gate:** each lane's isolated tests pass from a clean checkout; package boundaries compile without importing another unfinished lane; fixture contracts match this plan; no private keys or credentials are committed. All mandatory real integrations must be reachable in their test environments before Phase 2.

### Phase 2 — End-to-end integration

Connect adapters through the fixed contracts. Keep unit tests, but use the real browser extension, test wallet, ENSv2, Swarm, Arkiv, watcher, and Anon-RPC for the acceptance run.

**Required end-to-end scenario**

1. Curator compiles a snapshot, uploads it to Swarm, and publishes digest, epoch, and reference through the ENSv2 curator role.
2. Extension reads the live root, retrieves the snapshot, verifies the digest and epoch, and caches only validated snapshot bytes.
3. A protocol publishes an address in its own ENSv2 namespace; the extension verifies that attestation and trusts the address only for the attesting protocol and chain.
4. Extension downloads the watcher-owned baseline/status bundle and verifies owner addresses. Any per-site status or uncurated-site query uses Anon-RPC; sensitive counterparty facts use the same path.
5. On a seeded site, a benign wallet request is decoded, evaluated, and forwarded unchanged to the selected wallet. The wallet's own confirmation remains in the flow.
6. From a seeded site with an initially empty live observation set, send an eligible benign mediated request on a test network or local chain. Prove extension queue → watcher intake/deduplication → Arkiv observation → hourly baseline → refreshed extension bundle. A pre-populated baseline cannot substitute for this round trip.
7. Attempt to report after continuing past a red warning and during an active incident; neither observation is accepted into the baseline. Verify the observed address is still not trusted merely because it entered the baseline.
8. Repoint a controlled delegated subdomain to the second server. Use a 60-second delegated-zone TTL; make the new certificate differ by issuer or SAN and place the server on a different ASN for the A-record signal. The watcher stores corroborated drift and the extension shows the banner before wallet connect. Same-CA/same-SAN renewal and an A-record move within one ASN must not corroborate.
9. Serve a malicious script from the second server at the same controlled HTTPS origin. An unlimited approve to an untrusted spender is named in the extension-owned warning. Emit the privacy-minimized warned event before the user chooses; Cancel returns 4001 and the wallet never receives the request. Continue requires the documented explicit confirmation and creates no positive baseline observation.
10. With drift plus the warning, the watcher writes a public report digest to Swarm, writes its reference and status to Arkiv, and the extension displays the updated status on the next page load. Revert DNS and verify status returns to normal while the incident record remains. Separately test the no-drift path: K distinct rotating reporter keys for the same counterparty trigger; K−1, duplicates, replay, different counterparties, drift alone, and one uncorroborated warning do not.
11. Publish a later snapshot epoch through ENSv2 and show the extension accepting it. Replay a lower epoch after extension restart, publish a conflicting same-epoch root, and serve altered Swarm bytes; all must be rejected.
12. Run the same critical flows with ENS, Swarm, Arkiv, watcher, and Anon-RPC individually unavailable. Verify the exact failure outcomes in §3; no fabricated trust appears and no direct-RPC privacy fallback occurs.

**Phase 2 gate**

- The complete scenario runs from a clean checkout with no manual console injection and no mocked response on the mandatory integration path.
- ENSv2 root read/write, scoped authorization, and epoch refresh are verified on the selected test network.
- A protocol self-attestation is written by the protocol's own authorized account and accepted only for that site's matching chain.
- Snapshot and incident report are fetched from Swarm, including a second-gateway hash check.
- Arkiv writes and public queries are reproducible; owner filtering and extension-side owner checks are proven. Canary wallet accounts, amounts, transaction hashes, request digests, and user choices are scanned across Arkiv payloads, Swarm reports, and watcher logs; the oracle permits legitimate public counterparty addresses.
- A benign mediated request completes the observation-to-hourly-baseline-to-refreshed-extension round trip from initially empty live observation data. Red-warning overrides and active-incident observations are excluded.
- Both incident triggers and all negative threshold cases are tested with rotating reporter keys. Reports are described as distinct keys, not as independent people; their Sybil limitation is visible.
- A network trace shows sensitive reads through the actual anonymizing worker, records the worker/config version and eligible-read coverage, and proves no public fallback on failure or timeout.
- An Anon-RPC-backed protocol attestation changes a matching site's decision; if the 1.5-second budget expires, the address stays capped and the timeout is shown. Measure p50/p95 and the share of eligible reads within budget.
- The malicious request is stopped before reaching the wallet when the user cancels; Continue forwards the frozen bytes; unsupported paths never display green.
- The infrastructure-hijack flow reaches escalated at the 15 cap, shows the typed-confirmation requirement, and demonstrates the external revocation link without signing a real mainnet transaction.
- Root epoch equality, coherent tuple handling, persistent rollback protection after restart, current-cache behavior, expired-cache behavior, and no-cache behavior match the failure matrix in §3.
- Evidence, transaction hashes, entity keys, Swarm references, test commands, and known limitations are recorded. No live integration is represented by a screenshot alone.

### Phase 3 — Security, operations, and handoff

**Developer 1:** run cross-provider and injection-order coverage tests; finalize extension onboarding, verdict wording, unsupported-state UX, and bypass disclosure. Verify escalated warnings require typed confirmation and warning/history views offer the documented external revocation link prefilled with token and spender where available.

**Developer 2:** run snapshot tamper/rollback/expiry review, curator-key handling and rotation rehearsal, independent digest reproduction, and publication runbook.

**Developer 3:** run watcher outage/restart/retry tests, Arkiv poisoning and privacy scans, clean-clone demo replay, and partner evidence documentation. Replay DNS/TLS cutover to the second hijack server while preserving the controlled HTTPS origin and show the pre-connection drift banner, then verify that wallet requests remain mediated at that same origin. Serve a clean page to the headless scanner and the malicious flow to the test browser; show that BOUND evaluates the browser's actual request.

**Final gate**

- Clean install/build/test instructions work from a new checkout; CI executes unit, property, integration, and browser end-to-end suites.
- CI runs unit/property/fake-integration suites on every push; live testnet and real-wallet runs are manual or nightly with protected secrets. Include gitleaks and report mediation coverage, true-positive/false-hold rates, decision latency p50/p95, and stale-snapshot detection with denominators.
- Security invariants I1–I12 in BOUND_Final_Architecture.md have named test cases and recorded results. The known provider bypass is demonstrated and reported, not hidden.
- Five seeded real protocols have verified addresses, site/chain mappings, provenance, and a benign-flow check. Do not clone a real brand in the hijack demo.
- The Arkiv README names the writing wallet and provides a runnable public query; the repository has an open-source license and AI-use disclosure; and arkiv/schema.md, arkiv/friction.md, arkiv/reach.md, arkiv/how-you-use-arkiv.md, arkiv/why-arkiv.md, and arkiv/swarm.md are complete. The Swarm evidence names the bytes stored on Swarm, Arkiv entity key and reference, public link, postage batch lifetime and funding source, Bee service, upload/read code, reproduction steps, demo timestamp, and failure/friction notes. ENSv2 and Anon-RPC evidence includes reproducible references and exact network configuration. SDK versions are pinned; add an Anon-RPC exclusions note.
- Failure behavior, privacy boundaries, key custody, supported methods/wallets, and non-goals are documented. No unresolved Critical or High issue under the v2 severity rubric remains open; accepted risks have an owner and user-facing disclosure.
- A full rehearsal passes with the original site server disabled during the hijack segment. Nothing is described as audited or universally enforced.
- Serving-IP/outbound-host, external blocklist, and proxy-upgrade signals are either implemented with their own tests and transport evidence or explicitly disabled and disclosed; an unavailable signal never contributes points.

## 6. Integration acceptance checklist

Use this checklist in the final test report; every row must have a named test, result, and evidence link.

| Path | Passing evidence |
|---|---|
| Browser mediation | Supported wallet request reaches the hook; malicious request pauses before wallet; bridge context and one-time confirmation resist forgery/replay; cancel/continue semantics are correct; unsupported and bypass paths are never green. |
| ENSv2 | Real test-network resolver record, actual curator-scoped write, denied unauthorized write, read-back of current root, and epoch update. |
| Swarm | Snapshot upload/read and incident report upload/read; second gateway fetch; digest recomputed independently; postage/source documented. |
| Arkiv | Watcher write, public query, expiry behavior, writer-owner filter plus consumer re-check, baseline/status bundle displayed by the extension, and benign observation → hourly baseline → refreshed bundle round trip. |
| Watcher | Controlled DNS/TLS changes produce drift; report threshold produces an incident; no incident from a single uncorroborated warning; status reaches the extension. |
| ENSv2 protocol attestation | A protocol-authorized account publishes an address; extension accepts it only for that site's matching chain; an unauthorized writer cannot alter it. |
| Anon-RPC | Actual anonymizing worker on the sensitive lookup path, captured transport evidence, measured timeout and eligible-read coverage, no direct fallback. |
| End-to-end security | Same-origin benign and malicious scripts; attacker spender named; unchanged request forwarded only after explicit continue; stale/tampered trust data rejected. |

## 7. Scope decisions and open risks

- **Unsupported-method semantics:** v2 says unsupported requests have no score and are not green, while other passages call the method handling fail-closed. This plan resolves it as an explicit extension-owned warning with no score; user choice is required to continue or cancel. Never silently forward an unknown signing method with a green badge.
- **ENSv2 role scope:** verify whether a text-key permission is scoped per name or resolver. Use a dedicated resolver if the live semantics require it.
- **Arkiv network details:** verify the currently supported network, chain ID, SDK/RPC behavior, owner filtering, and expiry semantics during Phase 0. Do not assume old testnet values are still valid.
- **Anon-RPC:** a normal fetch proxy is not anonymous. If the available worker cannot meet the architecture's privacy claim, mark the integration incomplete and stop the Anon-RPC acceptance claim.
- **ENSv2 protocol self-attestation is in the selected ENS-track gate.** The v2 document alternately describes attestations in a protocol's own name and in a subname under BOUND's namespace. Phase 0 must freeze the exact hierarchy and prove that the protocol's own key, rather than the curator or site registrar, controls the attestation.
- **Address-scan improvements, EIP-7702 wallet coverage where no test wallet exposes it, witness proofs/Semaphore, simulation, and Safe Mode are outside the MVP.** Do not add them to the implementation phases unless the project owner revises scope.
- **Secondary reputation signals:** page-served IP and outbound-host changes, external blocklist lookups, and proxy-upgrade/admin-change facts appear in v2's scoring table but are not part of the minimum integration path here. Keep them disabled and disclosed unless a lane explicitly implements each signal with provenance, privacy review, and tests. An unavailable or unimplemented signal must never add points.
- **Solidity tooling:** v2 cuts the custom PolicyAnchor contract, so no Solidity contract is required in this MVP. If scope changes to add Solidity, use the repository's Foundry/TDD and Slither gates from AGENTS.md.

## 8. Definition of done

BOUND is ready for the team demo only when Phase 3 passes and every integration acceptance row is backed by repeatable evidence. The delivered system must tell the user what it checked, what it could not check, and whether the request was actually mediated. Mocks, architecture prose, and green unit tests alone do not establish end-to-end integration.

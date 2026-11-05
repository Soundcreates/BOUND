# Phase 0 contract draft

From a clean checkout with Node.js 22 or newer, run `npm test`. No install is needed. This package exports dependency-free validators and `parseUniqueJSON`, which rejects duplicate object keys before schema validation. Validators check structure; they do not establish data authenticity, currentness, canonical serialization, or trust. Consumers must apply the security checks owned by their lane.

## Proposed wire shapes

The version-1 root is `{schemaVersion, network, epoch, digest, swarmReference}` as one record. The snapshot uses `{schemaVersion, network, epoch, generatedAt, expiresAt, sharedContracts, sites}`. Site chains contain `trustedCounterparties`, `trustedCalledContracts`, `deployerLineage`, and `sourceEvidence`. Addresses are lower-case; lists requiring order are strictly sorted and unique. Times are UTC ISO strings with optional millisecond precision; chain IDs are safe positive integers or decimal object keys. Source evidence is structural only; consumers must validate provenance. Swarm references are restricted to a plain, unencrypted 32-byte lowercase hex reference.

The observation intake is `{site, kind, value, chainId, reporterKey}`, with kind `counterparty`, `called-contract`, or `warned`. Public Arkiv payloads have `schemaVersion`, `kind`, `site`, `chainId` and the kind-specific fields in `fixtures/contracts/records.json`. A bundle contains entity envelopes with Arkiv key, owner, expiry block, and a baseline, drift, incident, or status payload. The caller must supply the configured watcher address and current Arkiv block; foreign-owner and expired records are rejected. Arkiv owner and expiry are metadata, not payload fields. A self-asserted owner is never sufficient.

The contract tests verify the snapshot fixture's canonical bytes and Keccak-256 digest offline. `packages/contracts/verify-digest.sh` independently checks the fixture against Rabdi's `web3_sha3` RPC. General RFC 8785 behavior still needs validation by Developer 2's implementation. `fixtures/contracts/verdict-matrix.json` captures score caps and a normal-router false-hold control; it is a conformance specification, not an implemented evaluator.

The proposed batch wraps 1–100 events in `{schemaVersion, events}`. The response is `{schemaVersion, result}` with accepted, retry, or rejected. Batch atomicity and retry semantics remain open; this package does not implement an intake server. The local decision shape is `{coverage, evaluated, bypassPossible, verdict, score}`. Unsupported or unevaluated requests have no verdict or score, and grey has no score. This is extension state, never a page-provided authorization. Adapter results use `{service, status, source, data}`; a success envelope does not authenticate its contents, and failures contain no facts or direct-RPC fallback.

## Items for shared Phase 0 acceptance

The Dev3 shapes are proposed until Developers 1 and 2 accept the field names and package interfaces. Still to freeze: lineage evidence details, Arkiv schema tags and record lifetimes, reporter-key encoding, bundle ordering, batch atomicity and retry behavior, ENS name/key, K and the counting window, N/M and score weights, and the minimum Anon-RPC coverage. The hierarchy for protocol self-attestation is contradictory across the architecture and needs a live proof. Network and test-writer evidence is recorded in `feasibility.md`. Fixtures and public read probes do not pass any live write, expiry, or controlled-domain gate.

`eth_sendRawTransaction` is separately classified because it broadcasts. `wallet_addEthereumChain` remains unsupported pending agreement. Unknown methods require an explicit warning. The provisional allowlist is in `index.js`.

**Proposed status clarification:** an incident status may have `incidentReference: null` while the report is unavailable; consumers keep the incident warning and disable the report link. Non-incident status must have a null reference. This resolves the plan’s Swarm failure outcome locally but requires cross-lane acceptance before the contract is frozen.

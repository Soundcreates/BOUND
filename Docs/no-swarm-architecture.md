# Arkiv-only snapshot and watcher storage

The live trust snapshot is now published in this order:

1. The curator compiles the canonical JSON snapshot and its Keccak digest.
2. It writes one `trust_snapshot` entity to Arkiv. The record retains the canonical bytes, digest, network and epoch.
3. It publishes `bound.root.v2` in ENS with the digest, epoch, Arkiv entity key and expected Arkiv owner.
4. The extension reads that root, fetches the entity through the configured anonymizing RPC, checks its Arkiv owner and expiry, and verifies the canonical bytes against the ENS digest, epoch and network before caching them.

The publisher refuses snapshot files larger than 61,440 bytes so the wrapped Arkiv record remains within the entity payload limit, including JSON string escaping. Trust snapshot entities use the maximum supported lifetime of 7,884,000 blocks. A write can leave an unreferenced Arkiv entity if the subsequent ENS transaction fails; the next publish can proceed and the entity expires normally.

The watcher writes each drift or incident detail payload as an Arkiv `evidence` entity. Its `drift.evidenceReference` or `incident.reportReference` points to that Arkiv key. Observation, baseline, status and ENS cache records also remain in Arkiv. The watcher configuration no longer needs Bee API, postage batch or gateway settings.

## Curator environment

Required for compile-and-publish/read:

- `BOUND_SEPOLIA_RPC_URL`
- `BOUND_CURATOR_PRIVATE_KEY` (ENS publisher key)
- `BOUND_ROOT_NAME`
- `BOUND_RESOLVER_ADDRESS` (the deployed PermissionedResolver proxy)
- `BOUND_ARKIV_RPC_URL`
- `BOUND_ARKIV_OWNER`
- `BOUND_ARKIV_SYSTEM_ADDRESS`

Required only to publish:

- `BOUND_ARKIV_PRIVATE_KEY` (must derive `BOUND_ARKIV_OWNER`; use a dedicated curator writer key)
- `BOUND_ARKIV_SENDER_JOURNAL`
- `BOUND_ARKIV_REGISTRY_JOURNAL`

Optional settings are `ARKIV_ACCESS_KEY`, `BOUND_ARKIV_CHAIN_ID` (default `7794095`) and `BOUND_ARKIV_LIFETIME_BLOCKS` (default `7884000` for the other Arkiv record kinds). Keep the two journal paths private, distinct, and separate from the watcher's journals.

## ENS migration

`bound.root.v2` is a new resolver text-record key. Before publishing, the resolver administrator must grant the curator `ROLE_SET_TEXT` for this key. The existing `bound.root.v1` grant does not cover it. Then compile and publish a snapshot with the curator CLI. The extension will fail closed until the v2 root exists. No ENS or Arkiv writes are performed automatically by this code change.

`bound.root.v1` and existing Swarm snapshots are not read by the new extension. Keep their data available for legacy clients during rollout; remove it only when those clients have been retired.

# Curator

The curator compiles a canonical trust snapshot, stores it in Arkiv, and publishes an ENS `bound.root.v2` pointer. The extension verifies the pointed entity's Arkiv owner and expiry and checks the snapshot bytes against the digest, epoch and network in ENS. Snapshot schema remains version 1; the root pointer format is version 2.

## CLI

```sh
# Offline compilation; writes <prefix>.bin and <prefix>.json
node --experimental-strip-types src/cli.ts compile <input.json> <out-prefix>

# Writes the snapshot entity to Arkiv, then publishes the ENS pointer
node --experimental-strip-types src/cli.ts publish <out-prefix>.bin

# Reads the ENS pointer and verifies the Arkiv entity
node --experimental-strip-types src/cli.ts read
```

The publish command requires `BOUND_SEPOLIA_RPC_URL`, `BOUND_CURATOR_PRIVATE_KEY`, `BOUND_ROOT_NAME`, `BOUND_RESOLVER_ADDRESS`, `BOUND_ARKIV_RPC_URL`, `BOUND_ARKIV_OWNER`, `BOUND_ARKIV_SYSTEM_ADDRESS`, `BOUND_ARKIV_PRIVATE_KEY`, `BOUND_ARKIV_SENDER_JOURNAL`, and `BOUND_ARKIV_REGISTRY_JOURNAL`. The Arkiv private key must match the configured owner. `ARKIV_ACCESS_KEY` is optional. Chain ID defaults to `7794095`, schema tag to `bound.record.v1`, and entity lifetime to `7884000` blocks. The two journals are private local state and must use different paths.

The publisher writes the Arkiv entity before it sends the ENS transaction. If ENS publication fails, the entity remains unreferenced until it expires. Snapshot files over 61,440 bytes are rejected because Arkiv stores the canonical bytes inside a validated record with a strict payload limit.

## ENS migration

`bound.root.v2` is a new text-record key. The resolver administrator must grant the curator `ROLE_SET_TEXT` for that key before publishing. A grant for `bound.root.v1` does not authorize v2. Existing v1 records remain available to legacy clients; current code does not use them. Publish an epoch appropriate for the new v2 record, then update extension settings to the matching ENS name, pinned resolver and Arkiv RPC.

No ENS or Arkiv transaction is performed as part of compilation or code installation. The optional `probe-swarm.ts` remains a standalone historical infrastructure probe and is not used by snapshot publishing or watcher deployment.

See [the Arkiv-only architecture and migration notes](../../Docs/no-swarm-architecture.md) for the full flow and environment list.

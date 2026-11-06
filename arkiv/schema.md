# Arkiv schema

The local watcher uses the Rabdi testnet and `bound.record.v1`. The configured writer owns its entities; the public test writer used in documented tests is `0xe63393558e36df643347326e7e03ad5fb0e6c867`. Arkiv exposes owner, entity key and expiry as metadata. The reader filters by `$owner` and `arkiv.schema`, rechecks owner, schema and expiry, and the operation lookup also filters `operation`; a schema tag alone does not authenticate an entity. `kind` and `operation` are string attributes, and `payload` is UTF-8 JSON bytes. See [codec](../integrations/arkiv/codec.js), [reader](../integrations/arkiv/rpc.js), and [record validation](../packages/contracts/index.js). Site and chain are fields inside the payload and are filtered after reading, not indexed Arkiv attributes.

| Kind | Purpose and selected payload fields | Local intake lifetime (blocks) |
| --- | --- | --- |
| observation | Site/chain, observed address and classification | 345600 |
| baseline | Site/chain, observed counterparties and contracts | 43200 |
| drift | Site/chain and infrastructure drift | 43200 |
| incident | Site/chain, severity, `reportReference`, `reportDigest` | 43200 |
| status | Site/chain, state, `feedReference`, optional incident reference | 43200 |
| frontend | Site/chain and aggregated script hash evidence | 43200 |
| evidence | Published incident/drift evidence | Defaults to drift lifetime |
| trust_snapshot | Curated snapshot data | Defaults to baseline lifetime |
| ens_record | ENS cache data | Defaults to status lifetime |

The exact valid fields are defined by the validators linked above. Lifetimes are block counts, not fixed wall-clock durations; local defaults may differ from other deployments and eligible records can be renewed. See [local configuration](../services/watcher/local-intake.mjs) and [archive](../integrations/arkiv/archive.js). Live create, patch, owner query and expiry evidence is in [feasibility.md](../packages/contracts/feasibility.md); full user-facing live flow has not yet been verified.

An incident's `reportReference` is an unencrypted Swarm reference. Never publish a secret-bearing encrypted Swarm reference in a public Arkiv entity. No live entity linking the demonstrated safe page has yet been established.

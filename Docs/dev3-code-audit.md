# Developer 3 code status

This records the local code audit, not phase acceptance. Live integration, browser and wallet tests, and the shared phase gates remain deferred. The other developers' lanes are not represented as complete.

| Dev3 responsibility | Local implementation and unit evidence |
|---|---|
| Wire contracts and privacy bounds | `packages/contracts/index.js` and its conformance tests validate the public records, batches, owner/expiry and strict shapes. |
| Intake, deduplication, retry and baselines | `services/watcher/durable.js`, `http.js`, `runtime.js` and their tests cover bounded intake, persisted retry, counting windows, incident suppression and hourly baseline publication. |
| Infrastructure drift and incidents | `poll.js`, `network.js`, `asn.js`, `drift-*`, `lifecycle.js`, `incident-binding.js` and `guarded-flows.js` cover signal corroboration, durable publication, incident state and guarded status transitions with local adapters. |
| Arkiv writes, owner checks and expiry | `integrations/arkiv/archive.js`, `sender.js`, `confirm.js`, `upsert.js` and `renewal.js` compose signed idempotent writes, owner/readback checks, expiry renewal, rollover and restart reconciliation. Tests use fake RPC responses. |
| Deployment composition | `services/watcher/application.js`, `deployment.js`, `run.mjs`, and `config-example.mjs` connect the owned components and expose a loopback service. An operator must configure real services, a dedicated writer, curated references and an episode-specific recovery approval. |
| Hijack and scanner fixture | `demo/hijack-server` has a same-origin local cutover and optional selective clean page for a headless scanner. It uses a synthetic local-chain approval. |
| Test reporting and CI | `scripts/integration/metrics.js` and `privacy-scan.js` provide offline reporting helpers and unit tests; `.github/workflows/ci.yml` installs locked dependencies and runs the configured local suite and Gitleaks. Hosted CI and live evidence are not established by these files. |

The local sender retries the same signed transaction after an uncertain submission. A transaction that remains pending or reverts requires operator reconciliation; automatic fee replacement is not implemented. Journals are bounded and single-process, the configured RPC is trusted, recovery approvals require independent operator review, and an onchain status can lag local detection. None of the local tests establishes live renewal, public DNS/TLS cutover, wallet mediation, or the end-to-end acceptance scenario.

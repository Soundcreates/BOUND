# Integration evidence

## Live Arkiv demo registry

Run `npm run demo:arkiv:seed` to publish baseline and normal-status fixtures for
`127.0.0.1:8000`, `localhost:8000`, `127.0.0.1:8001`, and `localhost:8001` on
dApp chain Sepolia (11155111). Storage transactions run on Rabdi (7794095), not
Sepolia. These are the exact hosts used by `apps/extension/PHASE0.md`; ports and
`localhost` versus `127.0.0.1` are distinct scopes. Similar-looking domains do
not match. This does not seed the separate chain-31337 hijack harness.

The command uses the existing ignored `.env` variables `ARKIV_RPC_URL`,
`ARKIV_CHAIN_ID`, `ARKIV_TEST_WRITER_ADDRESS`, and
`ARKIV_TEST_WRITER_PRIVATE_KEY`, with optional `ARKIV_ACCESS_KEY`. Use only the
dedicated test writer and do not run the watcher or another signer with that
key simultaneously. The script refuses pending transactions and public-domain
fixtures. It never prints the key or signed transaction bytes.

Keep `.bound/arkiv-demo/`: its private journals make retries idempotent. A
manifest pins the fixture timestamp; reruns reconcile the same operations and
renew approaching expiry. The lifetime is 604800 Arkiv blocks, not seconds.
Renewal is not a background service; run the seed command again before expiry.
After expiry, a deliberate new fixture generation is needed; do not delete
journals to force retries. The script refuses to create a new registry over
existing matching scopes if its manifest has been lost.

Run `npm run demo:arkiv:check` immediately before a demo for a read-only check
with no signing key required. Both commands check exact payloads through the
owner-filtered integration reader and run the extension's actual
`createArkivReader().refresh()` against the public RPC. The seed command saves
entity keys, expiry blocks, and transaction hashes to
`.bound/arkiv-demo/evidence.json`. It fails if records are missing, duplicated,
changed, expired, or unreadable by the extension reader. Queries that span a
block transition are retried a bounded number of times, never accepted partially.

These are explicitly synthetic normal-state fixtures, not security assessments
or fabricated historical incidents. Baselines start empty and grant no trust
to contracts. The status `feedReference` is a hash identifying this local demo
fixture, not a claim that a Swarm feed was published. No real wallet activity is
performed. The scripts do not bypass the extension's verified ENS/Swarm
snapshot requirement or prove Anon-RPC/browser connectivity. Configure and save
the matching Rabdi URL and watcher owner in extension options, plus working
snapshot gateways and Anon-RPC settings. Without those dependencies, the UI can
still correctly remain grey even when the Arkiv seed passes.

`npm test` runs `local.test.js`, which covers watcher intake, local durable retry, fake observation storage, hourly baseline generation and refresh, and owner-checked bundle filtering. The in-memory client is deliberately a fake; the tests do not exercise a real wallet, browser extension, ENSv2, Swarm, Arkiv write, or Anon-RPC worker.

`npm run check:arkiv-live` runs the funded Rabdi create, patch, owner-query and expiry gate with synthetic records. It uses the test signer configured in ignored `.env`, writes only to chain 7794095, and stores resumable journals under ignored `.bound/arkiv-live/`. Public transaction/entity identifiers and limitations are recorded in `packages/contracts/feasibility.md`. The broader `Docs/plan.md` end-to-end scenario still requires the browser, ENSv2, Swarm, Anon-RPC, controlled domain, and second HTTPS server. Never place secrets, end-user wallet details, request digests, or override choices in evidence.

`arkiv-stack.test.js` composes the actual local codec, submission journal, restricted transport, receipt checker, operation lookup and writer with a fake signer and fake JSON-RPC. It verifies composition and retry logic only; no transaction or signature is real.

`whole.test.js` connects the actual bounded HTTP intake, durable watcher, hourly baseline pipeline and Arkiv archive stack to a fake signer and fake RPC. It starts from an empty fake entity store and checks the returned owner-verified baseline. It does not exercise the extension or prove a live Arkiv write.

`incident-stack.test.js` exercises K distinct fake reports through HTTP intake, durable state, local signing/RPC fakes, incident/status publication, and recovery while retaining the historical incident. `services/watcher/service.test.js` also exercises a synthetic DNS drift plus one warning. None demonstrates a real provider, Swarm upload, onchain transaction, controlled domain or client integration.

`node scripts/integration/metrics-report.mjs /path/to/samples.json` summarizes labelled test outcomes. The input is an array of objects with exactly `coverage` (`mediated` or `unsupported`), `label` (`attack`, `benign`, or `unlabelled`), `outcome` (`hold`, `allow`, or `unavailable`), `latencyMs` (nonnegative number or null), and boolean `snapshotStale` and `staleFlagged`. Assign labels from the test fixture's known ground truth; a hold means the scenario was stopped or warned as defined by that fixture. The report includes each numerator and denominator, null for an empty denominator, and nearest-rank p50/p95 over measured latencies. This is an offline test helper, not user telemetry or evidence of real-world accuracy. Do not include wallet addresses, requests, or user choices.

`node scripts/integration/privacy-report.mjs /path/to/synthetic-manifest.json` scans captured test artifacts. The manifest contains exactly `artifacts` (objects with `name` and `path`), `canaries` (objects with `category` and synthetic `value`), and `publicCounterparties` (lowercase addresses that are legitimate public evidence). Categories are `wallet`, `amount`, `transaction_hash`, `request_digest`, and `user_choice`. Use distinct printable canaries of at least eight characters; the scanner refuses a canary that equals a permitted public counterparty. It checks literal and JSON-escaped text and raw hexadecimal bytes, and reports only artifact names and categories, never the matching values. Other encodings and unknown private values require additional checks, so an empty report is not a general privacy guarantee. Keep the manifest and captured files out of version control.

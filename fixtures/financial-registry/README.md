# BOUND financial-site registry

See [SITES.md](SITES.md) for 50 clickable website links, [sites.json](sites.json) for provenance and observed TVL, and [observations.json](observations.json) for the capture results. These are discovery candidates, not an allowlist. Nothing here changes extension trust, publishes Arkiv records, or writes ENS.

Initial capture: 50 sites attempted; 26 yielded 191 observable script assets, 19 had no comparable scripts and 5 were unavailable. Results are partial observations, not proof of complete execution coverage or safety.

## Selection and evidence

`scripts/registry/financial_registry.py discover` reads DefiLlama's public protocol API and scrapes the Ethereum.org DeFi and app directories. It sorts financial protocol records by TVL, restricts them to selected categories and reported EVM-supported chains, then takes 50 unique HTTPS hosts. TVL represents reported deposits, not actual transaction volume or user counts. It can involve double counting across protocols. A directory hostname match is only corroborating evidence, not domain ownership verification. Many entries have only the DefiLlama URL provenance; the output explicitly reports directory matches. Discovery does not establish the actual app host (e.g. a marketing homepage may differ from the wallet app), current protocol safety, or financial exposure of that exact frontend. This is not a claim of the global top 50 across all finance; centralized banking, CEX and non-EVM-only platforms are outside this first scope.

## Run

Python 3, an internet connection and trusted TLS certificates are required. There are no Python dependencies or credentials.

```sh
# Refresh the ranked candidate inventory (overwrites sites.json and SITES.md).
python3 scripts/registry/financial_registry.py discover
# Capture a single registry candidate.
python3 scripts/registry/financial_registry.py capture --site app.uniswap.org
# Capture all candidates; results go to ignored .bound by default.
python3 scripts/registry/financial_registry.py capture
# Explicitly save public evidence for submission/review.
python3 scripts/registry/financial_registry.py capture --output fixtures/financial-registry/observations.json
python3 -m unittest discover -s scripts/registry -p '*_test.py'
```

The script performs public HTTPS GETs, never connects wallets, signs, executes downloaded code or circumvents access restrictions. Failed/blocked sites and unavailable assets stay unavailable. It hashes fetched same-origin external scripts using SHA-256 over response body bytes, producing `sha256-<base64>` compatible with BOUND's hash format. An HTML hash is also recorded for diagnostics; it is not the execution-code baseline. Initial HTML cannot reveal every dynamically loaded chunk, module dependency, worker, service worker or injected script. Inline, cross-origin and query-bearing scripts are excluded and listed; each asset is capped at 2 MiB and at most 12 distinct script URLs per page are examined. Response redirects are recorded; same-origin asset redirects only are allowed. DNS validation is best effort, not a sandbox against a malicious DNS rebinding server. Use reviewed public inputs.

An observed hash is not a trusted hash. A compromised site can serve compromised bytes to this collector, and a selective attacker can serve clean bytes only to scanners. Hashes can also change for legitimate releases, geography and feature flags. Never auto-promote this output, imitate independent reporters or label a site safe because it ranked highly. For first-visit comparison, ship a previously reviewed reference; without one, report unknown.

## ENS and Arkiv publication plan

1. **Confirm actual origins.** For each candidate, verify official protocol documentation and the app link, identify exact hostname/port, supported numeric chain IDs and code routes. Keep source URLs and reviewer identity. App subdomains are separate entries. Do not infer an EVM chain ID from the Arkiv storage chain. Obtain protocol release manifests or operator confirmation where possible and compare independent observations over time.
2. **Review a baseline.** Check captured artifacts against official releases/reproducible builds, inspect gaps and collect execution-context evidence in controlled browser sessions. Approve immutable release hashes and expiry with an audit trail; failure to review keeps the entry untrusted. Freeze the manifest before publication. A script change is drift evidence, not proof of malicious behavior.
3. **Use the team's ENS name.** BOUND already uses one curator-controlled ENS root (configured by `BOUND_ROOT_NAME`) and the `bound.root.v1` text record. Do not register `aave.eth`, `uniswap.eth` or other projects' names and claim their authorship. We neither own their DNS domains nor gain control by entering them in ENS. A protocol self-attestation must be written by an authorized protocol account; curator evidence must be labelled as curator evidence. Optional names like `site-<sha256(host)>.OUR-ROOT.eth` are our registry labels only, not protocol identities.
4. **Prepare existing snapshot input.** After chain and contract review, add exact sites and verified deployment evidence to the curator's compile-input format (see `fixtures/snapshots` and `services/curator/src/compile.ts`). Do not copy contract addresses or mark production apps trusted on Sepolia without deployment evidence. Do not overwrite the current live root with this unreviewed registry.
5. **Publish the supported root.** Compile offline with `npm run curator -- compile <reviewed-input.json> <out-prefix>`. With a funded dedicated curator, an owned ENS name, correct pinned resolver, configured Swarm service/postage and the required env configuration, publish using `node --env-file=.env --experimental-strip-types services/curator/src/cli.ts publish <out-prefix>.bin`. Existing publication enforces a newer epoch, uploads/self-verifies snapshot bytes and sets `bound.root.v1`. Verify with `node --env-file=.env --experimental-strip-types services/curator/src/cli.ts read`. See `services/curator/src/env.ts` for required configuration. Mainnet and Sepolia names/roles are separate. Hashing sites does not itself require any ENS registration.
6. **Add frontend-manifest support before promising ENS hash comparisons.** The existing root snapshot does NOT contain these script hash baselines. Its digest is Keccak over canonical snapshot bytes, distinct from SHA-256 over individual JS assets. Proposed next implementation: a versioned frontend manifest with origin, chain, path, approved SHA-256 hashes, review provenance, release ID and expiry; upload it to Swarm and pin its independently checked digest/reference under a curator-controlled record such as `com.bound.frontend.v1`. An extension reader must authenticate name/resolver/record, verify the manifest digest/epoch/expiry and bind exact origin, chain and paths before comparison. That record and reader are a proposal, not implemented functionality. Never place JS SHA-256 into the ENS contenthash field; contenthash points to decentralized content, not an arbitrary script checksum.
7. **Publish watcher data independently.** Add reviewed scopes to the watcher, publish owned baseline/status entities on Arkiv, then verify query results and extension consumption. Existing frontend community aggregation still requires its normal-scope safety rules, three reporter keys and one hour; scraped observations must not bypass this. The registry is a curation input, not a replacement for that gate. A curator-approved frontend reference would need an explicit separate trust path in code. Retain expiry and stale/unknown behavior; do not whitelist based on visit counts.
8. **Rehearse the switch.** Freeze reviewed A, confirm its origin and script reference in the actual client, serve changed B at the same origin/path, and observe mismatch before a wallet action. Confirm additional redirect eligibility conditions, cancellation and the Swarm fallback flow. Test missing records and legitimate updates too. The plan is complete only after a real first-visit comparison is demonstrated; the generated files alone do not enable it.

No third-party ENS name registration, paid transaction or publication is performed by the discovery/capture scripts.

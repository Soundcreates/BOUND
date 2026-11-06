# Localhost demo: Arkiv records and verified snapshot

The exact demo origin is `http://127.0.0.1:8000`, with wallet transactions on Sepolia (`11155111`). `localhost:8000` is a separate host; fixtures also cover it and both port-8001 frame origins. Arkiv storage transactions use the Rabdi storage testnet (`7794095`).

## What is stored

Each demo scope has one synthetic `baseline` with empty counterparty/contract observations and one synthetic `status` with `state: normal`. These fixtures describe a controlled demo. They do not claim that real users connected or that an infrastructure scanner observed the site. The status feed reference identifies the synthetic fixture.

The separate verified snapshot contains the local demo scopes and the existing curated Sepolia Uniswap contracts used by the demo buttons. Those contract entries reuse the existing curated contract evidence. No unknown spender is added to the trusted lists. The snapshot is stored as an Arkiv `trust_snapshot` entity and authenticated by its digest, entity owner, epoch, and key in the Sepolia ENS `bound.root.v2` record for `bound-v2.eth`.

## How real data reaches Arkiv

1. The extension decodes a supported wallet request and minimizes any eligible observation. It batches reports to the configured watcher `/v1/observations` endpoint. Connection decisions and local warning history are not fabricated public observations.
2. The watcher validates reports and stores them in a durable local journal/outbox. Its monitoring and aggregation logic produces observations, baselines, drift records, and status transitions.
3. The Arkiv archive encodes validated records, signs storage transactions with the configured writer, submits them to Rabdi, waits for receipts, and verifies owner and payload by reading the entities back. Journals allow retrying uncertain submissions without creating another logical operation.
4. Independently, the curator compiles the trust snapshot, stores its canonical bytes in Arkiv, and publishes the authenticated pointer in ENS on Sepolia.
5. The extension verifies the ENS pointer and snapshot digest, then reads owner-filtered, unexpired watcher records. The connection gate requires the exact page/frame scopes to have a verified snapshot entry and a current normal status.

The demo seed invokes step 3 directly with explicitly synthetic baseline/status records; it does not exercise watcher intake, aggregation, or real monitoring.

## Commands

From the repository root:

```sh
# Read-only checks of existing fixtures and the published snapshot/policy path.
npm run demo:arkiv:check
npm run demo:snapshot:check

# Reconcile the original baseline/status seed and renew records when necessary.
npm run demo:arkiv:seed

# Prepare or publish a new localhost snapshot epoch when needed.
npm run demo:snapshot:prepare
npm run demo:snapshot:publish
```

Keep `.bound/arkiv-demo/` and `.bound/demo-snapshot/`; they contain the resumable journals and evidence. The snapshot command preserves existing verified entries and adds the four loopback scopes. Publishing creates a new epoch with seven-day snapshot validity. Check before publishing; a check needs no new transactions.

The command maps the existing Arkiv test-writer configuration into the curator's Arkiv configuration in process memory. It checks ENS authorization and can use the existing `CURATOR_PRIVATE_KEY` if `BOUND_CURATOR_PRIVATE_KEY` points to an unauthorized account. It never prints or copies keys into evidence.

Public identifiers from the initial publication:

- Epoch: `4`.
- Snapshot entity: `0x42fbece28ef32277eba7d45d13d25fe5fe7457d366be05a81b2206b0e7f7e181`.
- Sepolia ENS transaction: `0x574f9043a7cbd347db8f8a4058e3e7a609650611e8d8f8c0024d4d49abce1dc9`.
- Watcher/snapshot owner: `0xe63393558e36df643347326e7e03ad5fb0e6c867`.
- Latest local verification: `.bound/demo-snapshot/verification.json`.

## Browser flow

1. Build with `node apps/extension/build.mjs` and reload BOUND in `chrome://extensions`.
2. In BOUND settings, save root name `bound-v2.eth`, resolver `0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f`, the Rabdi RPC URL, and watcher owner above. Working anonymous RPC settings remain required by the browser path.
3. Serve the page with `python3 -m http.server 8000 --directory demo/test-dapp`. If using its cross-origin frame, also serve that directory on port 8001.
4. Reload `http://127.0.0.1:8000`, explicitly choose MetaMask, and use a disposable Sepolia account. Click **Connect real wallet**.
5. Inspect BOUND's **Recent checks on this site**. With working browser transports, the normal fixtures satisfy the connection prerequisite. A supported request then receives its separate transaction evaluation.

The CLI verification uses real RPC data and the extension's trust engine, Arkiv reader, and preconnection policy through direct diagnostic transport. It does not establish that the browser's Anon-RPC worker, installed-wallet interception, or every wallet connector is working. The provider-interception bugs described in `wallet-connection-audit.md` remain separate work.

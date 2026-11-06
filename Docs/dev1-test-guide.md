# Dev1 test guide

This guide separates checks that can be run now from live acceptance work that still needs a configured deployment. Record results per check; a local pass does not establish that the live integrations or all phase gates passed. Dev1 implementation is still in progress, including witness scoring and independently verified deployer lineage.

## 1. Local checks

From the repository root, with Node.js 22 or later:

```sh
npm ci
npm test
npm run test-workspace
npm run typecheck
node --test apps/extension/*.test.mjs
node apps/extension/build.mjs
```

Each command must exit successfully. The root `npm test` does not include the extension suite. These checks use local fixtures and do not demonstrate live services.

## 2. Fake-wallet browser checks

1. Open `chrome://extensions`, enable Developer mode, and load the built `apps/extension/dist` directory as an unpacked extension. Rebuild and reload the extension whenever its source changes.
2. In separate terminals at the repository root run:

   ```sh
   python3 -m http.server 8000 --directory demo/test-dapp
   ```

   ```sh
   python3 -m http.server 8001 --directory demo/test-dapp
   ```

3. Open `http://127.0.0.1:8000`, choose **Announce fake wallet**, and exercise **Request API**, **send API**, and **sendAsync API**. For each, test Cancel and Continue. Cancel must return error 4001; Continue must reach the fake wallet. The warning should identify the method, site, frame, and chain. The fake wallet does not contact a chain.
4. Repeat using the iframe controls. The warning must distinguish the top-level origin from the frame origin. Check that no unsupported path is shown as green. Grey is expected without a valid live snapshot and baseline.
5. Optionally run `node apps/extension/browser-check.mjs`. Set `BOUND_CHROMIUM_PATH` if needed; the selected browser must allow headless unpacked extensions. The retained-provider bypass demonstration is an expected limitation, not a protection pass.

Known open issue: the service worker can schedule a positive observation after Continue before the MAIN-world hook finishes its last chain/account check. If that final check cancels, a positive observation may still be queued even though the wallet never received the request. Do not mark the observation round-trip or state-change gate passed until this is fixed and tested. Any fix must bind a one-time completion to service-worker evaluation state; an unauthenticated page message must not be able to create an observation.

## 3. Prepare a live test deployment

Use a dedicated disposable testnet wallet and public endpoints. The extension Settings page accepts public URLs and addresses, never private keys. You need all of the following before the live scenario is meaningful:

- A published coherent Sepolia ENS root and matching unexpired snapshot served by two independent Swarm gateways. The matrix in [phase-0-chain-matrix.md](phase-0-chain-matrix.md) records intended values; verify the currently published record and use the actual matching resolver and network configuration.
- A configured watcher and public Arkiv writer with current owner-checked baseline and status records for the test site and chain. The deployment setup is in [the watcher README](../services/watcher/README.md). Its `allowedOrigins` must include `chrome-extension://<extension-id>` from `chrome://extensions`; a reloaded or separately installed extension can have a different ID. Its intake URL must end in `/v1/observations`, use HTTPS except for a local loopback endpoint, and be reachable from the browser.
- A working anonymous RPC bootstrap and destination. Configure both in extension Settings. The selected worker must run in the built extension; availability of a direct RPC endpoint alone does not prove this.
- A controlled test site and wallet on the matching test chain. Use only disposable assets. The same-origin HTTP fixture is described in [the hijack demo README](../demo/hijack-server/README.md); it is not a public DNS/TLS cutover test.

These services and their authorization are not automatically provisioned by the local checks. If any prerequisite is absent, record the corresponding live test as **not run**, not passed.

## 4. Live acceptance checks

Follow the complete scenario and negative cases in [plan.md, Phase 2](plan.md#phase-2--end-to-end-integration). At minimum, capture evidence for:

1. The extension reads the published root and matching Swarm bytes; modified bytes, expired snapshots and lower or conflicting epochs do not become trusted. Check rollback again after an extension restart.
2. A benign request on a seeded site reaches the real test wallet unchanged after Continue; Cancel does not reach it. A malicious unlimited approval identifies the spender, opens a warning, and never reaches the wallet after Cancel. An escalated request requires the typed confirmation shown in the warning.
3. Start with an empty observation set. Trace an eligible benign request through extension queue, watcher intake, Arkiv observation, hourly baseline, and refreshed extension baseline. An already-populated baseline is not proof of this round trip. Red-warning overrides and observations during an incident must not enter the positive baseline.
4. Verify extension-side Arkiv owner and expiry filtering. A record from a different writer must not alter the decision. Observation alone must not grant trust.
5. Capture network evidence that eligible site-specific and counterparty reads use the anonymous worker, including on failures; no direct RPC fallback is allowed. Measure the latency and coverage described in the plan. A timeout must leave the relevant trust unavailable.
6. With the separately controlled DNS/TLS setup, demonstrate corroborated drift and the pre-connection alert; then restore the original state. Check that OS/browser notification settings and asynchronous fetch timing did not hide or delay the alert. The current notification implementation has not yet passed this timing gate.
7. Run the incident trigger, negative threshold, recovery, independent gateway, ENS attestation, and unavailable-service cases in the plan. A pass in one case does not substitute for the others.

## 5. Report results

For each check, record pass, fail, or not run; the command or scenario; browser and wallet versions; test network; and any relevant public transaction hash, Arkiv entity key, or Swarm reference. Include the exact error for failures. Do not share private keys, tokens, secret-bearing URLs, personal wallet details, or the contents of `.env`.

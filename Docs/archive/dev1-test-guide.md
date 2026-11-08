> Archived from the pre-merge development branch on 2026-11-09. This is historical project state; paths, deployment details, and completion claims may be stale.

# Dev1 test guide

This guide separates the dev1 code gates from live acceptance work that still needs a configured deployment. The decoder, role-aware scoring, bridge, UI, local reporting, and adapter wiring are implemented and locally testable. Record results per check; local passes do not establish that the real wallet and external integration gates passed.

## Implementation status

- **Phase 0 prototype:** implemented for the fake EIP-6963 dApp and headless Chromium check. Real-wallet coverage remains unverified.
- **Phase 1 dev1 code:** implemented; the local unit and browser checks below cover mediation, decoding, policy caps, stale decisions, provider bypass disclosure, and privacy filtering.
- **Phase 2 dev1 wiring:** snapshot, ENS, Swarm, Arkiv, watcher, and Anon-RPC consumers are wired behind the extension adapters. Live acceptance remains open until the configured services, real wallet, transport evidence, and observation-to-baseline round trip pass.
- **Phase 3 dev1 handoff:** settings, unsupported-state and bypass wording, typed confirmation, and local warning/history views are implemented. Cross-provider/injection-order coverage and live revocation-link behavior still need evidence.

## 1. Local checks

From the repository root, with Node.js 22 or later:

```sh
npm ci
npm test
node --test client/extension/*.test.mjs
node --test shared/decoder/*.test.mjs shared/policy-core/*.test.mjs
node client/extension/build.mjs
node client/extension/browser-check.mjs
```

The root `npm test` does not include the extension suite. These checks use local fixtures and do not demonstrate live services. The browser check requires an installed Chromium-family browser that supports headless unpacked extensions.

## 2. Fake-wallet browser checks

1. Open `chrome://extensions`, enable Developer mode, and load the built `client/extension/dist` directory as an unpacked extension. Rebuild and reload the extension whenever its source changes.
2. In separate terminals at the repository root run:

   ```sh
   python3 -m http.server 8000 --directory client/demo/test-dapp
   ```

   ```sh
   python3 -m http.server 8001 --directory client/demo/test-dapp
   ```

3. Open `http://127.0.0.1:8000`, choose **Announce fake wallet**, and exercise **Request API**, **send API**, and **sendAsync API**. For each, test Cancel and Continue. Cancel must return error 4001; Continue must reach the fake wallet. The warning should identify the method, site, frame, and chain. The fake wallet does not contact a chain.
4. Repeat using the iframe controls. The warning must distinguish the top-level origin from the frame origin. Check that no unsupported path is shown as green. Grey is expected without a valid live snapshot and baseline.
5. Optionally run `node client/extension/browser-check.mjs`. Set `BOUND_CHROMIUM_PATH` if needed; the selected browser must allow headless unpacked extensions. The retained-provider bypass demonstration is an expected limitation, not a protection pass.

Positive observations require a one-time receipt bound to the evaluated request, payload/state digests, tab, frame, and document. The MAIN-world hook sends the receipt only after its final state check and forwarding the frozen request to the wallet provider; the service worker rechecks the current document and policy before queueing. Unit and fake-service-worker tests cover replay, wrong-frame, stale-document, state-change, and incident cases. The live watcher round trip remains unverified.

Revocation links select the chain where Revoke.cash supports it and display the exact token/spender pair beside the link. The current UI asks the user to find that pair manually; token/spender URL prefill is not claimed because a supported official deep-link contract has not been verified.

## 3. Prepare a live test deployment

Use a dedicated disposable testnet wallet and public endpoints. The extension Settings page accepts public URLs and addresses, never private keys. You need all of the following before the live scenario is meaningful:

- A published coherent Sepolia ENS root and matching unexpired snapshot served by two independent Swarm gateways. The matrix in [phase-0-chain-matrix.md](phase-0-chain-matrix.md) records intended values; verify the currently published record and use the actual matching resolver and network configuration.
- A configured watcher and public Arkiv writer with current owner-checked baseline and status records for the test site and chain. The deployment setup is in [the watcher README](../server/watcher/README.md). Its `allowedOrigins` must include `chrome-extension://<extension-id>` from `chrome://extensions`; a reloaded or separately installed extension can have a different ID. Its intake URL must end in `/v1/observations`, use HTTPS except for a local loopback endpoint, and be reachable from the browser.
- A working anonymous RPC bootstrap and destination. Configure both in extension Settings. The selected worker must run in the built extension; availability of a direct RPC endpoint alone does not prove this.
- A controlled test site and wallet on the matching test chain. Use only disposable assets. The same-origin HTTP fixture is described in [the hijack demo README](../server/demo/hijack-server/README.md); it is not a public DNS/TLS cutover test.

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


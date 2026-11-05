# Phase 0 browser prototype

Run `node apps/extension/build.mjs` from the repository root, then load `apps/extension/dist` as an unpacked extension in Chromium. In separate terminals, serve `demo/test-dapp` on ports 8000 and 8001 (`python -m http.server 8000 --directory demo/test-dapp` and the same command with `8001`). Open `http://127.0.0.1:8000`, announce the fake wallet, and choose one of the three provider APIs. Use the iframe buttons to see the top-level and requesting-frame origins differ. The extension opens its own warning window; Cancel rejects with EIP-1193 code 4001, while Continue reaches only the fake provider. Rebuild and reload the extension and page after source changes.

On Windows, `node apps/extension/browser-check.mjs` runs a headless Edge check of the built extension with a fake wallet. It checks Cancel through `request`, Continue through `request`, `send`, and `sendAsync`, a forged page decision, request mutation, chain and account changes, cross-origin frame details, navigation, selected poisoned built-ins, decision replay, and service-worker termination during a warning. It creates disposable browser profiles under the ignored `dist` directory.

## Feasibility notes

- The test dApp emits EIP-6963 after the extension's `document_start` hook has installed its listener. The hook also attempts an in-place patch of `window.ethereum`.
- The isolated relay creates a per-document channel token and dispatches it synchronously to the MAIN hook. The manifest lists the MAIN hook first; the hook consumes the token before page scripts and consumes replies before page listeners. Page messages can request warnings or cancellation but cannot authorize a decision without the token. The headless Edge fake-wallet flow exercises startup, one forged decision, and selected built-in poisoning; other injection orders still need browser checks.
- The service worker gets top-level URL, frame URL, frame ID, tab ID, and document ID from Chrome's message sender. Decisions are accepted only from the extension warning page. The warning is never page DOM.
- Pending decisions live in service-worker memory. In the headless Edge check, stopping the worker invalidates the decision and cancels the request; the popup remains stale. The MAIN hook also cancels after a 50-second timeout.
- The hook captures the JSON, object, collection, promise, message, and timeout intrinsics it uses at `document_start` and clones/freeze-checks request data. The browser check covers selected JSON, object, array, set, and string poisoning after installation.
- The frozen read-only list and `eth_sendRawTransaction` pass untouched. Chain switching and `wallet_addEthereumChain` are treated as unsupported and get an extension-owned choice.
- No real wallet, chain, policy snapshot, or live baseline is connected. Without a baseline the evaluator displays grey; this prototype cannot produce green.
- The offscreen shell starts a `WORKERS` host, allows only read RPC methods, and times out at 1.5 seconds. Its worker intentionally returns `anon_rpc_not_configured` until Developer 2 supplies the real anonymizing transport; there is no public-RPC fallback.

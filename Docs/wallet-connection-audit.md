# Wallet connection audit — 2026-11-06

Scope: extension provider interception, connection policy, local decision history, and demo wallet selection. This audit uses source inspection and isolated Node VM reproductions of the actual `hook.js`. It does not establish the live behavior or property descriptors of Binance, MetaMask, or Phantom.

## Findings

### 1. High: immutable providers bypass connection enforcement

`client/extension/hook.js:201–202` requires assignment to the wallet's `request` property. If the property is immutable, the catch at lines 260–262 reports `bypass_possible` but cannot stop the original wallet method. A dApp calling that method connects without reaching `handleRequest`, so there is no connection decision history. EIP-6963 announcements receive this same in-place patch attempt; discovering a wallet does not establish that it is mediated.

Reproduction: the same simulated extension block decision rejected a mutable provider with code 4001 (one gated request, zero forwarded connections). A frozen provider returned accounts (zero gated requests, one forwarded connection, bypass reported).

This is a plausible explanation for Binance connecting while another wallet is blocked, not confirmation that Binance's live provider is immutable. Retained original methods and connector-specific paths are additional possibilities.

Remediation: track interception capability for each provider; make the demo require a confirmed mediated provider before calling it. A controlled EIP-6963 wrapper can cover consumers using the wrapper, but cannot revoke original method references already held by arbitrary pages. Do not represent an in-page patch as universal wallet connection enforcement.

### 2. High: failed optional-method patches cause repeated wrapping

`hook.js:201` patches `request` before trying `send` and `sendAsync`. The provider enters the deduplication WeakSet only at line 247, after all patches succeed. An immutable optional `send` therefore leaves `request` patched but the provider unregistered. Repeated announcements and discovery patch it again, capturing an already wrapped request as the supposedly original state-read path. Internal `eth_accounts` reads can then enter the public gate, adding nested requests and failures.

Reproduction: a provider with writable `request` and immutable `send` acquired a different `request` wrapper after another discovery event. Both patch attempts reported bypass.

Remediation: retain original methods and per-method patch state once; make discovery idempotent after partial failures. Test combinations of writable and immutable methods.

### 3. High integration gap: the supplied demo cannot satisfy the strict site gate

Follow-up: the localhost snapshot was subsequently published as epoch 4 and its
live preconnection prerequisites passed. See `localhost-arkiv-demo.md`. The
original seed file still lacks these scopes; use the documented snapshot tool.

`client/extension/decision-context.mjs:169–170` returns unknown unless the exact host appears in the verified snapshot. `sw.js:180` allows only current normal status. The supplied `fixtures/snapshots/demo-seed.compile-input.json` has no `127.0.0.1:8000` entry. Therefore a correctly intercepted wallet is expected to be blocked on the local demo when using that seed. Sepolia selection cannot satisfy this separate site prerequisite.

The same error also covers missing configuration, invalid or expired snapshots, failed anonymous Arkiv reads, missing status records, and provider-state failure. The screenshot's error cannot distinguish those causes.

Remediation: provide a deliberate local test configuration with matching verified site and current watcher records, and return specific diagnostic reasons. Preserve the requested block-on-unavailable policy; do not silently whitelist localhost as trusted.

### 4. Medium: ordinary RPC traffic exhausts the connection rate limit

`sw.js:133–145` counts every intercepted method before checking whether it is read-only. Eight requests in ten seconds exhaust a frame's quota, so subsequent chain polling, account reads, and connection attempts are cancelled. All wallets in the same frame share this quota. The rejection at line 141 has no diagnostic reason or history entry.

Source-confirmed; no live wallet reproduction in this audit.

Remediation: distinguish bounded ordinary RPC traffic from interactive pending requests; record explicit throttling diagnostics without storing sensitive RPC payloads.

### 5. Medium: legacy callback responses are double wrapped

`hook.js:221` resolves the entire JSON-RPC response returned by legacy `send`; line 229 places it inside another response's `result`.

Reproduction: an `eth_chainId` callback returned `{result: {jsonrpc: "2.0", id: 7, result: "0xaa36a7"}}` instead of `{result: "0xaa36a7"}`. Connectors expecting a scalar chain identifier can fail independently of the policy gate.

Remediation: preserve the legacy callback response contract and separately normalize promise-returning APIs.

### 6. Medium: discovery and demo selection still have uncovered paths

`hook.js:322–331` discovers `window.ethereum`, EIP-6963 announcements, and a few startup events. It does not discover wallet-specific namespaces or nested `ethereum.providers`, and it does not mediate direct `connect`/`enable` aliases. WalletConnect is outside this in-page provider patch. A successful visible connection therefore does not prove an allow decision.

`client/demo/test-dapp/app.js:105` also falls back to `window.ethereum` if selected-provider lookup fails. Lines 108–115 use mutable shared provider/account state across asynchronous connection attempts, allowing selection changes or concurrent clicks to show stale results and re-enable controls for the wrong selection.

Remediation: select providers explicitly, remove silent fallback, bind each attempt to one provider and selection generation, and discard stale results. Publish coverage per provider rather than implying wallet-wide enforcement.

## Recommended order

1. Make provider instrumentation idempotent and expose per-provider coverage, including immutable providers.
2. Make the demo require that coverage and bind each attempt to its selected provider.
3. Add distinct connection failure diagnostics and a complete local test configuration.
4. Fix rate limiting and legacy response normalization.
5. Verify each installed wallet with a clean session on Sepolia, including immutable providers, delayed injection, repeated announcements, and concurrent selection changes.

The current code does not provide consistent connection enforcement across wallets. No production source files were changed during this audit.

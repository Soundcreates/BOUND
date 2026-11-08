# Real-site wallet interception: diagnosis, fix, remaining plan

**Date:** 2026-11-06

**Inputs:**
- Live Playwright probes of the built extension on app.ens.domains, app.aave.com and app.uniswap.org, using a MetaMask-shaped wallet (a Proxy-wrapped provider plus an EIP-6963 `io.metamask` announcement).
- A read-only diagnosis by GPT-6.1 Sol: [`reviews/2026-11-06-real-site-interception-gpt-6.1-sol.md`](reviews/2026-11-06-real-site-interception-gpt-6.1-sol.md).

## 1. What was actually wrong (measured, not guessed)

| # | Cause | Evidence | Status |
|---|---|---|---|
| 1 | **The hook was triggering, but connections were decided silently.** `eth_requestAccounts` and `wallet_requestPermissions` were scored and then cancelled with no window (score < 80) or allowed with no window. Every real site scores below 80 today, so the user saw "Connection cancelled" or nothing at all. Because no connection was ever made, no transaction could follow. | BOUND history on ENS and Aave: `wallet_requestPermissions -> connection blocked`. Sol rank 1. | **Fixed** |
| 2 | **Passive `eth_accounts` polling was gated as a connection and counted against the 8-per-10 s limit.** Aave polled it 6 times, each "blocked", so the dApp concluded the wallet was disconnected, and the rate limit then cancelled real requests. | Probe history; Sol ranks 9 and 11 | **Fixed** |
| 3 | **Uniswap never uses `window.ethereum` to connect.** It uses MetaMask Connect / the Multichain API (CAIP-25): `wallet_getSession` / `wallet_createSession` / `wallet_invokeMethod`. These travel over a `chrome.runtime` port to MetaMask (`{type:"caip-348"}`) or over `window.postMessage` (`metamask-contentscript` / `metamask-multichain-provider`). BOUND's provider patch never sees them. | Probe captured `metamask-contentscript` postMessages, with no provider calls. Framing confirmed in `@metamask/multichain-api-client@0.12.0`. Sol section 3 (MetaMask Connect) | **Fixed** (both transports wrapped) |
| 4 | `wallet_switchEthereumChain`, `wallet_getCapabilities` and `wallet_getCallsStatus` opened "unsupported" warnings. | ENS and Aave probes | **Fixed** (pass-through; the wallet prompts for these itself) |

The rows below come from Sol's review and remain open:

| # | Remaining gap | Plan |
|---|---|---|
| 5 | In-place `provider.request =` assignment fails on frozen providers. A dApp that captured `provider.request.bind(provider)` before the hook ran (viem `custom` transport) keeps the original. | **R1:** wrapper registry. Wrap at definition time: trap `window.ethereum` assignment, and re-announce an EIP-6963 Proxy wrapper from a capture-phase listener registered first. Report per-provider coverage. |
| 6 | Wallets reachable only through other paths: `ethereum.providers[]`, `window.phantom.ethereum`, `window.binancew3w.ethereum`. | **R2:** discover and wrap these aliases with the same registry. |
| 7 | Partial patch failures cause repeated wrapping (prior audit, finding 2). | Part of R1: record per-method patch state once. |
| 8 | `eth_sendRawTransaction` is classified read-only, but it broadcasts a transaction. | **R3:** review it as a write (BOUND can't decode a signed transaction, so treat it as unsupported). |
| 9 | WalletConnect / Reown QR, mobile and embedded-wallet flows go through app-owned providers or remote relays. | **Out of reach of an in-page hook.** Disclose as a coverage limit; never claim universal coverage. |
| 10 | The Chrome site-access setting can stop content scripts on public sites. | **User check:** `chrome://extensions` → BOUND → Site access = "On all sites". |

## 2. What changed in code

| File | Change |
|---|---|
| `client/extension/sw.js` | `CONNECTION_METHODS` = `eth_requestAccounts`, `wallet_requestPermissions`, `wallet_createSession`. These **always open a BOUND review window** and are never cancelled on score (owner rule: never block). The tier comes from the connection score: pass ≥ 80 / warning ≥ 40 / huge ≥ 16 / firewall. An incident or drift is always the firewall tier, which requires typing `I UNDERSTAND`. Passive reads (`eth_accounts`, `eth_coinbase`, `metamask_getProviderState`, and every other read-only method) pass without UI and **before** the rate limiter. |
| `client/extension/warning.html/js` | A connection view with a tier header, honest confidence wording ("Policy confidence N% … not a measured probability that the site is safe"), and the full per-check calculation table: weight, outcome, points, running total, and the formula. |
| `client/extension/hook.js` | Wraps `window.postMessage` and `chrome.runtime.connect` ports for MetaMask's Multichain transport. `wallet_createSession` is reviewed as a connection. `wallet_invokeMethod` is reviewed **as its inner EVM request** (e.g. `eth_sendTransaction` is decoded normally). Cancel returns a JSON-RPC `4001` in the transport's own reply format. Other messages pass untouched. |
| `shared/decoder/index.mjs` | Read-only pass-through for chain switching, capability and status queries, subscriptions and extra block/tx reads. Signing and value-moving methods are unchanged. |
| `client/extension/sw-fake-integration.test.mjs` | Asserts the new contract: passive reads open no UI; connections always open a review; incident/drift need the typed phrase but stay continuable; an unverified requesting frame cannot ride on a verified top page. |

## 3. Verification

| Check | Result |
|---|---|
| Playwright on app.ens.domains and app.aave.com | BOUND review opens for `wallet_requestPermissions` / `eth_requestAccounts`; Continue → the wallet receives it → `connected: true` |
| Playwright on app.uniswap.org | BOUND review opens for `wallet_createSession` (Multichain path); forwarded after Continue |
| `/tmp/bound-pw/multichain-check.mjs` (exact MetaMask transport framing) | **9/9**: getSession passes; createSession reviewed, then forwarded with the result returned; Cancel → `4001` and nothing sent to the wallet; `invokeMethod(eth_sendTransaction)` reviewed with decoded spender; reads pass; ordinary `postMessage` unaffected |
| Extension unit/integration suite | 86/93. The 7 failures (settings, trust-engine) **also fail on the committed code without these changes** |
| Root `npm test` | 473/529, **identical with and without these changes** (the failures predate this work) |

**Not verified:**
- The **real** MetaMask extension. Playwright uses a MetaMask-shaped fake, and the real wallet needs a seed phrase.
- The `chrome.runtime` port transport. Its code mirrors the tested `postMessage` path, but no Chromium test exercised it.
- The Uniswap modal finishing its connection. That depends on Uniswap's client accepting the fake wallet's session reply; BOUND's forward is proven by the deterministic check.

## 4. How to see it in your browser

1. Run `node client/extension/build.mjs`, then reload BOUND in `chrome://extensions`. Confirm **Site access → On all sites**.
2. Hard-reload the dApp tab. Content scripts only attach to newly loaded pages.
3. Click Connect → MetaMask. The BOUND review window opens first, showing the score calculation. Continue → MetaMask's own prompt.

## 5. Next steps, in order

1. **R1 + R2:** wrapper registry and alias discovery (frozen providers, captured `request`, `ethereum.providers`, Phantom and Binance namespaces), with per-provider coverage in the popup.
2. **R3:** `eth_sendRawTransaction` as a reviewed write.
3. Real-MetaMask manual pass on Sepolia across ENS, Aave and Uniswap, including the port transport.
4. Firewall tab and the longer review lifetime from `request-decision-ux.md` (the current window still expires after 45 s).

> Read-only diagnosis by GPT-6.1 Sol (Codex CLI, web search, reasoning high), 2026-11-06. Input to `Docs/real-site-interception.md`, which records what was verified and implemented.

# Plan: diagnose the selected wallet path, then replace provider mutation

**Prioritize three things: verify which build Chrome loaded, make intercepted connections visible, and replace in-place mutation with provider wrappers.** SDK and WalletConnect paths need separate coverage; injected-provider wrapping cannot provide universal wallet mediation.

This was read-only: no files created, edited, deleted, or committed. I inspected the requested code, searched live primary sources, and ran in-memory VM reproductions of `hook.js`. I did **not** run wallet interactions on the production sites.

## 1. Establish the code version before reproducing

The workspace changed during this review:

| Version | Observed behavior |
|---|---|
| Committed `6d3a6d7` and initial source | Connection methods silently allowed/cancelled; every intercepted request counted toward eight requests per ten seconds. |
| Source at last inspection | `sw.js` opens reviews for `eth_requestAccounts` / `wallet_requestPermissions`; passive reads bypass the interactive limiter. |
| `apps/extension/dist` at last comparison | Still differed from the updated `sw.js`, `warning.js`, and `warning.html`. `hook.js` matched. |

The concurrent edits were not mine. References below distinguish the committed behavior from current source.

**First diagnostic action:** inspect BOUND’s loaded directory, extension version, and worker source in `chrome://extensions`. A source fix does not affect an already loaded build. The build process copies files into `dist`; Chrome must load that directory and the extension and dApp must be reloaded. See [build.mjs:9](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/build.mjs:9) and [PHASE0.md:3](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/PHASE0.md:3).

## 2. Ranked diagnosis

Likelihood describes explanatory strength for the report, not a measured probability. Checks **C1–C6** are supplied immediately after the table.

| Rank | Root cause and mechanism | Code and external evidence | Empirical confirmation | Likelihood |
|---|---|---|---|---|
| **1** | **Invisible connection decisions in the loaded baseline.** BOUND intercepts successfully but never opens a window. Missing verification can cancel connection before MetaMask opens. | `sw.js@6d3a6d7:193,202,217`: five connection/account methods take the silent branch. [connection-score.mjs:17](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/connection-score.mjs:17) requires snapshot/domain/watcher evidence; [decision-context.mjs:173](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/decision-context.mjs:173) returns unknown for absent sites. Wallet access requests themselves are ordinary provider RPC calls. [MetaMask provider API](https://docs.metamask.io/metamask-connect/evm/reference/provider-api/). | **C1 + C3**: click Connect; find a `BOUND_REQUEST_V1` and local `connection allowed/blocked` history without a review window. Verify the loaded worker contains the baseline branch. | **Certain baseline defect; high explanation.** Concurrent source changes address it, but require build verification. |
| **2** | **The selected MetaMask connector uses an SDK-owned path.** A MetaMask button does not guarantee calls through the injected provider. | Hook discovery covers only globals and announcements: [hook.js:324](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:324). Current wagmi MetaMask source creates a Connect client with `skipAutoAnnounce: true`, calls `instance.connect()`, and subsequently returns its provider. [wagmi MetaMask connector](https://github.com/wevm/wagmi/blob/main/packages/connectors/src/metaMask.ts). | **C5**: break in the connector’s `connect()` and inspect whether it calls the injected provider or SDK client. Correlate wallet UI with zero BOUND request events. | **High for SDK-based connector configurations; deployed-site versions unverified.** |
| **3** | **Chrome site access prevents injection.** localhost can have access while public sites do not. | [manifest.json:18](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/manifest.json:18) already matches HTTPS, so a missing HTTPS match is not the explanation. User-selected site access can still restrict execution. [Chrome site-access documentation](https://support.google.com/chrome_webstore/answer/2664769?hl=en). | **C4** checks that Chrome parsed both content scripts. Inspect “On click/On select,” “On specific sites,” profile, enabled state, and incognito access. Grant the intended access and reload. | **Medium–high; quickest exclusion.** |
| **4** | **A dApp captured the original request before patching.** Changing `provider.request` cannot replace an existing bound function. | Assignment occurs at [hook.js:201](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:201). Viem’s custom transport stores `provider.request.bind(provider)` when the transport is instantiated. Wagmi obtains connector providers and constructs that transport. [viem custom transport](https://github.com/wevm/viem/blob/main/src/clients/transports/custom.ts), [wagmi getConnectorClient](https://github.com/wevm/wagmi/blob/main/packages/core/src/actions/getConnectorClient.ts). | **C2** compares direct selected-provider calls with the dApp action. In a controlled VM, save `request.bind(provider)` before running the hook; invoke it afterward. | **High if interception starts late or providers change; conditional otherwise.** |
| **5** | **Provider identity/discovery mismatch with three installed wallets.** The selected announced object can differ from `window.ethereum`; nested providers and wallet namespaces are undiscovered. | [hook.js:325](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:325) patches announced objects but does not enumerate aliases. Wagmi explicitly searches `ethereum.providers`; Phantom documents `window.phantom.ethereum`; Binance documents `window.binancew3w.ethereum`. [wagmi injected connector](https://github.com/wevm/wagmi/blob/main/packages/core/src/connectors/injected.ts), [Phantom](https://docs.phantom.com/ethereum-monad-testnet-base-and-polygon/getting-started), [Binance](https://developers.binance.com/en/docs/products/web3-connect/evm-compatible-provider). | **C2** inventories object identity, descriptors, flags, namespaces, and announced metadata. Compare the provider used by the connector with the instrumented object. | **Medium–high with multiple wallets.** Different aliases alone do not bypass if they reference the same successfully patched object. |
| **6** | **Frozen/non-writable providers bypass assignment; partial failures cause repeated wrapping.** | [hook.js:201](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:201), `234`, `244` assign methods; deduplication occurs only at `247`. A failed optional method leaves earlier patches installed. EIP-6963 discusses freezing providers. MetaMask’s current initialization uses a Proxy, but its shown traps do **not** establish non-writable methods. [EIP-6963 security considerations](https://eips.ethereum.org/EIPS/eip-6963#security-considerations), [MetaMask initialization](https://github.com/MetaMask/providers/blob/main/src/initializeInpageProvider.ts). | **C2**, plus VM cases below. Inspect descriptors rather than assuming “Proxy means immutable.” | **Confirmed implementation defect; live MetaMask immutability unproven.** |
| **7** | **WalletConnect/Reown or embedded-wallet flow.** Its provider can live inside application modules rather than any hooked global. | No WalletConnect adapter in [hook.js:324](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:324). Reown supplies a separately instantiated EIP-1193 provider for WalletConnect. AppKit/Web3Modal also supports injected discovery. [Reown Ethereum Provider](https://docs.reown.com/advanced/providers/ethereum), [AppKit discovery](https://reown.com/blog/appkit-v3-1-industry-leading-eip-6963-support-live). | **C5**: distinguish the installed-wallet option from QR/mobile/WalletConnect; inspect connector call stacks and relay traffic. No BOUND event alone is insufficient proof. | **Certain gap when that route is selected; route-dependent.** |
| **8** | **Startup/announcement races.** Discovery occurs at startup, 1 s, 2.5 s and events; there is no interception of future assignments. The announcement listener does not suppress originals. | [hook.js:320](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:320). Wagmi stores announced provider references; mipd deduplicates by UUID. A later wrapper announcement need not replace the first reference. [wagmi discovery](https://github.com/wevm/wagmi/blob/main/packages/core/src/createConfig.ts), [mipd store](https://github.com/wevm/mipd/blob/main/src/store.ts). | **C4**, plus fixture cases: announce before hook, inject after 2.5 s without events, replace global after successful instrumentation, construct viem transport before patch. | **Medium.** `document_start` improves timing but does not establish priority over other extensions. |
| **9** | **Rate limiting and extra state reads cause failures.** The baseline counts reads before classification. Partial rewrapping can route internal reads through additional gates. | `sw.js@6d3a6d7:161–167`; current limiter is [sw.js:205](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:205). [hook.js:167](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:167) reads chain/accounts before every call and again before interactive forwarding. Connector account/chain probes are visible in [wagmi source](https://github.com/wevm/wagmi/blob/main/packages/core/src/actions/getConnectorClient.ts). | **C6**: nine parallel chain reads. Baseline rejects after the quota; current source should allow them. Use fixture raw-RPC counters to measure amplification. | **High baseline failure mode; passive-read exhaustion addressed in concurrent source.** |
| **10** | **Frame-specific injection/bridge failure.** A provider in an iframe belongs to another realm. Sandboxed opaque origins complicate relay origin checks. | `all_frames` and `match_about_blank` are present, but `match_origin_as_fallback` is absent: [manifest.json:21](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/manifest.json:21). [relay.js:6](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/relay.js:6) checks origin; messages target `location.origin`. [Chrome related frames](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#inject-in-related-frames), [iframe sandbox behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox). | Run **C2/C4 in every frame**, including cross-origin, `about:blank`, `srcdoc`, blob and sandbox fixtures. Check for `postMessage` exceptions and absent relay acknowledgements. | **Medium–low for ordinary top-level flows; higher for embedded wallets.** |
| **11** | **Pre-gate failure or legacy incompatibility.** State reads can time out, relay initialization can fail, and legacy callback responses can be nested incorrectly. | State timeout: [hook.js:169](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:169). Bridge deadline: `320–323`. Legacy response handling: `221,229`. Current worker still cancels invalid connection state before UI at [sw.js:223](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:223). Legacy signatures differ from `request()`. [EIP-1193 legacy APIs](https://eips.ethereum.org/EIPS/eip-1193#appendix-iii-legacy-provider-api). | **C1** plus pause on exceptions; fixture locked/uninitialized state, delayed relay and callback `send`. Confirm whether a request ever reaches the worker. | **Medium–low overall; confirmed compatibility defects.** |
| **12** | **Method classification differs from expectations.** Batch/signature calls are mostly gated; raw signed broadcasts are explicitly passed. | [decoder/index.mjs:1](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/packages/decoder/index.mjs:1), `69–85`, `245`. Batch submission is a write operation. [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792). | Inspect **C1’s actual method**, then use the classification table below. | **Low explanation for missing batch/signature UI; definite raw-broadcast gap.** |

### VM evidence obtained in this review

These exercised the actual hook with a simulated cancellation response:

| Provider scenario | Result |
|---|---|
| Mutable MetaMask-like Proxy | One gated request; rejected with `4001`; no connection forwarded. |
| Frozen provider | Connection fulfilled; **zero gated requests**; bypass reported. |
| Request bound before hook | Connection fulfilled; **zero gated requests**; no bypass detected. |
| Writable `request`, non-writable `send` | Another discovery produced a different request wrapper: repeated wrapping confirmed. |

### Exact browser checks

Run these in the dApp’s **MAIN** console. They are diagnostic snippets, not changes performed during this research.

**C1 — observe BOUND traffic without printing payloads or channel tokens.** Install before clicking Connect:

```js
globalThis.boundTrace = [];
window.addEventListener("message", e => {
  const m = e.data;
  if (e.source !== window || !m?.type?.startsWith("BOUND_")) return;
  const row = {
    at: performance.now(), type: m.type, id: m.id,
    method: m.request?.method, action: m.action,
    coverage: m.coverage
  };
  boundTrace.push(row);
  console.log("[BOUND probe]", row);
}, { capture: true });
```

No event means “not observed by this probe,” not proof that no wallet request occurred.

**C2 — inventory globals and EIP-6963 identities:**

```js
globalThis.boundProviders = [];
const ids = new WeakMap();
let next = 0;

function descriptor(p, key) {
  for (let q = p; q; q = Object.getPrototypeOf(q)) {
    const d = Object.getOwnPropertyDescriptor(q, key);
    if (d) return d;
  }
}

function inventory(source, p, info = {}) {
  if (!p || !["object", "function"].includes(typeof p)) return;
  try {
    if (typeof p.request !== "function") return;
    if (!ids.has(p)) ids.set(p, ++next);
    const d = descriptor(p, "request");
    boundProviders.push({ source, provider: p, info });
    console.table([{
      source, id: ids.get(p), rdns: info.rdns,
      sameAsGlobal: p === window.ethereum,
      isMetaMask: !!p.isMetaMask, isPhantom: !!p.isPhantom,
      frozen: Object.isFrozen(p),
      writable: d?.writable, configurable: d?.configurable,
      accessor: !!d?.get,
      requestSource: Function.prototype.toString.call(p.request).slice(0, 100)
    }]);
  } catch (error) {
    console.warn(source, error.name, error.message);
  }
}

inventory("window.ethereum", window.ethereum);
window.ethereum?.providers?.forEach((p, i) =>
  inventory(`ethereum.providers[${i}]`, p));
inventory("phantom.ethereum", window.phantom?.ethereum);
inventory("BinanceChain", window.BinanceChain);
inventory("binancew3w.ethereum", window.binancew3w?.ethereum);
inventory("binancew3w", window.binancew3w);
inventory("web3.currentProvider", window.web3?.currentProvider);

window.addEventListener("eip6963:announceProvider", e =>
  inventory("eip6963", e.detail?.provider, e.detail?.info));
window.dispatchEvent(new Event("eip6963:requestProvider"));
```

Then select the recorded MetaMask object and make one passive probe:

```js
globalThis.boundSelected =
  boundProviders.find(x => x.info.rdns === "io.metamask")?.provider;

await boundSelected?.request({ method: "eth_chainId" });
```

A BOUND event proves that particular call was intercepted. If direct calls are intercepted but the site’s signing action is not, investigate cached functions or another transport.

**C3 — inspect history and coverage in BOUND’s service-worker console:**

```js
await chrome.storage.local.get("boundWarningHistory");
await chrome.storage.session.get(["boundCoverage", "boundSiteStatuses"]);
chrome.runtime.getManifest();
```

**C4 — Playwright check for script execution, registered before navigation:**

```js
const cdp = await context.newCDPSession(page);
const scripts = [];
cdp.on("Debugger.scriptParsed", e => scripts.push(e.url));
await cdp.send("Debugger.enable");
await page.goto("https://app.ens.domains/");
console.log(scripts.filter(u =>
  /\/(hook|relay)\.js(?:$|\?)/.test(u)));
```

Check frame execution contexts too. Avoid enabling BOUND’s optional debugger-based network capture during this check; debugger attachment failures are separate from provider interception.

**C5 — confirm SDK/WalletConnect routes:**

In DevTools Sources, search loaded code for:

```text
skipAutoAnnounce
createEVMClient
wallet_createSession
wallet_invokeMethod
EthereumProvider.init
runtime.connect
```

Set breakpoints in the matching connector’s `connect` and `request` functions, then click the actual wallet option. Record the call stack and provider identity. SDK chunk names or WebSocket traffic are clues; the executing call stack establishes the route.

**C6 — isolate the read-rate regression, after selecting a provider:**

```js
await Promise.allSettled(Array.from({ length: 9 }, () =>
  boundSelected.request({ method: "eth_chainId" })));
```

Under normal single-layer wrapping, the hook’s internal state reads use captured original methods. They amplify **wallet traffic**, but do **not independently consume worker quota**. A read typically becomes three wallet RPCs; an approved interactive request becomes five. Partial rewrapping changes that relationship.

## 3. Verify connector behavior without assuming every site uses the same stack

| Integration | Verified behavior | Consequence for BOUND |
|---|---|---|
| **wagmi injected** | Supports selected provider objects and nested `ethereum.providers`. Discovery is enabled by default in current `createConfig`. | Wrap the selected provider before connector/client construction. |
| **viem custom** | Binds the request function when creating its transport. | Later assignment cannot repair an already constructed transport. |
| **RainbowKit** | Current MetaMask wallet source chooses between wagmi’s MetaMask connector and WalletConnect according to its detection logic. | A MetaMask-labelled option does not establish injected-provider coverage. [Source](https://github.com/rainbow-me/rainbowkit/blob/main/packages/rainbowkit/src/wallets/walletConnectors/metaMaskWallet/metaMaskWallet.ts). |
| **ConnectKit** | Current defaults include targeted MetaMask injection, WalletConnect, Coinbase, and optional account/Safe connectors. | Coverage depends on the selected connector. [Source](https://github.com/family/connectkit/blob/main/packages/connectkit/src/defaultConnectors.ts). |
| **AppKit / Web3Modal** | Supports injected discovery and separately instantiated WalletConnect providers. Web3Modal became AppKit. | Test both installed-wallet and QR/remote paths. [Reown provider documentation](https://docs.reown.com/advanced/providers/ethereum). |
| **Legacy MetaMask SDK** | Has its own provider implementation and transport configuration. | Inspect the deployed SDK version and selected transport. [SDK provider source](https://github.com/MetaMask/metamask-sdk/blob/main/packages/sdk/src/provider/SDKProvider.ts). |
| **MetaMask Connect** | Replaces the legacy SDK; uses CAIP-25 sessions and supports direct-extension and remote transports. | `wallet_createSession` and scoped invocation may never traverse the hooked injected object. [Migration guide](https://docs.metamask.io/metamask-connect/evm/guides/migrate-from-sdk/), [Connect architecture](https://github.com/MetaMask/connect-monorepo). |

Direct webpage-to-extension communication additionally depends on the **wallet extension’s** `externally_connectable` configuration. Adding that property to BOUND would not intercept MetaMask’s channel. MetaMask’s provider source currently describes CAIP-348 extension-ID announcement as Flask-specific; do not assume stable MetaMask uses that route without observing it. [Chrome documentation](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable?hl=en), [MetaMask source](https://github.com/MetaMask/providers/blob/main/src/initializeInpageProvider.ts).

These sources describe current upstream behavior, **not verified package versions deployed by ENS, Uniswap, Aave, Compound, or OpenSea**.

### Current method classification

| Method | Decoder result | Result if intercepted |
|---|---|---|
| `wallet_sendCalls` | Batch decoding; malformed/opaque where applicable | Review path; **not read-only**. |
| `wallet_getCapabilities` | Unsupported | Review path; currently an unnecessary discovery interruption. |
| `wallet_getCallsStatus` | Unsupported | Review path; status polling needs explicit classification. |
| `eth_signTypedData_v4` | Typed-data decoding, potentially opaque/malformed | Review path. |
| `personal_sign` | Decoded, cap 65 | Review path. |
| `wallet_switchEthereumChain` | Unsupported | Review path. |
| `wallet_addEthereumChain` | Unsupported | Review path. |
| `wallet_createSession`, `wallet_invokeMethod` | Unsupported | Review path **only if they reach a wrapped provider**. |
| `eth_sendRawTransaction` | **Read-only allowlist** | Silently forwarded. This is a write/broadcast classification defect. |
| Explicit account/permission requests | Decoder read-only, overridden by worker | Baseline silent decision; concurrent source opens review. |

`decodeBatch` currently ignores important envelope semantics such as requested chain, version, atomicity and capabilities. Extend validation against [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792); do not infer complete batch understanding from decoded `calls[]`.

## 4. Replace mutation with canonical provider wrappers

### 4.1 Use a wrapper registry

Replace `mediate()` assignments with a per-document registry:

```text
original provider → one stable wrapper → stable mediated request function
                 → original bound methods kept only in closure
                 → aliases, discovery metadata, coverage and state revision
```

Implement this in `hook.js`, with a testable provider-wrapper module bundled by `build.mjs`.

Requirements:

- Return the same wrapper for the same original across globals, namespaces and announcements.
- Keep `request` function identity stable so subsequently cached/bound functions remain mediated.
- Preserve flags and properties, including `isMetaMask`, `chainId`, `selectedAddress` and `_metamask`.
- Bind forwarded methods/getters to their actual wallet object to support private fields.
- Preserve event subscription/removal semantics.
- Translate fluent methods returning the original provider back to the wrapper; otherwise `.on(...).request(...)` can leak the original.
- Normalize legacy `send`/`sendAsync` separately. Forward exactly once without nested JSON-RPC responses.

**Frozen providers require a facade:** use a Proxy over a separate, extensible target. A Proxy directly over a frozen provider cannot return a replacement for a non-configurable, non-writable `request` property without violating JavaScript invariants. [Proxy invariants](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/get#invariants).

A wrapper cannot preserve `wrapper === original`. Preserve equality **between BOUND-exposed aliases**, and test compatibility honestly.

### 4.2 Intercept global assignment early

At synchronous startup, inspect `window.ethereum`:

1. If absent/configurable, install a getter/setter returning the canonical wrapper.
2. Wrap any existing provider immediately.
3. Wrap subsequent assignments.
4. Repeat narrowly for supported wallet namespace properties and exposed provider arrays.
5. Record unsupported/non-configurable properties rather than reporting successful mediation.

An accessor intercepts assignment; it does **not** intercept another script replacing the property using `Object.defineProperty`. Keep that limitation explicit. Avoid globally replacing object-definition APIs as the default solution.

### 4.3 Replace announcements before ordinary discovery consumers receive them

Register an early capture listener on `window`:

1. Validate incoming announcement shape.
2. Obtain the canonical wrapper.
3. Stop the original event using `stopImmediatePropagation()`.
4. Synchronously dispatch a replacement containing the wrapper.
5. Track replacement events in a private `WeakSet` to prevent recursion.
6. Preserve wallet metadata and UUID; do not create duplicate wallet identities.
7. Install the listener **before** dispatching `eip6963:requestProvider`.

Create a new frozen detail object; do not mutate the wallet’s event. EIP-6963 supports re-announcement, but discovery stores can retain the first object. [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), [event propagation behavior](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopImmediatePropagation).

Earlier listeners or existing connector closures cannot be revoked. Re-announcing a wrapper does not repair those references.

### 4.4 Keep static `document_start` injection

Keep the small synchronous MAIN bootstrap statically declared before the isolated relay. Install discovery interception before any asynchronous initialization.

Do **not** replace this with worker-triggered injection as a timing fix. Chrome documents static declarations as preceding other injection mechanisms within a lifecycle stage. Dynamic `registerContentScripts({runAt:"document_start"})` is useful for configurable coverage, but does not guarantee priority over wallet extensions. [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

If adding repair injection:

- Add `"scripting"` permission.
- Use `executeScript({world:"MAIN", injectImmediately:true})` only as best-effort recovery.
- Mark the document as injected late and recommend reload.
- Do not put `injectImmediately` inside `registerContentScripts`; it belongs to `executeScript` and guarantees no rewind. [Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting).

Add and test `match_origin_as_fallback` for both worlds where required.

### 4.5 State residual bypasses explicitly

| Residual path | Detection/reporting |
|---|---|
| Original object/function captured earlier | Cannot reliably enumerate closures. Report late installation/unknown earlier exposure; verify with controlled counters. |
| Announcement delivered before listener | Request re-announcement; record late startup. Do not claim existing stores were replaced. |
| Global accessor overwritten | Recheck descriptors and aliases; report replacement and reduced coverage. |
| Private SDK/WalletConnect provider | Report “No mediated wallet request observed”; confirm transport through diagnostics before naming it. |
| Direct extension or encrypted remote transport | Requires a supported connector adapter, dApp cooperation or wallet-side integration. |
| Another frame without hook/relay | Show frame-specific absence and its cause where known. |
| MAIN-world tampering | Treat page diagnostics and wallet metadata as untrusted; authoritative approval remains extension-owned. |

Do not present absence of observed bypasses as proof of complete protection.

## 5. Finish visible connection mediation

Use [request-decision-ux.md:21](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/request-decision-ux.md:21) as the policy foundation.

The concurrent source has started this work at [sw.js:230](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:230). Finish and validate it:

| Request | Planned surface |
|---|---|
| `eth_requestAccounts`, `wallet_requestPermissions`, covered session creation | Always show an extension-owned BOUND confirmation, including high-score requests. |
| Passive account/chain/capability/status reads | No repeated confirmation; record diagnostic activity. |
| Missing evidence | Explain unavailable checks; allow Continue at the applicable tier. |
| Incident/corroborated drift | Firewall tier with explicit confirmation. |
| Integrity failure, navigation, restart, unreadable required state | Visible recovery explanation and resend; never a misleading Continue. |

For explicit connections, this intentionally extends the document’s high-score “no surface” rule to satisfy this request.

Remaining changes:

- Route by structured reason codes, not regex matching `"incident|drift"`.
- Apply “bypass possible” minimum warning severity.
- Distinguish uncorroborated drift from corroborated drift.
- Implement the full firewall tab; the current concurrent patch still uses a popup.
- Replace the 45/50-second lifetimes with the shared review lifecycle.
- Remove contradictory wording such as “No review needed at …” in [warning.js:140](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/warning.js:140).
- Reserve “User rejected” for an actual user decision.
- Remove low-score automatic cancellation while preserving byte/document integrity.
- Keep confidence labelled as heuristic points, not probability of safety.

## 6. Add diagnostic mode before expanding coverage

Add extension-owned diagnostics to `popup.*`, backed by bounded local/session storage.

| Record | Fields |
|---|---|
| **Document/frame** | Tab, frame and document IDs; top/frame origins; hook build hash; MAIN/relay startup timestamps; handshake state; injection lateness. |
| **Provider** | Local provider ID; observed aliases; UUID/rdns/name; flags; property descriptors; wrapper type; supported methods; discovery time; failure reason. |
| **Request** | Trace ID; provider ID; method/API; document; classification; requested chain; state-read timing; gate acknowledgement; assessment; UI opened; decision; forward count; outcome. |
| **Coverage** | `observed`, `wrapper_exposed`, `request_mediated`, `late_install`, `unwrappable_alias`, `transport_unknown`, `bridge_failed`. |

Use an acknowledged lifecycle:

```text
observed → prepared → relay received → worker accepted
         → assessment ready → UI opened → user decision
         → revalidated → forwarded once → resolved/rejected
```

Expose a sanitized `window.__BOUND_DEBUG__.snapshot()` only when enabled. Do not expose original providers, authorization tokens, signatures, raw messages or calldata through that interface.

For aliases sharing one wrapper, report **provider identity and observed exposure sources**. Do not claim to know whether a cached caller originally obtained it through `window.ethereum` or EIP-6963.

The existing debugger/network collector captures frontend resources; it is not a wallet RPC interceptor. See [network-capture.mjs:10](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/network-capture.mjs:10).

## 7. Implementation sequence and acceptance gates

| Step | Files | Acceptance gate |
|---|---|---|
| **P0 — identify loaded build** | `build.mjs`, `popup.*`, manifest version/build metadata | Source, `dist`, worker and per-frame hook hashes are identifiable. |
| **P1 — observability** | `hook.js`, `relay.js`, `sw.js`, `popup.*`; new diagnostic module | One real click produces a complete trace or a specific missing-stage diagnosis. |
| **P2 — wrapper registry** | `hook.js`; new wrapper module; `build.mjs` | Frozen and mutable providers both mediate calls obtained through exposed wrappers. |
| **P3 — early discovery** | `hook.js`, `manifest.json` | Assignment, announcement, namespaces and supported frame types covered; races reported. |
| **P4 — visible decisions** | `sw.js`, `connection-score.mjs`, `warning.*`, new lifecycle/decision/firewall modules | Intact requests at 75, 35, 15 and 0 can reach the wallet after required confirmation. |
| **P5 — classification/traffic** | `packages/decoder/index.mjs`, hook state handling, worker limiter | Capability/status polling does not open reviews or exhaust interactive quota; broadcasts are not read-only. |
| **P6 — connector integrations** | New connector adapters/fixtures, documentation | SDK and WalletConnect coverage is demonstrated independently or labelled unsupported. |
| **P7 — real-site evidence** | New Playwright suite; extend existing verifier/docs | ENS/Uniswap injected flows pass; other sites have recorded connector-specific results. |

Coalesce state reads, use events for cached state, and revalidate before sensitive forwarding. Keep separate limits for pending interactive reviews and transport abuse. Preserve visible capacity/retry reasons.

### Unit and VM tests

Create a read-only-loaded `hook.test.mjs` harness with fake window events, timers and relay decisions:

- MetaMask-like Proxy with bound methods and private-field getters.
- Frozen provider and non-writable optional methods.
- Repeated announcements: stable wrapper and stable `request`.
- Announcement before hook, followed by request/re-announcement.
- Capture listener installed before/after a discovery consumer.
- Mipd-style first-UUID retention.
- Viem/wagmi-style cached request before versus after wrapper exposure.
- Multiple aliases sharing one provider and aliases exposing distinct providers.
- Assignment, property redefinition and delayed injection.
- Fluent `.on()` chaining without original-provider leakage.
- Legacy synchronous/promise/callback contracts.
- Missing/delayed relay, invalid state, state changes and worker restart.
- Burst passive reads, interactive capacity, exactly-once forwarding.
- EIP-5792 envelope/capabilities, signatures, chain methods and raw broadcasts.

The pre-hook cached-original test should remain an **expected coverage limitation**, not be concealed by a passing wrapper test.

## 8. Playwright validation plan

### 8.1 Real sites with a simulated injected wallet

Use Playwright’s bundled Chromium with a persistent context. Chrome/Edge have removed the usual extension sideload flags; Playwright documents bundled Chromium for this workflow. [Playwright extension guide](https://playwright.dev/docs/chrome-extensions).

```js
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${boundDist},${mockWalletDir}`,
    `--load-extension=${boundDist},${mockWalletDir}`
  ]
});
```

Use a small mock-wallet extension for realistic independent injection. Also use `context.addInitScript()` for deliberately controlled race scenarios; measure its ordering rather than assuming it precedes BOUND.

The mock should:

- Expose a MetaMask-like EIP-1193 provider and EIP-6963 announcement.
- Support chain/accounts, permissions, provider state, capabilities and events.
- Return `[]` before permission and a fixture account after connection.
- Record raw calls independently of BOUND.
- Support mutable, frozen, delayed and namespace-only variants.
- Never send a real transaction.

Start with `app.ens.domains` and `app.uniswap.org`:

1. Open a fresh page and verify both BOUND worlds started.
2. Open the site’s actual wallet modal.
3. Select the installed/injected mock wallet.
4. Assert BOUND review appears before the raw connection request.
5. Cancel: raw connection count remains zero.
6. Retry and Continue: exactly one raw connection reaches the mock.
7. Trigger a site-originated signature/transaction preparation.
8. Assert review precedes the mock’s sensitive method.
9. Repeat frozen-provider, multiple-wallet and startup-order variants.
10. Test SDK and WalletConnect choices separately; expect explicit limited coverage until integrated.

Production UI may require balances or state before preparing transactions. Use narrowly scoped RPC fixtures, or a controlled dApp using the same connector version. A console-issued transaction is useful for hook testing but does **not** prove the production dApp’s connector works.

| Site | Initial target |
|---|---|
| [ENS](https://app.ens.domains/) | Installed-wallet connection; subsequent signing/preparation. |
| [Uniswap](https://app.uniswap.org/) | Installed wallet versus SDK/QR route; approval/signature/batch preparation. |
| [Aave](https://app.aave.com/) | Selected connector, account/network probes, transaction preparation. |
| [Compound](https://app.compound.finance/) | Record redirects and final origin before testing. Live fetch redirected to `app.compound.xyz/redirect`, which matters for exact-host policy. |
| [OpenSea](https://opensea.io/) | Wallet route and authentication signature first; order signing separately. |

### 8.2 Real MetaMask extension

Use the same persistent-context pattern with **BOUND and a pinned unpacked MetaMask release**:

1. Use a disposable profile and dedicated test wallet.
2. Identify extensions by manifest/name, not assumed IDs.
3. Automate that pinned release’s onboarding: import test recovery phrase, set password, complete onboarding.
4. Disable trace/video capture while entering secrets.
5. Enable/select Sepolia and verify `eth_chainId === "0xaa36a7"`.
6. Reset site permissions and dApp sessions between fresh-connection tests.
7. Exercise Continue, Cancel, signatures, account changes, network changes, reload and reconnect.
8. Check BOUND review occurs before MetaMask confirmation.
9. Verify no transaction submission occurs after BOUND Cancel.
10. Add Phantom and Binance separately, then all three, recording selected-provider identity.

Use production domains for connection checks. Perform funded transaction tests on a controlled Sepolia dApp, or on a production site only when that site actually supports the test network. Do not assume ENS/Uniswap production interfaces expose Sepolia.

**Release gate:** demonstrate visible mediation through the actual selected connector, exactly-once forwarding, and accurate coverage reporting for SDK, remote-wallet and retained-original paths.
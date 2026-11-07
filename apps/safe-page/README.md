# BOUND safe page

This standalone recovery page displays bounded extension evidence and independently reads public watcher records. It does not approve wallet requests. Extension cancellation, ticket validation, navigation and private confirmation are separate work; do not enable redirects until those paths and browser security gates pass.

Run `node apps/safe-page/build.mjs` to produce `dist/index.html`, `dist/app.js`, `dist/style.css` and `packaged/safe.html`, `packaged/safe.js`, `packaged/safe.css`. The import-safe `buildSafePage({outdir, packagedDir, rpcUrl, arkivChainId, watchers})` exports artifact paths and defaults to the public Rabdi RPC, chain and watcher. Build inputs are public and embedded in the output; never pass credentials. The RPC must be HTTPS or loopback HTTP, without userinfo, query or fragment. The fragment cannot select an endpoint and its watcher must match the compiled allowlist. The extension build must copy all three packaged artifacts together.

`parseSafeFragment(hash)` returns validated evidence or null; `encodeSafeFragment(evidence)` returns a fragment, truncating display arrays as necessary. `querySafeCommunity({rpcUrl,watcher,chainId,site,fetchImpl,now})` returns a bounded live result or an unavailable result. The page clears its fragment, sends READY and CONFIRM via same-origin postMessage remotely or extension runtime when packaged, and navigates to `about:blank` on Leave. Neither message constitutes ticket authorization.

Run `node --experimental-strip-types --test apps/safe-page/*.test.mjs` for focused tests. A real gateway's CSP, CORS, availability and packaged extension behavior require browser integration verification. Publishing is separate and must use only the remote `dist` artifacts.

## Publish through the public gateway (no local Bee node)

From the repository root:

```sh
node apps/safe-page/build.mjs
npm run swarm:safe:check
npm run swarm:safe:publish
```

The check is a dry run with zero network requests. The explicit publish command uploads only the three built public files as a multipart `/bzz` website collection to `https://api.gateway.ethswarm.org`. The gateway supplies postage. No Bee process, wallet, batch ID, API version, funding, ENS write or Arkiv write is required by this path. Set `BOUND_SWARM_GATEWAY_URL` in the shell to select another compatible HTTPS gateway. Gateway availability, upload policy and retention are controlled by its operator; a successful upload gives no fixed retention guarantee.

After upload the publisher downloads `index.html`, `app.js`, `style.css` and the collection root, rejects incorrect MIME types, gateway shells, modified bytes and oversized bodies, and only then prints the release URL. If verification fails the command exits nonzero; an already accepted upload may still exist remotely. It never prints an unverified URL as a successful release.

Paste the printed URL, including its trailing slash, into the extension Options **Safe page URL** field, save, and test an eligible frontend mismatch. The existing ticket, cancel-before-navigation, readiness timeout and packaged fallback rules apply unchanged. Publication alone does not configure the extension or prove remote CSP/CORS compatibility; that requires a browser check of the actual release.

For the existing owner-node workflow, pass `--bee --publish` and explicitly configure `BOUND_BEE_API_URL`, `BOUND_POSTAGE_BATCH_ID`, `BOUND_BEE_API_VERSION`, and `BOUND_SWARM_GATEWAY_URL`. Gateway mode ignores these node-specific environment variables, so an old local Bee configuration cannot accidentally select or spend from that node.

This command publishes the safe website. The existing gateway raw-JSON uploader remains reusable for evidence blobs; automatic signed domain-feed discovery and the extension's shared L2 domain cache are specified separately in `Docs/swarm-domain-cache-plan.md` and are not provided by this website publisher.

If the API gateway redirects a new release to `https://bzz.link/forbidden?hash=<reference>`, upload has succeeded but serving requires approval by that gateway. Open that page and use its approval request form, or select a compatible serving gateway. The publisher fails verification and preserves the reference rather than treating the restriction page as your website. After approval, verify the existing release without uploading again:

```sh
npm run swarm:safe:publish -- --verify <reference>
```

Verification compares against the current `dist` files, which must still match the uploaded build. A connection error now includes the HTTP method, endpoint/path and underlying Node error code.

## Test the live gateway with the extension

New profiles default to the released `bzz.limo/bzz/.../` URL. Existing saved settings are preserved: open the extension's Options and set **Safe page URL** to the desired gateway URL. An empty value selects the packaged page. The remote path is bound to each ticket; if the gateway fails or its page does not report readiness, the extension falls back to the packaged page.

The browser fixture can exercise the live gateway without a wallet, Bee node or live Arkiv writes. Build first, then run with an installed Playwright package:

```sh
node apps/extension/build.mjs
BOUND_E2E_SAFE_PAGE_URL='https://bzz.limo/bzz/fa43f135f708b18f7f97008971e977f8ac74385f9f7237fb58bdc20ad2ba14ef/' \
  node --experimental-strip-types apps/extension/e2e/frontend-mismatch-check.mjs /absolute/path/to/node_modules/playwright
```

Set `BOUND_CHROME_EXECUTABLE_PATH` to a Chromium executable if the installed Playwright browser is unavailable. The test creates disposable browser profiles, collects real fixture script reports, advances a test-only watcher clock, and supplies fixture Arkiv records and a fake wallet. It checks remote navigation only after cancellation, fragment removal, private confirmation, and one typed retry. It does not test live Arkiv publication, real wallet behavior, or real corroboration.

For a real local watcher, use the encrypted-report setup in `services/watcher/README.md`, declare only verified safe demo scopes, and start the watcher with an Arkiv writer. The live detector needs three independent reporter profiles, at least one hour of maturity, successful Arkiv publication and fresh corroboration (drift, incident, or counterparty risk) before automatic navigation. A changed script alone produces a warning. The demo seed simulates three reporters and must not be treated as independent evidence.

Automatic navigation also requires a numeric BOUND score below the configured transaction red threshold (`BOUND_TX_RED_THRESHOLD`, default 16). An unknown score or a score at or above that threshold does not trigger a redirect. The browser fixture uses a simulated risky approval to exercise the low-score path.

For a visible, step-by-step presentation of that fixture, add `BOUND_E2E_DEMO=1` to the command above. Press Enter at each terminal prompt. It shows app A, switches the same URL to app B, shows that an ordinary connection warning does not automatically redirect, and then submits a simulated risky approval that triggers the fallback. The wallet, watcher records and clock are simulated; it does not write to live Arkiv or send a wallet transaction. The expected risky approval score is 15 under default settings (the threshold is below 16, not below 15). The gateway may fall back to the packaged recovery page if it cannot be reached.

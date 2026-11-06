# Local same-origin cutover fixture

Copy .env.example to .env, set BOUND_DEMO_TOKEN and BOUND_DEMO_SPENDER to contracts on the local test chain, then run:

    node --env-file=.env demo/hijack-server/run.mjs

Open the printed local origin. Type hijack in the terminal to serve the second backend through the same visible origin, then type normal to restore it. Type quit to stop the servers. BOUND_DEMO_PORT selects the front-proxy port; port 0 is useful for tests.

The normal and attack pages run on separate local HTTP servers behind a loopback-only proxy. The attack page requests an unlimited test-token approval only after a button click and only when the wallet is connected to chain 31337. Mode changes happen through stdin, so pages cannot switch the fixture. The tests check that the visible origin stays the same while the backend changes, and then returns to the normal page.

For the selective-content fixture, set `BOUND_DEMO_SCANNER_CLEAN=1` before starting. In hijack mode a request whose user agent contains `HeadlessChrome` gets the clean page, while a normal browser gets the attack page at the same origin. This deliberately simple, spoofable classifier demonstrates why inspecting the browser's actual request matters; it is not a general scanner detector. The default is disabled.

This is a local HTTP harness only. It does not change public DNS, establish HTTPS, exercise certificate changes or ASN corroboration, or pass the controlled-domain watcher gate. Replace the temporary page with Developer 1's test dApp when it is available.

On 2026-11-06, a browser diagnostic manually installed a fake provider in the local attack page. On chain `0x7a69`, clicking the button produced chain/account checks followed by an `eth_sendTransaction` request containing the synthetic approval calldata. With the fake provider reporting `0x1`, the page stopped after the chain check. The fake provider and manual injection make this a local diagnostic only: it does not prove wallet mediation, an extension warning, a real wallet transaction, HTTPS, or the Phase 2 gate.

Both pages load the cacheable same-origin `/app.js`. Its bytes differ between normal and hijack modes; the HTML itself is not cached. In normal mode, click **Connect wallet** to request accounts interactively. In scanner-clean mode both the HTML and `/app.js` are clean for the scanner user agent.

To prepare a baseline, start the normal backend and a local watcher, then run (adjust ports and chain as needed):

    node demo/hijack-server/seed-frontend.mjs --watcher http://127.0.0.1:8787/v1/observations --site 127.0.0.1:8081 --chain 31337 --asset http://127.0.0.1:8081/app.js

The seed uses three labelled demo reporter keys, not independent users. This CLI is ready ahead of Batch B: the current watcher intake does not yet accept `kind:'frontend'`. Promotion requires the Batch B watcher frontend aggregator and at least one hour of maturity, followed by publication. Posting seed reports alone does not prove extension-generated reporting or promotion.

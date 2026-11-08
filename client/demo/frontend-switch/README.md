# Interactive BOUND presentation sites

These are two **simulated** sites with hard-coded scores. They are presentation controls, not live BOUND scores, Arkiv records, verified frontend baselines, or proof that BOUND detected an incident. The scores are not displayed on the site pages.

Run both sites in separate terminals:

```sh
node client/demo/frontend-switch/server.mjs a
```

```sh
node client/demo/frontend-switch/server.mjs b
```

Open A at http://127.0.0.1:8081 and B at http://127.0.0.1:8082. App A uses a fixed 85/100 and clicking Connect wallet sends `eth_requestAccounts` to an installed wallet. Complete any BOUND review and approve the connection in that wallet. No transaction is sent; success depends on the actual wallet and BOUND extension.

App B uses a fixed 10/100. Clicking Connect & claim checks that value against 16 and navigates directly to the published Swarm safe page without requesting a wallet connection. This redirect is implemented by the demo site, not the BOUND extension. The Swarm page labels the fixed score as simulated and shows the originating site and time. It has no extension ticket or request evidence in this flow, marks unmeasured checks unavailable, and cannot authorize a retry.

To show A then B under one ngrok address, run `ngrok http 8081` in another terminal. Open the HTTPS address it prints. Stop A with Ctrl+C and start B on the same port:

```sh
PORT=8081 node client/demo/frontend-switch/server.mjs b
```

Keep ngrok running and reload the same HTTPS address. Both HTML and scripts are served with `Cache-Control: no-store`. Stop B and rerun A to switch back. If needed, verify which version is served before presenting.

The scripts changed with this demo. Any earlier stored hash for app A no longer matches. To calculate its current SHA-256 in BOUND's format:

```sh
node -e "const fs=require('fs'),crypto=require('crypto'); console.log('sha256-'+crypto.createHash('sha256').update(fs.readFileSync('client/demo/frontend-switch/a/app.js')).digest('base64'))"
```

For an actual extension-triggered fallback, a hard-coded site score is not used: BOUND needs a watcher-published frontend baseline, a fresh mismatch, corroboration and an actual low score. See `client/safe-page/README.md`. ENS text records alone do not create the watcher baseline.

# Same-URL frontend switch demo

Run `node demo/frontend-switch/server.mjs a`, and in another terminal start `ngrok http 8081`. Visit the HTTPS URL printed by ngrok. Stop A with Ctrl+C, then run `node demo/frontend-switch/server.mjs b`; keep the ngrok process running. Reload the same URL. Return to A by stopping B and running the first command again.

Both pages load `/app.js`, but A and B have different bytes. They only ask to connect a wallet; neither sends a transaction. The B label is revealed after connection for demo clarity. Scripts are cached for up to 60 seconds. Wait for that period and reload after switching, or use a fresh browser profile to avoid stale content; verify what is actually served before interpreting a result.

Compute A's exact SHA-256 in the format used by BOUND:

```sh
node -e "const fs=require('fs'),crypto=require('crypto'); console.log('sha256-'+crypto.createHash('sha256').update(fs.readFileSync('demo/frontend-switch/a/app.js')).digest('base64'))"
```

The extension's frontend evidence uses watcher-published Arkiv records. Adding the hash to ENS as a text record does not currently create that baseline or cause the extension to read it. The existing `demo/hijack-server/seed-frontend.mjs` only accepts loopback origins, so it cannot seed an ngrok hostname. Frontend promotion needs safe scope, three reporter keys and one hour, plus Arkiv publication; see `services/watcher/README.md`. A frontend conflict alone does not guarantee a safe-page redirect; other policy and corroboration conditions apply. Do not represent this two-site fixture as a verified end-to-end detection until the actual ngrok-host baseline and warning have been tested.

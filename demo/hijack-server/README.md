# Local same-origin cutover fixture

Copy .env.example to .env, set BOUND_DEMO_TOKEN and BOUND_DEMO_SPENDER to contracts on the local test chain, then run:

    node --env-file=.env demo/hijack-server/run.mjs

Open the printed local origin. Type hijack in the terminal to serve the second backend through the same visible origin, then type normal to restore it. Type quit to stop the servers. BOUND_DEMO_PORT selects the front-proxy port; port 0 is useful for tests.

The normal and attack pages run on separate local HTTP servers behind a loopback-only proxy. The attack page requests an unlimited test-token approval only after a button click and only when the wallet is connected to chain 31337. Mode changes happen through stdin, so pages cannot switch the fixture. The tests check that the visible origin stays the same while the backend changes, and then returns to the normal page.

This is a local HTTP harness only. It does not change public DNS, establish HTTPS, exercise certificate changes or ASN corroboration, or pass the controlled-domain watcher gate. Replace the temporary page with Developer 1's test dApp when it is available.

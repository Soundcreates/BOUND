# Integration evidence

`npm test` runs `local.test.js`, which covers watcher intake, local durable retry, fake observation storage, hourly baseline generation and refresh, and owner-checked bundle filtering. The in-memory client is deliberately a fake; the tests do not exercise a real wallet, browser extension, ENSv2, Swarm, Arkiv write, or Anon-RPC worker.

The live scenario in `Docs/plan.md` still requires a provisioned Rabdi writer, real adapters from the trust and browser lanes, a controlled domain, and a second HTTPS server. Record public transaction/entity identifiers, block and expiry evidence, commands, and limitations when those runs actually occur. Do not place secrets, user wallet details, request digests, or override choices in evidence.

`arkiv-stack.test.js` composes the actual local codec, submission journal, restricted transport, receipt checker, operation lookup and writer with a fake signer and fake JSON-RPC. It verifies composition and retry logic only; no transaction or signature is real.

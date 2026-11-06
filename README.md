# BOUND

BOUND is a work-in-progress browser-side warning system for mediated wallet requests. It compares request details with a curator-controlled, chain-specific snapshot and displays decisions in extension-controlled UI. Provider interception has bypass limitations. A trusted contract can still be unsafe. No audit, universal coverage, live end-to-end integration, or measured detection accuracy is claimed.

## Local checks

Use Node.js 22 or newer and install the locked dependencies before running the local suite:

```sh
npm ci
npm test
```

This runs contract, watcher, Arkiv boundary, local hijack-server and fake integration tests. Fakes are not evidence that an external integration works. Copy `.env.example` to `.env` only if you need local configuration; `.env` is ignored. Never put a funded or real-user wallet key into the repository. See [the local demo](demo/hijack-server/README.md) and [Dev3 feasibility evidence](packages/contracts/feasibility.md).

## Status

Dev3's local watcher, HTTP intake, durable retry, Arkiv read/write path, drift/incident composition, and cutover harness are implemented. The Rabdi Arkiv create, patch, owner-query, and expiry gate passed with synthetic test records; controlled-domain DNS/TLS and Developer 1/2 browser, ENSv2, Swarm, and Anon-RPC gates remain open. See [Arkiv integration status](integrations/arkiv/README.md) and [the implementation plan](Docs/plan.md).

BOUND was built from scratch during ETHGlobal Mumbai, according to the team. The team used Claude and OpenAI Codex as AI coding assistants for development, debugging, and documentation; generated changes require human review and tests. There has been no independent security audit.

The GitHub Actions workflow is configured for local tests and Gitleaks but has not yet run on a hosted runner. Gitleaks Action requires a license for organization-owned repositories; no license or other secret has been provisioned here. Real-wallet and testnet runs are not part of the local suite. Browser end-to-end suites and the required metric reports remain to be integrated.

## Arkiv submission evidence

The testnet writer used for recorded entities is `0xe63393558e36df643347326e7e03ad5fb0e6c867` on Rabdi (chain 7794095). To query its unexpired BOUND records, run from the repository root after `npm ci`:

```sh
node --input-type=module <<'JS'
import {createArkivRpcReader} from './integrations/arkiv/rpc.js';
const reader = createArkivRpcReader({url:'https://rpc.rabdi.db-chain.testnet.arkiv.network',schemaTag:'bound.record.v1'});
const records = await reader.query({owner:'0xe63393558e36df643347326e7e03ad5fb0e6c867'});
console.log(records);
JS
```

Results change as entities expire. A read on 2026-11-07 returned 10 records; this does not demonstrate the extension's user-facing live read. See [schema](arkiv/schema.md), [feedback](arkiv/friction.md), [reach](arkiv/reach.md), [why Arkiv](arkiv/why-arkiv.md), [how we use Arkiv](arkiv/how-you-use-arkiv.md), and [Swarm evidence and remaining gaps](arkiv/swarm.md).

## License

BOUND is licensed under the [MIT License](LICENSE). Third-party components may have their own licenses.

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

BOUND uses AI-assisted development; generated changes require human review and tests. There has been no independent security audit.

The GitHub Actions workflow is configured for local tests and Gitleaks but has not yet run on a hosted runner. Gitleaks Action requires a license for organization-owned repositories; no license or other secret has been provisioned here. Real-wallet and testnet runs are not part of the local suite. Browser end-to-end suites and the required metric reports remain to be integrated.

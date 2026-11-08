# Arkiv integration status

## ETHGlobal Mumbai submission

BOUND is targeting **Build on Arkiv (from scratch)** as its main Arkiv track, with the **Arkiv + Swarm bonus** as a separate submission. The team reports that BOUND was built during ETHGlobal Mumbai. The main track requires a live testnet write and a user-visible feature that reads Arkiv data; the latter still needs an end-to-end demonstration before qualification can be claimed.

Judging evidence:

- [Arkiv feedback](friction.md): integration friction and reproduction details.
- [Reach](reach.md): intended users, availability and current limitations.
- [Why Arkiv](why-arkiv.md): what public, owned, expiring records add and what stays off Arkiv.
- [How BOUND uses Arkiv](how-you-use-arkiv.md): the read/write flow and user-visible behavior.
- [Schema](schema.md): entity types, query fields, ownership and expiry.
- [Arkiv + Swarm bonus](swarm.md): integration evidence, reproduction and remaining gaps.

The repository's [main README](../README.md) includes the writer address, a runnable query and the team's AI disclosure. The project is [MIT licensed](../LICENSE).

**Status: initial live write/read/expiry demonstrated; full integration remains open.** The selected public test environment is Rabdi, chain ID 7794095. A synthetic baseline create and patch, an observation write, an owner-filtered query, and observation expiry were recorded on 2026-11-06. The public test writer was `0xe63393558e36df643347326e7e03ad5fb0e6c867`. See [read boundary](../shared/integrations/arkiv/README.md) and [transaction evidence](../shared/contracts/feasibility.md). Renewal, rollover, and full watcher-to-extension integration still require live verification.

Keep the writer distinct from curator and user wallets. Never record private keys or access credentials.

A read-only owner-wide query can be invoked with the following local script. It checks chain ID, filters and rechecks owner, and returns records; expired test entities will no longer appear:

```sh
node --input-type=module <<'JS'
import {createArkivRpcReader} from './shared/integrations/arkiv/rpc.js';
const reader = createArkivRpcReader({url:'https://rpc.rabdi.db-chain.testnet.arkiv.network',schemaTag:'bound.record.v1'});
const records = await reader.query({owner:'0xe63393558e36df643347326e7e03ad5fb0e6c867'});
console.log('records:', records.length);
JS
```

`bound.record.v1` remains a proposed schema tag pending shared acceptance.

# Arkiv integration status

**Status: initial live write/read/expiry demonstrated; full integration remains open.** The selected public test environment is Rabdi, chain ID 7794095. A synthetic baseline create and patch, an observation write, an owner-filtered query, and observation expiry were recorded on 2026-11-06. The public test writer was `0xe63393558e36df643347326e7e03ad5fb0e6c867`. See [read boundary](../integrations/arkiv/README.md) and [transaction evidence](../packages/contracts/feasibility.md). Renewal, rollover, and full watcher-to-extension integration still require live verification.

Keep the writer distinct from curator and user wallets. Never record private keys or access credentials.

A read-only owner-wide query can be invoked with the following local script. It checks chain ID, filters and rechecks owner, and returns records; expired test entities will no longer appear:

```sh
node --input-type=module <<'JS'
import {createArkivRpcReader} from './integrations/arkiv/rpc.js';
const reader = createArkivRpcReader({url:'https://rpc.rabdi.db-chain.testnet.arkiv.network',schemaTag:'bound.record.v1'});
const records = await reader.query({owner:'0xe63393558e36df643347326e7e03ad5fb0e6c867'});
console.log('records:', records.length);
JS
```

`bound.record.v1` remains a proposed schema tag pending shared acceptance.

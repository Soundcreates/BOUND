# Arkiv integration status

**Status: local implementation complete; live writer gate open.** The selected public test environment is Rabdi, chain ID 7794095. Public read and chain checks succeeded. The supplied public test-wallet address and Arkiv access key are configured in the ignored local `.env`; its latest public Rabdi balance read was nonzero (10 tGLM). No signing credential has been set, and no project-owned entity write, transaction, entity key, or expiry demonstration has been established. See [read boundary](../integrations/arkiv/README.md) and [feasibility evidence](../packages/contracts/feasibility.md).

The public writer address is configured and its balance was checked, but address ownership has not been proven by a signed write. Keep it distinct from curator and user wallets. After a successful live run, document its public address and a public query. Never record private keys or access credentials.

A read-only owner-wide query can be invoked after replacing the public address and agreed schema tag in the following local script. It checks chain ID, filters and rechecks owner, and returns records; it does not perform a write or prove expiry:

```sh
node --input-type=module <<'JS'
import {createArkivRpcReader} from './integrations/arkiv/rpc.js';
const reader = createArkivRpcReader({url:'https://rpc.rabdi.db-chain.testnet.arkiv.network',schemaTag:'bound.record.v1'});
const records = await reader.query({owner:'0x0000000000000000000000000000000000000000'});
console.log('records:', records.length);
JS
```

The zero address is a public read-only probe, not a writer. `bound.record.v1` is a proposed schema tag pending shared acceptance.

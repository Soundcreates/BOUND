# Integration documentation and verification

Documentation reviewed on 2026-11-09. These links describe the upstream interfaces;
passing local tests does not by itself prove that a deployed service is reachable or
that a transaction will succeed.

## Arkiv

- [Rabdi network reference](https://docs.arkiv.network/networks/rabdi/) identifies
  the current public testnet and its chain ID. Its public RPC is rate limited.
- [JSON-RPC read methods](https://docs.arkiv.network/json-rpc/querying-data/)
  define query options and entity responses.
- [Write transactions](https://docs.arkiv.network/json-rpc/mutating-entities/)
  define the `execute` operations, attribute encoding and expiry limits.

BOUND's custom adapter is in `shared/integrations/arkiv/`; the extension also
has an Arkiv reader in `client/extension/arkiv-reader.mjs`. An entity's owner,
chain and expiry remain part of the application's trust checks. Verify writes
and reads on the configured network before relying on a deployment.

## Swarm

- [Bee API reference](https://docs.ethswarm.org/api/) specifies endpoints,
  postage headers and response formats.
- [Upload and download guide](https://docs.ethswarm.org/docs/develop/upload-and-download/)
  explains the `/bytes` and `/bzz` endpoints.

Adapters are in `shared/integrations/swarm/`; the safe-page publisher is in
`scripts/swarm/`. A gateway paying postage on the uploader's behalf is a
service-specific feature, not a guarantee of the Bee API. Successful local
upload does not by itself establish availability through an independent gateway.

## ENS

- [Deployments](https://docs.ens.domains/learn/deployments/) lists ENS contract
  addresses and ABI references.
- [Universal Resolver V2](https://docs.ens.domains/ensv2/universal-resolver-v2/)
  describes name resolution, including the resolver returned with a result.
- [Permissioned Resolver](https://docs.ens.domains/contracts/ensv2/permissioned-resolver/)
  describes record-setting permissions.

The integration is in `shared/integrations/ens/`, with extension reads in
`client/extension/ens-registry.mjs` and registry scripts in `scripts/ens/`.
Resolver pins and publisher permissions are deployment-specific and must be
verified before publishing. Permissioned Resolver roles are scoped to record
keys, so sharing a resolver across names has consequences for who can update
those records.

## Anon-RPC

- [Anon-RPC specification](https://ethereum.github.io/anon-rpc/spec/) is a
  draft; the reviewed version is 0.4.0, dated 2026-10-23.
- [Wallet and app integration guide](https://ethereum.github.io/anon-rpc/wallets/)
  describes the upstream harness and worker bootstrap.

The integration is in `shared/integrations/anon-rpc/` and the extension has
its own host and engine in `client/extension/`. A pinned worker hash checks
code integrity; it does not independently prove anonymity. Browser startup,
worker availability and actual network behavior require end-to-end testing.

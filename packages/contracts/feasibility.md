# Developer 3 Phase 0 feasibility evidence

Checked 2026-11-06. Official [Rabdi network documentation](https://docs.arkiv.network/networks/rabdi/) identifies public testnet chain 7794095 (`0x76edaf`), two-second nominal blocks and test tGLM. Its public RPC is rate limited; an access key is optional for public reads. [Arkiv fundamentals](https://docs.arkiv.network/start-here/fundamentals/) says the owner controls entity mutation and expiring entities leave queries. These are documented semantics, not proof of the project's write path. Every watcher-owned query must filter the owner and re-check returned owner. A schema tag can be forged.

The snapshot digest was independently checked with `packages/contracts/verify-digest.sh` against Rabdi `web3_sha3` on 2026-11-06; it returned `0xecff32d2765ca4838907876f39bf4947ede5f46000fee155968998921191df90`, matching the fixture. This checks Keccak for the fixture bytes, not general RFC 8785 implementation.

Read-only probes from this checkout, with no credentials:

```sh
curl -sS --max-time 12 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
curl -sS --max-time 12 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_getBlockTiming","params":[]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
curl -sS --max-time 15 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"arkiv_query","params":["arkiv.schema = str('\''bound.phase0.probe'\'')",{"select":{"key":true,"owner":true,"expiresAt":true},"limit":"0x1"}]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
```

The chain ID read returned `0x76edaf`; block timing returned block `264156` with a two-second duration; the query returned an empty `data` array at block `0x407dc`. This proves endpoint reachability, chain identity and read-query support, not ownership filtering or expiry. The user supplied a test-only writer public address and says the wallet is funded; the address is present in the ignored `.env`. Its balance and ownership have not been independently verified here, and no signing credential is configured. The required create/query/expiry/foreign-owner test remains open. Record writer address, transaction, entity key, expiry block and both successful and foreign-owner query results when run.

For ASN corroboration, select [Team Cymru IP-to-ASN mapping](https://www.team-cymru.com/ip-asn-mapping), using DNS TXT lookups for individual addresses. The live query for `1.1.1.1.origin.asn.cymru.com` returned origin ASN 13335 and prefix `1.1.1.0/24`. Team Cymru says the mapping uses BGP feeds from 50+ peers refreshed every four hours; this is corroboration context, not immediate DNS evidence. Missing, multi-origin, stale, or unavailable data must not count as corroboration. Recheck service terms and reachability during the controlled-domain run.

Controlled DNS/TLS polling and drift exercise remain blocked: no controlled test domain or DNS/TLS management environment was provided. A random public hostname is not a substitute. Record the domain, initial and changed DNS/TLS results, commands, timestamps, recovery and limitations once provisioned. These are required gates and must not be represented as passing. Developer 3 owns these probes; the shared wallet, ENS, Swarm and Anon-RPC gates remain with their assigned lanes. No integration has been dropped.

An additional read-only watcher smoke probe against `example.org` on 2026-11-06 used the DNS-over-HTTPS, TLS and Team Cymru collector code and returned counts of 2 NS, 2 A, 2 mapped ASNs and 2 certificate DNS names. The result is not a controlled drift test. Reproduce with the `pollSite`, `createNetworkPollAdapters`, and `createCymruLookup` exports; no project credential is needed. DNS/TLS network data and the hostname are disclosed to the respective upstream providers.

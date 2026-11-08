# Developer 3 Phase 0 feasibility evidence

Checked 2026-11-06. Official [Rabdi network documentation](https://docs.arkiv.network/networks/rabdi/) identifies public testnet chain 7794095 (`0x76edaf`), two-second nominal blocks and test tGLM. Its public RPC is rate limited; an access key is optional for public reads. [Arkiv fundamentals](https://docs.arkiv.network/start-here/fundamentals/) says the owner controls entity mutation and expiring entities leave queries. These are documented semantics, not proof of the project's write path. Every watcher-owned query must filter the owner and re-check returned owner. A schema tag can be forged.

The snapshot digest was independently checked with `shared/contracts/verify-digest.sh` against Rabdi `web3_sha3` on 2026-11-06; it returned `0xecff32d2765ca4838907876f39bf4947ede5f46000fee155968998921191df90`, matching the fixture. This checks Keccak for the fixture bytes, not general RFC 8785 implementation.

Read-only probes from this checkout, with no credentials:

```sh
curl -sS --max-time 12 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
curl -sS --max-time 12 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"arkiv_getBlockTiming","params":[]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
curl -sS --max-time 15 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":2,"method":"arkiv_query","params":["arkiv.schema = str('\''bound.phase0.probe'\'')",{"select":{"key":true,"owner":true,"expiresAt":true},"limit":"0x1"}]}' https://rpc.rabdi.db-chain.testnet.arkiv.network
```

The chain ID read returned `0x76edaf`; block timing returned block `264156` with a two-second duration; the query returned an empty `data` array at block `0x407dc`. This proved endpoint reachability and query support. A later test-only run used the locally configured Rabdi writer and the documented native system address. The private key remained in ignored `.env` and was never printed or committed.

**Live Arkiv write gate passed on 2026-11-06** with `npm run check:arkiv-live`. The test created a baseline (transaction `0xd1ec69bdd55f924122a04d0bfe21bcde290dd255616ed94cf92bad79f5891b45`, block `267430`), patched the same entity (transaction `0x666f42c79f7b051f8f0c4fe912ae84e60ef12342bad5d117fb4c379cf689ebd4`, block `267511`, entity `0x83b10d207b73ebac49f749e2bf40dfc611094fde18f4b259f5659a2557ac54b3`, owner `0xe63393558e36df643347326e7e03ad5fb0e6c867`, expiry block `274630`), and created a short-lived observation (transaction `0x063680226711a7d078bc43ff0d2f4a63589af5ac932e00154ef2932eadfeddb2`, block `267516`, entity `0x3b3cf810c1c58f96086f5fb6a379e55635cd88f9273c1615abd673764f89a0cd`, expiry block `267556`). The observation was visible through the configured owner query before expiry, then absent from both `arkiv_getEntity` and query results after expiry. Querying as a different owner did not return the watcher entity. The expiry test uses synthetic public records only. Receipt checks trust the configured RPC; this is not a state proof.

For ASN corroboration, select [Team Cymru IP-to-ASN mapping](https://www.team-cymru.com/ip-asn-mapping), using DNS TXT lookups for individual addresses. The live query for `1.1.1.1.origin.asn.cymru.com` returned origin ASN 13335 and prefix `1.1.1.0/24`. Team Cymru says the mapping uses BGP feeds from 50+ peers refreshed every four hours; this is corroboration context, not immediate DNS evidence. Missing, multi-origin, stale, or unavailable data must not count as corroboration. Recheck service terms and reachability during the controlled-domain run.

Controlled DNS/TLS polling and drift exercise remain blocked: no controlled test domain or DNS/TLS management environment was provided. A random public hostname is not a substitute. Record the domain, initial and changed DNS/TLS results, commands, timestamps, recovery and limitations once provisioned. These are required gates and must not be represented as passing. Developer 3 owns these probes; the shared wallet, ENS, Swarm and Anon-RPC gates remain with their assigned lanes. No integration has been dropped.

An additional read-only watcher smoke probe against `example.org` on 2026-11-06 used the DNS-over-HTTPS, TLS and Team Cymru collector code and returned counts of 2 NS, 2 A, 2 mapped ASNs and 2 certificate DNS names. The result is not a controlled drift test. Reproduce with the `pollSite`, `createNetworkPollAdapters`, and `createCymruLookup` exports; no project credential is needed. DNS/TLS network data and the hostname are disclosed to the respective upstream providers.

A later read-only balance check found the configured writer address has nonzero Rabdi test-token balance. The funded address was used only for the testnet transactions above. The collaborative preview profile exposed no EIP-1193 provider on a normal HTTPS page.

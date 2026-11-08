> Archived from the pre-merge development branch on 2026-11-09. This is historical project state; paths, deployment details, and completion claims may be stale.

# Phase 0 Chain Matrix — FROZEN

**Status:** frozen as of 2026-11-06  
**Network:** Sepolia (chainId 11155111) for all testnet entries  
**Branch:** phase-0 @ 3e80429

This document is the freeze record required by plan §Phase 0 shared exit gate:
> "Freeze the chain matrix for the ENS root, five real protocol seeds, fictional test dApp, Arkiv, and Anon-RPC."

---

## ENS Root

| Field | Value |
|---|---|
| Root name | `bound-demo.eth` |
| PermissionedResolver (post-audit-2) | `0xc405306d78707eda003bcef387a8277ab5dc36a9` |
| UniversalResolverV2 | `0x9A25D79AB755718e0b12BD3C927A010a543C2b31` |
| Root record key | `bound.root.v1` |
| Attestation record key | `bound.attestation.v1` |
| Read path | `UniversalResolverV2.resolve(dnsName, encodeFunctionData("text",[node,key]))` |
| Write path | `PermissionedResolver.setText(dnsName, key, value)` |
| Curator role | `ROLE_SET_TEXT` scoped to root key resource |

---

## Five Real Protocol Seeds (Sepolia, chainId 11155111)

| Protocol | Host | Attestation name | Contracts |
|---|---|---|---|
| Uniswap | `app.uniswap.org` | `uniswap.eth` | SwapRouter02 `0x3bfa...e48e`, Permit2 `0x0000...8ba3` |
| Aave | `app.aave.com` | `aave.eth` | Pool `0x6ae4...8951`, PoolAddressesProvider `0x012b...c9a` |
| Compound | `app.compound.finance` | `compound.eth` | Comet USDC `0xaec1...b6e` |
| ENS | `app.ens.domains` | `ens.eth` | Registry `0x0000...e1e`, ETHRegistrarController `0xfed6...b16`* |
| OpenSea | `opensea.io` | `opensea.eth` | Seaport 1.5 `0x0000...4dc` |

*ENS ETHRegistrarController returns empty-code hash (`0xc5d246...`) on Sepolia — address may be stale on this testnet. Verify before Phase 1.

**Shared contracts (all chains):** Permit2 `0x000000000022d473030f116ddee9f6b43ac78ba3`

**Seed digest (epoch 1):** `0x9cb75fcc201674943ee25a880b03b257a92b32949ac7bd0cb1687b8e52288d6b`  
**Seed bytes:** 3384  
**Source:** `fixtures/snapshots/demo-seed.compile-input.json`

---

## Fictional Test dApp

| Field | Value |
|---|---|
| Owner | Developer 1 |
| Status | Pending Developer 1 Phase 0 |

---

## Arkiv

| Field | Value |
|---|---|
| Owner | Developer 3 |
| Status | Pending Developer 3 Phase 0 validation |
| Note | Verify supported network, chain ID, writer/query/owner semantics during Phase 0 |

---

## Anon-RPC

| Field | Value |
|---|---|
| Transport | `WorkerTransport` (MV3 offscreen host) |
| Worker config | `shared/integrations/anon-rpc/src/known-workers.ts` |
| Required RPC methods (read-only allowlist) | `eth_call`, `eth_getCode`, `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`, `eth_getLogs`, `eth_getTransactionReceipt`, `net_version` |
| Value-moving pass-through | `eth_sendRawTransaction` (already-signed only) |
| Explicitly excluded | `eth_sign`, direct bootstrap/config reads |
| Status | Pending live probe (`probe-anon-rpc.ts`) + MV3 extension test |

---

## Watcher

| Field | Value |
|---|---|
| Identity | Rotating pseudonymous key (pre-Semaphore MVP) |
| K / window | To be frozen before Phase 1 (see plan §score parameters) |
| Owner | Developer 2 |
| Status | Pending Phase 1 |



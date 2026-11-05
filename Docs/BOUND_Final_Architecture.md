# BOUND — Origin-Aware Wallet Policy for Compromised Frontends

## Final Architecture, Security Protocol, Data Plane and Implementation Plan

**Version:** 2.0 (final architecture, supersedes the 1.0 proposal and the Witness design)
**Status:** Architecture and implementation plan with a working, tested prototype of the decoder and hook. Not an audited system, and no measured accuracy is claimed.
**Primary ecosystem:** EVM / Ethereum; Chromium desktop extension MVP
**Target event:** ETHGlobal Mumbai 2026
**Target tracks:** Arkiv — *Build on Arkiv (from scratch)* (+ Arkiv × Swarm bonus); ENS — *Best Use of ENSv2*; Ethereum Foundation — *Best Use of Anon-RPC* (one EF prize per project)
**Design motto:** *Know where your signature is going before you sign.*

> **How to read this document.** **[DOC]** is established by cited official documentation. **[DESIGN]** is a BOUND design decision. **[ASSUMPTION]** must be validated before it is relied on. **[MVP]** is intended hackathon scope. **[FUTURE]** is explicitly not promised. **[VERIFIED]** is implemented and covered by the prototype's test suite. Code is illustrative unless marked `[VERIFIED]`; check ABIs, SDK versions, deployed addresses and chain configuration before deployment.

---

## Abstract

BOUND is an origin-aware transaction policy layer between browser dApps and Ethereum wallets. The problem it addresses is not phishing to a fake domain: it is the case where an attacker controls the HTML and JavaScript served from a *legitimate* origin while the protocol's smart contracts remain sound. The URL, the padlock and the interface all look normal, and the wallet has no way to know the page is lying.

BOUND asks two questions about every value-moving request, in this order. **Is this site behaving differently than it normally does?** — from DNS, TLS, serving IP and the site's own history. **Is this exact wallet action authorized for this site?** — from a curated, cryptographically anchored list of the addresses that site is known to use. Behavioural confidence can only lower a verdict; it can never authorize an action that the policy does not.

The trusted address list is published as a single snapshot whose hash lives in an ENSv2 record under a role restricted to a curator, uploaded to Swarm, and verified by the extension before use — so control of a website's DNS, which is the very threat, cannot forge an entry. The live, changing record (observations, infrastructure drift, incidents, per-site summaries) lives on Arkiv with expiry. On-chain facts about counterparties are read through Anon-RPC so no provider learns wallet, dApp and counterparty together. Every decision is computed locally in the browser, in milliseconds, from data fetched in advance.

**Primary contribution:** a reproducible separation between *who may assert that an address belongs to a site* (the curator, anchored in ENS), *what a site has actually been observed doing* (the Arkiv record), and *what this specific request would authorize* (the decoder), with explicit, tested fail-closed behaviour at each boundary.

**Keywords:** browser wallet security, compromised frontend, EIP-1193, EIP-6963, Permit2, EIP-7702, ENSv2, Arkiv, Swarm, Anon-RPC, provenance, origin policy.

### Scope statement

BOUND can detect many site-to-unauthorized-address substitutions **for requests that actually pass through it**. It cannot prove that a call to an authorized contract is safe, cannot guarantee interception across every wallet or WalletConnect integration, cannot prevent a page from learning an address already revealed to it, and cannot revoke approvals granted before it was installed. A wallet-native integration is the only mechanism that would make interception authoritative, and that is future work. BOUND warns; it does not block.

---

## Table of contents

1. Executive summary
2. Threat model
3. Design principles and trust boundaries
4. Architecture and component responsibilities
5. Trust anchoring: snapshot, root, epoch
6. The live record on Arkiv
7. Browser interception and enforcement
8. The decoder
9. Policy engine and scoring
10. Watcher, drift and incidents
11. Contributions and anti-poisoning
12. Privacy
13. Failure behaviour
14. End-to-end flows
15. Security invariants and test framework
16. Limitations, cuts and roadmap
17. Partner tracks and submission evidence
18. Hackathon execution
19. Claims BOUND does not make
20. Competitive positioning
21. Glossary
22. Open decisions
23. Final architecture verdict

---

## 1. Executive summary

### 1.1 The problem in one paragraph

A DeFi interface can lie while its TLS certificate is valid and its contracts are audited. If the origin's registrar, DNS, CDN, deployment pipeline, third-party script or web server is compromised, the served JavaScript can ask the wallet to sign an unlimited ERC-20 approval, an EIP-712 permit, a Permit2 authorization, an EIP-7702 delegation, or an apparently ordinary router call that forwards value to an attacker. Wallet interfaces show *what* is requested; they do not show whether that request is something the site the user intended to use would normally ask for. Blocklists and reputation feeds are inherently reactive and arrive after the first victims.

**Motivating incident.** cow.fi was hijacked through its registrar on 14 April 2026. Approximately $1.2M was taken over roughly three hours, including 219 ETH from a single trader. The hijack began at 14:54 UTC; the team's first public warning came at 15:41. Every signal needed to warn the first victim existed at 14:54.

### 1.2 The two questions BOUND asks

This is the entire product, and it is the only framing that should be used in a pitch.

| Layer | Question | Evidence it uses | What it can do |
|---|---|---|---|
| **Behaviour** | Is this site behaving differently than usual? | Nameservers, TLS certificates, serving IP, outbound hosts, the site's observed history | Lower confidence; raise a pre-connection banner |
| **Authorization** | Is this exact wallet action authorized for this site? | The anchored trust snapshot, ENS attestations, shared-contract list, deployer lineage | Decide the verdict |

**[DESIGN] Authorization has the final say.** A high behavioural confidence score never authorizes an action the policy does not. Behaviour can only make a verdict worse. This single rule is what prevents an attacker from farming reputation into a pass.

### 1.3 Defensible differentiation

- **Origin-to-address mismatch at signing time.** BOUND warns when a registered site asks for an address it has never used in a role that can move assets — the one thing a hijacked frontend cannot avoid doing.
- **The first victim is protected.** No blocklist entry, no prior victim and no cooperation from the dApp's developers is required, because the comparison is against that site's own history rather than a list of known-bad addresses.
- **Protocol-agnostic by construction.** Nothing in the decoder or the scoring is specific to one protocol. BOUND reads the addresses out of whatever the page asks the wallet to sign. A CoW order's `receiver`, a Uniswap router's `recipient` and a bridge's destination are all found by the same rule, with no per-protocol ABI table.
- **Unforgeable by the threat itself.** The trusted list is anchored in an ENSv2 record under a curator role. Taking over a site's DNS — the attack — grants no ability to add an address to it.
- **An open record rather than a vendor verdict.** Observations, drift and incidents are public on Arkiv with their writers' identity checkable; the snapshot is public on Swarm and hash-verified. Anyone can recompute what BOUND concludes.

### 1.4 Explicit non-goals

1. BOUND does not claim that a call to an authorized address is *safe*. It does not simulate.
2. BOUND does not turn an unknown address into a malicious verdict. Unknown is unknown, and is shown as such.
3. BOUND does not claim that an ENS name proves ownership of a DNS domain. The root record proves only who published the snapshot.
4. BOUND does not claim universal interception. Coverage is reported per request.
5. BOUND does not revoke existing approvals or cancel signatures already given. It links to a revocation tool.
6. BOUND does not intercept private keys, seed phrases or unrelated browsing.
7. BOUND does not block. It warns, and the user decides.

---

## 2. Threat model

### 2.1 Attack scenario

The user deliberately visits `https://swap.cow.fi/`. An attacker controls what the browser receives from that legitimate origin — through registrar takeover, a hijacked DNS provider account, compromised deployment credentials, or a poisoned third-party script. HTTPS still indicates a secure connection *to that origin*; it says nothing about the honesty of the code served. The page asks for `approve(attackerSpender, 2^256−1)`, or an EIP-712 permit naming a malicious spender, or a swap through the real router with the output address changed.

### 2.2 Attacker capabilities and defender assets

**[ASSUMPTION] The attacker may:** replace all scripts and markup at one legitimate origin; deploy contracts in advance and verify them; register addresses and domains ahead of time; issue arbitrary provider calls from the page; alter nested calldata; write arbitrary entities to Arkiv; operate many aged, funded wallets; and block access to the legitimate frontend.

**[ASSUMPTION] The attacker cannot:** compromise the browser or extension binary, the user's signing key, Ethereum consensus, or the curator's ENS role. Stronger adversaries are out of MVP scope and are named in §16.

**Assets protected:** the user's assets and allowances, the user's comprehension of what they are signing, the integrity and freshness of the policy, and reproducible evidence after the fact.

### 2.3 Why origin matching alone fails

`swap.cow.fi` as a browser origin is *context, not authority*. The attacker who hijacks that origin owns its JavaScript during the incident, so the site cannot be allowed to authorize anything about itself — not through a `/.well-known/` file, not through an API response. Trust evidence must come from outside the page and outside the site's DNS. Conversely, an address that is new is not thereby criminal: a protocol ships new contracts, and a user sends to a new address on purpose. Unknown must be held and explained, not declared malicious.

### 2.4 Signals, when each is known, and what it catches

| Signal | When known | Source | Strength | Catches seed-phrase pages |
|---|---|---|---|---|
| Rights-role counterparty never used by this site | At signing | Hook + decoder vs trusted set | Decisive | No |
| Destination never used by this site, not the signer's own | At signing | Hook + decoder | Strong | No |
| Called contract never used by this site | At signing | Hook + decoder | Strong | No |
| Nameserver change | Minutes after hijack | Watcher, DNS-over-HTTPS | Strong | Yes |
| TLS certificate change (new issuer or new names) | Minutes after hijack | Watcher, direct TLS polling | Strong, with corroboration | Yes |
| A-record moves to a different hosting network | Minutes after hijack | Watcher, DoH | Medium, with corroboration | Yes |
| Page served from a never-seen IP | Page load | Extension, `webRequest.ip` | Medium | Yes |
| New outbound hosts on page load | Page load | Extension, `webRequest` | Medium | Yes |
| Site on a known-bad list | Page load | Scam Sniffer open blocklist | Known-bad only | Yes |
| Counterparty contract upgraded or admin changed recently | At signing | Anon-RPC, EIP-1967 slots | Context only | No |

The first row is the core claim: it fires for victim #1 because it compares against the site's own history rather than a list of known attackers.

### 2.5 Attack tree — draining via a compromised frontend

```
Goal: move the user's assets without intended consent
├── A. Compromise the content served at a legitimate origin
│   ├── A1. Registrar / nameserver takeover            [watcher: NS change]
│   ├── A2. DNS provider account hijack                [watcher: A record + cert]
│   ├── A3. CDN or deploy credential compromise        [no infra signal — K-warning path]
│   └── A4. Third-party script supply chain            [no infra signal — K-warning path]
├── B. Induce a dangerous authorization
│   ├── B1. ERC-20 / ERC-721 unlimited approval        [rights role → capped]
│   ├── B2. EIP-2612 or Permit2 signature              [rights role → capped]
│   ├── B3. EIP-7702 delegation                        [rights role → capped; chainId 0 escalated]
│   ├── B4. Authorized router, attacker destination    [destination role → amber, named]
│   └── B5. Permit2 signature transfer, unbound recipient [marked not fully understood]
└── C. Defeat or poison the policy layer
    ├── C1. Bypass the page-side hook                  [UNCLOSED — reported as coverage]
    ├── C2. Forge a seed entity on Arkiv               [snapshot hash vs ENS root]
    ├── C3. Fake witnesses to look familiar            [witnesses never make trusted]
    ├── C4. Replay an old snapshot                     [monotonic epoch]
    ├── C5. Mutate the request after it is scored      [frozen clone; re-check chain]
    └── C6. Use a method BOUND does not decode         [fail-closed: unsupported, not green]
```

### 2.6 Adversarial matrix

| ID | Attack | Mechanism | Countermeasure | Status |
|---|---|---|---|---|
| T01 | Unauthorized spender | `approve(attacker, max)` | Rights-role tagging; cap on a seeded site | **[VERIFIED]** |
| T02 | NFT operator takeover | `setApprovalForAll` | Operator is a rights role | **[VERIFIED]** |
| T03 | Permit2 allowance to attacker | Typed `PermitSingle` | Spender extracted from typed data | **[VERIFIED]** |
| T04 | Permit2 signature transfer | Recipient not in the signed message | Marked "destination not fixed"; never fully understood | **[VERIFIED]** |
| T05 | Authorized router, attacker recipient | Changed `to` / `receiver` | Destination-role tagging across all addresses | **[VERIFIED]** |
| T06 | EIP-7702 delegation to hostile code | Authorization tuple | Delegate is a rights role; `chainId == 0` escalated | **[VERIFIED]** |
| T07 | Same address, different chain | Cross-chain substitution | Trust is per (site, chain) | **[VERIFIED]** |
| T08 | Retained provider bypass | Page cached the provider before the hook | **Not closable from the page.** Reported as coverage | **[MVP: disclosed]** |
| T09 | Legacy `send` / `sendAsync` | Deprecated entry points unwrapped | All three entry points share one gate | **[VERIFIED]** |
| T10 | Forged seed on Arkiv | Anyone may write an entity | Seeds come only from the hash-verified snapshot | **[MVP]** |
| T11 | Fake witnesses | Cheap identities vouching for an address | Witnesses never make an address trusted | **[DESIGN]** |
| T12 | Snapshot rollback | Replay an older, broader snapshot | Monotonic epoch; expiry | **[MVP]** |
| T13 | Altered snapshot via gateway | Gateway serves different bytes | Hash compared with the ENS root | **[MVP]** |
| T14 | TOCTOU payload mutation | Score object A, sign object B | Deep-cloned frozen request; chain re-checked | **[VERIFIED]** |
| T15 | Accessor-bearing request | Getter returns different values | Accessors refused outright | **[VERIFIED]** |
| T16 | Unanticipated signing method | `eth_sendUserOperation`, vendor methods | Allowlist of reads; everything else unsupported | **[VERIFIED]** |
| T17 | Proxy upgraded behind a trusted address | Same address, new implementation | Recent-upgrade signal via Anon-RPC | **[MVP, weak]** |
| T18 | Spoofed in-page warning | Hijacked page draws a fake dialog | Warning is extension-owned, never in the page DOM | **[MVP]** |
| T19 | iframe origin confusion | Child frame requests against the top origin | Origin from extension sender; frame named in warning | **[MVP]** |
| T20 | Griefing a healthy site | Flood of false warned reports | Incident needs K independent reports or corroborated drift | **[DESIGN]** |
| T21 | Curator key compromise | Attacker publishes a hostile snapshot | Single key in MVP — **accepted risk**, disclosed | **[MVP: disclosed]** |
| T22 | Decoder crash or malformed calldata | Depth bombs, truncated args, bad hex | All resolve to "not understood", never to a pass | **[VERIFIED]** |

---

## 3. Design principles and trust boundaries

### 3.1 Principles

1. **Warn, never block.** The user decides. A tool that blocks gets uninstalled and then protects nobody.
2. **Fail toward less certainty, never toward false comfort.** Every degradation path ends in grey or amber, never in an unearned green.
3. **The decision is local.** Nothing on the signing path waits on the network beyond a hard budget.
4. **Authority comes from outside the site.** The site cannot vouch for itself, because the site is the thing that is compromised.
5. **Only trusted sources create trust.** Observation proposes; it never authorizes.
6. **State what is covered.** A request BOUND did not mediate gets no verdict and no green icon.
7. **Publish nothing that identifies a user.** No wallet address, no amounts, no browsing history.

### 3.2 Trust boundary

```
┌──────────────────────────────── UNTRUSTED ────────────────────────────────┐
│ The dApp page (MAIN world JavaScript). May be fully attacker-controlled.  │
│ Anything it says about itself, its origin or its contracts is data.       │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │ EIP-1193 request / send / sendAsync
┌────────────────────────────────────▼──────────────────────────────────────┐
│ HOOK (MAIN world, document_start). Holds no secrets. Deep-clones and      │
│ freezes the request, decodes it, scores it against data fetched earlier.  │
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │ extension messaging
┌────────────────────────────────────▼──────────────────────────────────────┐
│ SERVICE WORKER (ISOLATED). Verifies the snapshot hash against the ENS     │
│ root. Holds the cache. Makes all network calls. Owns the warning window.  │
└───────┬─────────────────────┬──────────────────────┬──────────────────────┘
        │ ENS + Swarm         │ Arkiv                │ Anon-RPC
┌───────▼──────────┐ ┌────────▼─────────┐ ┌──────────▼──────────────────────┐
│ CURATOR-SIGNED   │ │ PUBLIC, WRITABLE │ │ ETHEREUM STATE                  │
│ Trusted only     │ │ BY ANYONE        │ │ Trusted as chain data; the      │
│ because the hash │ │ Trusted only per │ │ provider is not trusted with    │
│ matches the root │ │ writer address   │ │ the user's identity             │
└──────────────────┘ └──────────────────┘ └─────────────────────────────────┘
```

### 3.3 Trust assumptions ledger

| # | Assumption | If it fails | Mitigation |
|---|---|---|---|
| A1 | The curator's ENS role is not compromised | Hostile addresses become trusted | Key separation; public snapshot diffs; **[FUTURE]** M-of-N |
| A2 | The extension binary is not tampered with | Everything fails | Store review; reproducible build |
| A3 | The user's wallet key is not compromised | Out of scope | — |
| A4 | The page cannot read extension-isolated state | Verdicts could be forged | MV3 world separation; nonce-correlated messaging |
| A5 | At least one Swarm gateway serves the snapshot bytes | No fresh snapshot | Cached snapshot until expiry, then grey |
| A6 | DoH and TLS polling see the real records | Drift missed | Multiple resolvers; **[FUTURE]** CT logs |
| A7 | Arkiv accepts and serves the watcher's writes | Stale summaries | Cached bundle; popup states staleness |
| A8 | The hook runs before page scripts | Requests missed | `document_start`, MAIN world, all frames; coverage reported |

---

## 4. Architecture and component responsibilities

### 4.1 System context

| Component | Where it runs | Responsibility | Trusted for |
|---|---|---|---|
| **Hook + decoder** | Page, MAIN world, `document_start`, all frames | Wraps `request`, `send`, `sendAsync`; freezes the request; extracts and tags every address; scores locally | Nothing — it holds no secrets and is treated as exposed |
| **Service worker** | Extension, ISOLATED | Verifies the snapshot against the ENS root; caches snapshot, summaries, drift and status; makes all network calls; owns the warning window | The verdict surface |
| **Warning window** | Extension-owned window | Shows the verdict; Cancel returns EIP-1193 `4001` | Cannot be drawn or clicked by the page |
| **Curator** | Operator | Reviews candidate addresses; compiles the snapshot; publishes the root | Creating trust, under its ENS role only |
| **Watcher** | Small always-on server | Polls DNS and TLS; writes drift, incidents and status; batches observations; builds hourly summaries | Drift, incidents and summaries, under its own address only |
| **Arkiv** | Decentralized data layer | Expiring, queryable live record | Nothing by default — every read filters on writer |
| **Swarm** | Decentralized storage | Hosts the snapshot and incident reports | Nothing — the snapshot is hash-verified |
| **ENSv2** | Ethereum (Sepolia or mainnet) | Holds the snapshot root under a curator role; holds protocol self-attestations | The root of the trust chain |
| **Anon-RPC** | EF anonymizing transport | Counterparty facts without linking wallet, dApp and counterparty | Chain data, not identity |

### 4.2 The trust chain

```
Curator  ──compiles──▶  Snapshot (JSON)  ──uploads──▶  Swarm
                              │                           │
                              └──────hash──────▶ ENSv2 root record
                                                  (curator role only)
                                                          │
Extension ──reads root──▶ fetches snapshot ──hashes it──▶ accepts only on match
```

**[DESIGN]** This is the single most important structural decision in the document. It replaces both "a pinned writer address on Arkiv" (too weak: no cryptographic binding, and a stolen key is undetectable) and "an on-chain PolicyAnchor contract with a guardian freeze" (too heavy for the scope, and a freeze reintroduces blocking, which contradicts principle 1).

### 4.3 Deployment topology **[MVP]**

- **Extension:** unpacked Chromium MV3 build, loaded from the repo.
- **Watcher:** a single small VM or container platform instance. Node process, three timers: DNS/TLS poll, Arkiv batch write, hourly summary.
- **Curator:** a CLI run by a person. Compiles `snapshot.json`, uploads to Swarm, sends one ENS transaction.
- **Demo stack:** a fictional dApp on a domain the team controls, plus a second server serving the drainer, plus a DNS/certificate swap script.

### 4.4 Key management

| Key | Holds | Used for | Separation rationale |
|---|---|---|---|
| Curator | ENSv2 role on the root record | Publishing the snapshot hash and epoch | Creating trust. Highest value |
| Watcher | Arkiv writer address | Drift, incidents, status, summaries, batched observations | A stolen watcher key cannot create trust |
| Swarm postage | Postage batch funding | Uploading snapshots and reports | Operational spend, no authority |
| User wallet | The user | Signing. BOUND never touches it | BOUND is never custodial |

**[MVP]** The curator is a single key and this is disclosed. **[FUTURE]** M-of-N curator signatures verified by the extension.

---

## 5. Trust anchoring: snapshot, root, epoch

### 5.1 Snapshot schema **[DESIGN]**

```jsonc
{
  "schemaVersion": 1,
  "epoch": 7,
  "generatedAt": "2026-11-08T10:00:00Z",
  "expiresAt":   "2026-11-15T10:00:00Z",
  "network": "sepolia",
  "sharedContracts": {
    // trusted on every site: Permit2, WETH, Multicall3 and similar
    "1": ["0x000000000022d473030f116ddee9f6b43ac78ba3"]
  },
  "sites": {
    "swap.cow.fi": {
      "1": {
        "trustedCounterparties": ["0x…"],   // may hold rights or be a destination
        "trustedContracts":      ["0x…"],   // may be called
        "deployers":             ["0x…"],   // lineage: a new contract from these is amber, not red
        "source": "protocol docs + verified deployment"
      }
    }
  }
}
```

It contains no user data, no observations and no drift. A few hundred sites is a small file.

### 5.2 The root record

The curator uploads the snapshot to Swarm, then writes three values into a record on BOUND's ENSv2 name: the snapshot's hash, its epoch, and its Swarm reference. **[ASSUMPTION]** ENSv2 Enhanced Access Control can scope write permission to a single record key for a single name; if the role turns out to apply per-resolver rather than per-name, a dedicated resolver is deployed for the BOUND namespace. **This must be validated before building on it (§18.1).**

### 5.3 Verification in the extension

1. Read the root (hash, epoch, Swarm reference) from ENS.
2. Fetch the snapshot from Swarm through any gateway.
3. Hash the received bytes. **Discard unless the hash matches the root.**
4. Reject any snapshot whose epoch is lower than the one already held.

A gateway therefore cannot alter seeds, and nobody can introduce a seed by writing to Arkiv.

### 5.4 Epoch, expiry and failure behaviour

| Condition | Behaviour |
|---|---|
| Hash mismatch | Snapshot discarded; previous snapshot retained if still current |
| Lower epoch than held | Refused; previous epoch stands |
| Past `expiresAt` | Every site treated as having no trusted list: grey or amber, popup says the snapshot is stale |
| ENS unreachable, cached snapshot current | Cached snapshot used; staleness shown |
| ENS unreachable, no current snapshot | Grey everywhere |

**A stale or missing snapshot never blocks anything.**

### 5.5 How coverage grows past what the curator curates

The snapshot is a bootstrap, not the plan. Three paths add sites without the curator:

1. **Protocol self-attestation [MVP, cut-first].** A protocol publishes its own addresses in its ENSv2 name under its own keys. An attested address is trusted with no curator involvement, and an attacker who hijacks the protocol's DNS cannot edit the name.
2. **Crawler proposals [FUTURE].** Automated discovery proposes addresses for the next snapshot; a person confirms before they are trusted.
3. **Witnesses.** Lift uncurated sites from grey to amber. They never create trust (§11).

The curator is open source and its snapshot is public, so anyone can run one and the extension can be pointed at additional curator names a user chooses to trust.

---

## 6. The live record on Arkiv

### 6.1 Entity types

| Object | Key fields | Written by | Lifetime |
|---|---|---|---|
| `observation` | site, kind (counterparty, called-contract, ip, host, bundle, or `warned`), value, chainId, witness proof, nullifier, time | Extension, submitted in the watcher's batch | 30 days |
| `baseline` | site, chainId, known counterparties and called contracts, distinct witness count, first-seen per entry | Watcher, hourly | Overwritten |
| `drift` | site, kind (ns, cert, a-record), old, new, corroborated, evidence link | Watcher | 7 days |
| `incident` | site, signals fired, severity, started_at, swarmRef (public report) | Watcher | 30 days |
| `status` | site, current state, feed reference | Watcher | Overwritten |

Seeds are deliberately **not** an Arkiv entity type. They live only in the hash-verified snapshot (§5).

### 6.2 Owner filtering **[DOC]**

A schema tag or attribute does not authenticate a publisher: anyone can write an entity carrying any attributes. Every read therefore constrains `$owner` to the watcher's address, **and** the extension re-checks the owner of each entity returned before using it. Observations are the only entities accepted from other writers, and they count only through the witness rules.

```python
# Conceptual Arkiv query: this site's current baseline, from the watcher only.
'$owner = "0x<watcher>" && kind = "baseline" && site = "swap.cow.fi" && chainId = 1'
```

### 6.3 Expiry and summaries

Observations expire after 30 days and drift after 7, so storage stays roughly flat rather than growing forever; the watcher extends an entity's expiry rather than writing a duplicate. About once an hour the watcher folds raw observations into one `baseline` per (site, chain). Raw observations remain public, so anyone can recompute a summary and check the watcher's work.

### 6.4 Read privacy

Querying Arkiv per visited site would reveal which dApps a user opens. Instead the extension downloads **all seeded baselines as one bundle** on a timer and looks sites up locally. A single-site query is issued only for an unseeded site, and those reads go through Anon-RPC. One small `status` read per page load on a seeded site keeps incident propagation fast without revealing more than the site already knows.

### 6.5 Scale **[ASSUMPTION — estimate, not measured]**

Arkiv stores facts about sites, not transactions, and the number of facts barely grows with transaction volume because thousands of swaps on one site hit the same one or two addresses. The extension writes only the first time it sees a (site, counterparty) pair, plus a weekly refresh. At 10,000 users: hundreds of thousands of sightings a day, deduplicating to a few thousand observations, batched into a couple hundred Arkiv transactions, plus a few hundred baseline entities. The hackathon demo needs a few dozen entities.

---

## 7. Browser interception and enforcement

### 7.1 The central limitation **[DOC]**

EIP-1193 defines a single `request({ method, params })` method on the provider, and EIP-6963 lets multiple wallets announce providers independently. EIP-1193's own security considerations describe the provider as an ordinary JavaScript object whose properties consumers can read or overwrite, and advise treating it as potentially controlled by an adversary.

**Consequence:** an independent browser extension cannot force every wallet request through its own policy. A page can retain a provider reference captured before the hook ran. This is the product's principal limitation, it cannot be closed from the page, and BOUND reports it rather than concealing it.

### 7.2 Enforcement strategies, ranked

| Strategy | Can it hold a request? | Coverage | Honest status |
|---|---|---|---|
| A. Wallet-native pre-sign hook | Yes, authoritatively | Wallet-specific | **[FUTURE]** — the only real answer |
| B. In-place patch of `request` / `send` / `sendAsync` at `document_start` | Yes, for requests that use the patched methods | High in practice | **[MVP]** — what BOUND does |
| C. EIP-6963 announcement instrumentation | Yes, for providers the app selects after announcement | Partial | **[MVP]** — fallback when `window.ethereum` is locked |
| D. Network-layer interception | No | Not a signing boundary | Rejected |
| E. WalletConnect relay interception | No, not from an unrelated extension | — | **[FUTURE]** |

### 7.3 MV3 module architecture and manifest **[MVP]**

```json
{
  "manifest_version": 3,
  "name": "BOUND",
  "permissions": ["storage", "scripting", "tabs", "alarms", "webRequest"],
  "host_permissions": ["https://*/*"],
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    { "matches": ["https://*/*"], "js": ["relay.js"],
      "run_at": "document_start", "world": "ISOLATED", "all_frames": true },
    { "matches": ["https://*/*"], "js": ["decoder.js", "hook.js"],
      "run_at": "document_start", "world": "MAIN", "all_frames": true,
      "match_about_blank": true }
  ]
}
```

`https://*/*` is broad; **[FUTURE]** narrow to user-enabled sites. MAIN-world scripts hold no secrets and are treated as adversarial input.

### 7.4 Three entry points, one gate **[VERIFIED]**

EIP-1193 deprecates `send` and `sendAsync` to an appendix, but wallets still expose them and older dApp code still calls them; unwrapped they are a direct line to the wallet. All three go through one gate. BOUND patches the methods **in place** rather than wrapping the provider in a proxy, so `on`, `removeListener` and wallet flags keep working untouched.

### 7.5 Request integrity **[VERIFIED]**

A hostile page can hand over a request object and mutate it while BOUND is deciding, so the wallet signs something other than what was checked. The hook deep-clones the request at entry — refusing accessors, functions and oversized payloads — scores the clone, and forwards that same frozen clone. It re-checks the chain id immediately before forwarding and treats a change as cancellation.

### 7.6 Provider events and cache invalidation **[VERIFIED]**

`chainChanged`, `accountsChanged` and `disconnect` are how BOUND learns its cached facts are stale. **Validated snapshot entries are cached; decisions never are.** A decision taken while a warning was open is void if one of those events fired in the meantime, and the request is cancelled rather than forwarded against a chain or account the user never saw.

### 7.7 Origin canonicalization **[DESIGN]**

The site identity is taken from the extension's own sender and tab data, never from a value supplied by the page. HTTPS is required; the host is IDNA-normalized and lower-cased; a non-default port is preserved; **there is no suffix matching.** `foo.swap.cow.fi` and `cow.fi.evil.example` are not `swap.cow.fi`. The baseline is keyed on the top-level host plus the chain id. A value-moving request originating in a cross-origin frame is itself a signal, and the warning names the frame's own origin.

### 7.8 Coverage states

Every request is recorded as one of:

| State | Meaning | Icon |
|---|---|---|
| `mediated` | Decoded and scored | Colour by score |
| `unsupported` | A method BOUND does not decode; forwarded with no opinion | Never green |
| `bypass_possible` | A provider path BOUND could not patch | Never green |

An unqualified green badge is shown only for a request that was mediated and scored.

### 7.9 Method classification — fail-closed **[VERIFIED]**

BOUND keeps an **allowlist of read-only methods** that pass untouched. Value-moving methods are decoded. **Anything else is reported as unsupported rather than forwarded silently.** A list of known-dangerous methods would be fail-open: the next signing surface nobody anticipated would sail through with a green icon.

| Method | Handling |
|---|---|
| `eth_chainId`, `eth_call`, `eth_getBalance`, `eth_getLogs`, … | Pass |
| `wallet_switchEthereumChain`, `wallet_getPermissions`, … | Pass |
| `eth_sendRawTransaction` | Pass — already-signed bytes the page cannot produce |
| `eth_sendTransaction`, `eth_signTransaction` | Decode calldata |
| `wallet_sendCalls` (EIP-5792) | Decode **every** call; one undecodable call makes the batch opaque |
| `eth_signTypedData[_v3,_v4]` | Decode typed data |
| `wallet_signAuthorization` / `eth_signAuthorization` | Decode EIP-7702 delegation |
| `eth_sign` | Blind hash — always escalated |
| `personal_sign` | Decoded as carrying no counterparty |
| Anything else | **Unsupported**, never green |

---

## 8. The decoder

### 8.1 Intermediate representation and roles **[VERIFIED]**

Every value-moving request is converted into a set of addresses, each tagged with the role it would play. **This is the central mechanism, and it is what makes BOUND protocol-agnostic.**

| Role | Meaning | Examples |
|---|---|---|
| `rights` | Will be able to move assets later | `approve` spender, `setApprovalForAll` operator, EIP-2612 / Permit2 spender, EIP-7702 delegate |
| `destination` | Where assets go now | `transfer` recipient, router `recipient`, order `receiver`, bridge destination |
| `called` | The contract the request is addressed to | Any unrecognized target |
| `token` | The asset involved | Scored as a called contract |

A CoW order's `receiver`, a Uniswap router's `recipient` and a bridge destination are all destination-role addresses found by the same rule, with no per-protocol table.

### 8.2 Selector table **[VERIFIED]**

| Selector | Function | Role | Arg |
|---|---|---|---|
| `0x095ea7b3` | `approve(address,uint256)` | rights | 0 |
| `0x39509351` | `increaseAllowance(address,uint256)` | rights | 0 |
| `0xa22cb465` | `setApprovalForAll(address,bool)` | rights | 0 |
| `0xa9059cbb` | `transfer(address,uint256)` | destination | 0 |
| `0x23b872dd` | `transferFrom(address,address,uint256)` | destination | 1 |
| `0x42842e0e` | `safeTransferFrom(address,address,uint256)` | destination | 1 |
| `0xb88d4fde` | `safeTransferFrom(address,address,uint256,bytes)` | destination | 1 |
| `0x87517c45` | `Permit2.approve(address,address,uint160,uint48)` | rights | 1 |
| `0xd505accf` | `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` | rights | 1 |

**Security rule:** the `to` of `approve` is the *token*; the spender is the *first calldata argument*. A check that recognizes a trusted token but ignores the spender misses the entire attack.

**[VERIFIED]** A known selector whose arguments are truncated is **not** a decode: with no address to compare there is nothing to check, so it scores as opaque rather than clean. The prototype originally got this wrong and would have scored a malformed `approve` as green.

### 8.3 Typed data **[VERIFIED]**

`Permit` → spender as rights. `PermitSingle` / `PermitBatch` → spender as rights. Seaport `OrderComponents` → any consideration recipient that is not the offerer, as a destination. Unrecognized typed data → fields matched by name, split into rights names (`spender`, `operator`, `delegate`) and destination names (`to`, `recipient`, `receiver`, `beneficiary`), bounded recursion depth, marked opaque.

### 8.4 Permit2 signature transfers — where decoding cannot help **[DOC]**

The signed `PermitTransferFrom` struct contains `token`, `amount`, `nonce`, `deadline` and `spender`. The **recipient is not in the signed message**: it is supplied in `SignatureTransferDetails` when the transfer executes, and it need not equal the spender. Uniswap's own documentation warns that a router which does not validate caller context can have a valid signature replayed to redirect funds.

**[DESIGN]** BOUND extracts the spender, which is the decisive field, and marks these requests **"destination not fixed by this signature"**, never counting them as fully understood. `PermitWitnessTransferFrom` is treated the same way, because the witness blob can carry the real recipient in a structure BOUND has no type for.

### 8.5 EIP-7702 **[VERIFIED]**

The delegate address is a rights-role counterparty. `chainId == 0` widens replay scope across chains under the EIP and is flagged separately rather than treated as an ordinary chain mismatch. **[ASSUMPTION]** Wallet signing surfaces for 7702 vary; if no available wallet exposes one, this path ships untested against a real wallet and says so.

### 8.6 Opaque calldata and the address scan **[VERIFIED]**

For calldata BOUND cannot decode, the called contract is reported, and the 32-byte words are scanned for values shaped like addresses. A word qualifies when its top 12 bytes are zero and the remaining 20 bytes are neither zero nor begin with two zero bytes — that last rule is what stops ordinary left-padded `uint256` amounts being read as addresses. Hits are tagged destination and marked **unverified** in the warning.

It is a heuristic: it misses an address assembled at runtime and it flags a pool or token that is merely new. **It can only lower a score, never raise one.**

### 8.7 Panic safety **[VERIFIED]**

Malformed calldata, non-hex data, selector collisions, trailing bytes, JSON depth bombs and oversized payloads all resolve to "not understood", which scores as opaque. Amounts are handled as big integers throughout; `Number` is never used for 256-bit values. A decoder exception is caught and treated as not understood — never as a pass.

### 8.8 Implementation status

**[VERIFIED]** The decoder and hook are implemented and tested: **75 decoder checks and 38 hook checks, 113 total, all passing.** Fixtures are built with `viem` so the calldata is real encoding rather than hand-written hex. The hook suite includes the drainer sent through `send`, mutation of the request while the warning is open, an accessor-bearing request, an unanticipated method, and `chainChanged` causing a previously green request to re-score on the new chain.

---

## 9. Policy engine and scoring

### 9.1 Trusted counterparties **[DESIGN]**

Only trusted sources create trust. An address is **trusted for a site** if any of these holds:

1. It is in the hash-verified snapshot for that site **and chain**.
2. It is attested in the protocol's own ENSv2 name.
3. It is on the global shared-contract list (Permit2, WETH, Multicall3 and similar), trusted on every site.
4. It was deployed by an address that already deployed one of that site's trusted contracts.

Trust is always per (site, chain): the same address on another chain is a separate fact and starts untrusted.

### 9.2 Signals and starting weights

A site with a baseline starts at 50. A site with none shows grey and is not scored.

| Signal | Effect |
|---|---|
| Counterparty attested in the protocol's ENSv2 name | +40 |
| Counterparty in the trust snapshot for this site and chain | +35 |
| Counterparty seen by ≥ N independent witnesses over ≥ M days | up to +30 — **never lifts the cap** |
| Counterparty verified and deployed by a deployer already trusted for this site | +15 |
| Called contract known for this site and chain | +20 |
| Called contract never seen for this site and chain | −30 |
| Nameserver change in the last 6h, or a corroborated certificate or A-record change | −30 each, at most −45 |
| Page served from a never-seen IP | −15 |
| New outbound hosts on page load | −10 |
| Proxy upgraded or admin changed in the last 24h | −10 |
| Site on Scam Sniffer's blocklist, or an `eth_sign` raw-hash request | score 0 |

### 9.3 The cap — the rule that decides everything

```
score = clamp(sum(signals), 0, 100)
score = min(score, cap(site, counterparties))

cap:
  trusted counterparty in every role                      → no cap
  untrusted RIGHTS-role address, site has a snapshot entry → 35   (15 with corroborated drift)
  untrusted DESTINATION not among signer's own accounts    → 65   (amber, address named)
  untrusted address, site uncurated and witnessed          → 65
  untrusted address, site uncurated and unwitnessed        → 35   (15 with drift)
```

**Why age and verification do not lift the cap.** An attacker who plans ahead deploys and verifies a drainer contract weeks before the hijack. If contract age or verified source could escape the cap, that attacker lands on amber and the drain proceeds almost silently. Only the four trusted sources in §9.1 lift it.

**Why witnesses do not lift it.** Aged, funded wallets are cheap at scale, and an attacker need not even visit the site to submit observations. Witnesses propose; they never vouch.

### 9.4 Thresholds

| Score | State | What the user sees |
|---|---|---|
| 70–100 | Green | Nothing; icon stays green |
| 40–69 | Amber | A note in the popup; the address named if it is an unknown destination |
| 16–39 | Red | Warning window: Continue or Cancel |
| 0–15 | Escalated | Full-screen warning; Continue requires typing a confirmation; evidence link |
| No baseline | Grey | Forwarded, no score |
| Not value-moving | — | Untouched |

### 9.5 Decision order

1. **Is the method one BOUND handles?** Reads pass. Value-moving methods are decoded. Anything else → unsupported, no score, no green.
2. **Is it `eth_sign`, or is the site on the blocklist?** → score 0, escalated.
3. **Can the request be decoded?** Known function or typed data → tag every address by role. Unknown → called contract plus an unverified address scan. No simulation in v1.
4. **Does the site have a snapshot entry or summary for this chain?** No → grey, forwarded, no score.
5. **Is each counterparty trusted?** (§9.1) Attested +40 and exempt from the cap; snapshot +35 and exempt.
6. **Is any rights-role address untrusted?** → the cap applies at 35.
7. **Is any destination neither trusted nor the signer's own?** → cap at 65, named in the warning.
8. **Add the remaining signals.** Anon-RPC facts come with a **1.5 second budget**; if it expires the request is scored without them, which means an untrusted counterparty stays capped, and the warning says a check timed out. Signing never waits beyond that budget.
9. **Clamp to 0–100, then apply the cap.** Corroborated drift lowers a 35 cap to 15.
10. **Map to an outcome** (§9.4).

### 9.6 Worked examples

| Case | Arithmetic | Outcome |
|---|---|---|
| Real CoW relayer on cow.fi | in snapshot → uncapped; 50 + 35 + 30 = 115 → clamp 100 | Green |
| Drainer deployed and verified 8 days early | untrusted rights role on a seeded site | 35, Red |
| Same drainer with 500 fake witnesses | witnesses never lift the cap | 35, Red |
| Same drainer with a corroborated cert change | cap drops | 15, Escalated |
| Real router, output address changed to the attacker | untrusted destination | 65, Amber, address named |
| Router v2 from CoW's usual deployer | deployer lineage → trusted; 50 + 15 | 65, Amber → green once attested or in the next snapshot |
| `approve(Permit2)` on any site | shared contract → trusted | Green |
| Counterparty on an uncurated dApp, many witnesses | capped | 65, Amber |

Weights are starting values. Tune until the five seeded real protocols stay green through a normal day and the staged hijack reaches escalated. Domain hygiene (registry lock, DNSSEC, CAA) is shown as context only, never scored.

### 9.7 Why drift needs corroboration **[DESIGN]**

Certificates renew every few weeks and A records move whenever a site redeploys behind a CDN. Counting either alone would put every protocol into amber several times a month, and a warning users have learned to dismiss protects nobody.

- A **nameserver** change counts alone.
- A **certificate** change counts only when the issuing authority changes or the certificate covers new names.
- An **A-record** change counts only when the address moves to a different hosting network.
- Anything else counts only when it coincides with an untrusted counterparty in the same session.

---

## 10. Watcher, drift and incidents

### 10.1 Polling **[MVP]**

The watcher polls each seeded site on a short interval: DNS-over-HTTPS for nameservers and A records, and a **direct TLS connection for the certificate fingerprint**.

**[DESIGN]** Direct TLS polling is used in place of Certificate Transparency log polling. It has no rate limits, no propagation lag, and detects the change the moment the attacker deploys. **[FUTURE]** CT logs additionally catch issuance before deployment and are the production answer.

### 10.2 Drift and incident triggers

A change writes a `drift` entity with a 7-day expiry. An `incident` follows on **either** of two triggers:

1. **Corroborated drift plus at least one `warned` observation.** The registrar-takeover path.
2. **K independent `warned` observations naming the same counterparty, with no drift at all.** The poisoned-script and hosting-compromise path, which produces no infrastructure signal whatsoever.

Drift alone stays drift. One warning declares nothing — that threshold is also what prevents a competitor griefing a healthy site into a red banner.

### 10.3 Status propagation

The watcher sets a small `status` entity per site. The extension reads it on **every page load of a seeded site**, so an incident declared minutes ago is seen now rather than at the next bundle refresh. When drift and warnings stop and the site's own addresses are seen again, status returns to green; the incident and its report remain as the record.

### 10.4 Swarm reports

The watcher uploads an evidence report — certificate entry, nameservers before and after, the untrusted counterparty, how many past sessions saw the usual one — and stores the **plain, non-secret** Swarm reference on the Arkiv `incident`.

**[DOC]** An encrypted Swarm reference contains its own decryption key, so an encrypted reference is never written into a public Arkiv entity.

---

## 11. Contributions and anti-poisoning

### 11.1 The observation model

After a request that passed green or amber on a site with no active incident, the extension keeps only site, kind, value and chain — dropping the wallet address, amounts and timing detail — and sends it to the watcher after a random delay. The watcher verifies, rate-limits, drops duplicates, and submits queued observations as one atomic Arkiv batch. **Users need no gas and no Arkiv account.**

The extension writes only the first time it sees a (site, counterparty) pair, plus a weekly refresh to keep the entity alive. A heavy user produces a few writes a week, not one per swap.

A watcher that stops publishing is visible rather than silent: when observations do not reach Arkiv within an hour, the popup says so. The extension does not write to Arkiv itself, because that would need gas and an account.

### 11.2 The witness group **[STRETCH]**

Joining happens once: the user signs a message, the watcher checks the wallet is at least **Z** days old with real transaction history, and adds the user's anonymous identity commitment to a Semaphore group. Each observation then carries a group proof plus a nullifier unique to **(site, counterparty)** — one vote per member per address, for good. The watcher sees the wallet only at registration and cannot link it to any later observation.

**[DESIGN]** The nullifier is deliberately *not* scoped per week: a weekly nullifier would let one person count as several distinct witnesses over time, which is the exact thing the N-of-M rule is supposed to measure.

**This is a stretch goal.** Until it ships, observations carry a rotating key, witnesses count only on uncurated sites, and the demo runs on seeded sites where witnesses cannot change a verdict either way.

### 11.3 Why witnesses can never create trust

Witnesses never make an address trusted, so on a seeded site they cannot lift the cap at all, and on an uncurated site they reach amber at most. An address widely witnessed on a site is queued for human confirmation and enters the **next snapshot** — which is the cold-start path for a protocol nobody has curated.

### 11.4 Never counted

1. Observations made while the site has an active incident.
2. Counterparties the user only reached by overriding a red warning — so an override never teaches the baseline that an attacker is normal.
3. Observations without a valid group proof.

---

## 12. Privacy

### 12.1 By recipient

| Recipient | May learn | Honest limit |
|---|---|---|
| Hijacked page | Everything it already saw; the wallet address once connected | BOUND cannot retroactively hide what the page already has |
| Arkiv readers | Public site-level facts; no wallet, no amounts, no timing | Observation timing is randomized and batched |
| Swarm gateway | Which content reference was requested, and the client IP | The snapshot is hash-verified, so tampering fails even if the gateway is hostile |
| ENS / Ethereum RPC | Which policy record was queried | Anon-RPC where supported |
| Anon-RPC exit | Query parameters, including addresses being checked | **Does not make the address private from the endpoint**; the chain is public anyway |
| Watcher | Observations with no wallet attached; the wallet once, at group registration | Cannot link registration to later observations |

### 12.2 Anon-RPC **[MVP]**

Signing-time lookups of a counterparty would otherwise tell an RPC provider *wallet + dApp + the address about to be authorized* — a uniquely sensitive triple. These reads are routed through Anon-RPC by default. **[ASSUMPTION]** The harness must supply a genuinely anonymizing worker; an example worker performing an ordinary `fetch` is not anonymous and no privacy claim is made on that basis (§18.1).

### 12.3 What never leaves the browser

Wallet addresses, amounts, transaction hashes, browsing history, override choices, and the contents of any warning.

---

## 13. Failure behaviour

The check at signing never waits on the network beyond its budget. Every outage degrades BOUND to fewer signals, **never to silently letting a request through unscored.**

| Down | Lost | What BOUND does |
|---|---|---|
| ENS or Swarm (snapshot) | A fresh or any trusted list | Cached snapshot while current; past expiry every site falls to grey or amber, popup says stale. Never blocks |
| Arkiv, at page load | Fresh summaries and drift | Last cached bundle; with no cache, grey; popup says "offline baseline" |
| Arkiv, on write | Observations and warned reports | Queued locally, retried later |
| Watcher | New drift and incidents | Counterparty check unaffected; drift goes stale; popup shows last update time |
| Anon-RPC | Counterparty facts | Scored without them after the 1.5s budget, so an untrusted counterparty stays capped; never silently falls back to a public RPC |
| ENS resolution (attestations) | Protocol self-attestations | Treated as not attested; a newly attested contract may show amber |
| Swarm (reports) | Evidence pages | Warnings still show; report link disabled |
| Service worker restart | In-memory cache | Rebuilt from storage; the hook keeps its own copy for the open tab |

---

## 14. End-to-end flows

### 14.1 Normal day

1. On a timer, the service worker refreshes the trust snapshot — root from ENS, file from Swarm, kept only if the hash matches — plus the bundle of per-site summaries.
2. User opens the site. The service worker looks it up in the cached bundle.
3. One small `status` read confirms no active incident.
4. User clicks Swap. The page sends `approve(relayer, amount)`.
5. The hook freezes the request, decodes every address, tags the relayer as a rights role, finds it in the snapshot: trusted, uncapped, 100. Green.
6. Forwarded unchanged; the wallet's own confirmation appears.
7. The extension queues an anonymous observation.

### 14.2 Hijack, first victim

1. User clicks Approve on a page whose URL, padlock and interface look normal.
2. The page sends `approve(attacker, max)`.
3. The hook finds a rights-role address that is not trusted: the cap holds the score at 35. **Red — even if the attacker deployed the contract weeks ago or faked witnesses for it.**
4. The request is paused and the extension-owned warning window opens.
5. The warning names the site, the untrusted counterparty and its role, and the token and amount at risk. It links to a revocation tool for allowances already granted.
6. Cancel → `4001`, the same code a wallet returns on user rejection. **The wallet never sees the request.**
7. An anonymous `warned` observation is sent, feeding §14.4.

Continue instead: forwarded unchanged, the choice logged locally, and **no observation published for that counterparty.**

### 14.3 Hijack with infrastructure drift

1. The attacker repoints nameservers and obtains a new certificate.
2. The watcher sees both within its polling interval and writes corroborated `drift`.
3. On page load the extension shows an amber banner — *before any wallet connects*. This is the only protection a seed-phrase phishing page gets, since it never reaches a signing request.
4. At signing, untrusted rights-role counterparty plus corroborated drift caps the score at 15: escalated, full-screen, typed confirmation required.

### 14.4 Drift becomes a public incident

1. Watcher writes `drift` (7-day expiry).
2. Anonymous `warned` observations arrive from users who hit red.
3. **Trigger A:** corroborated drift + ≥1 warned report. **Trigger B:** K independent warned reports naming the same counterparty with no drift.
4. The watcher uploads the evidence report to Swarm, writes the `incident` with the plain reference, and sets `status` to red.
5. Every extension sees it on its next page load of that site.

### 14.5 Contributing to the baseline

See §11. The invariant: an override never becomes evidence.

### 14.6 Seeding and snapshot publication

1. The team collects each protocol's published addresses from its own documentation and verified deployments.
2. The curator compiles them into one snapshot, uploads it to Swarm, and writes hash + epoch + reference into the ENS root record.
3. On first visit the extension reads the root, fetches the snapshot, verifies the hash.
4. A counterparty in the snapshot for this site and chain is trusted and adds +35 — the site scores green on the first visit, with no witnesses needed.

### 14.7 A protocol attests its own contracts **[MVP, cut-first]**

1. The protocol claims a subname under the BOUND namespace, controlled by its own keys rather than its registrar.
2. It sets its site and attested addresses as records, with Enhanced Access Control limiting who may edit them.
3. It ships router v2 and adds it to the list before launch.
4. A user approves router v2 for the first time anywhere; the extension resolves the attested list through Anon-RPC; +40 and exempt from the cap. Green, no warning.

Without the attestation the same router scores 65 via deployer lineage: amber, a quiet note rather than a warning.

### 14.8 After the fact: recovery

**[DESIGN]** BOUND does not build an independent recovery application. The warning, and the popup's history view, link out to an established revocation interface pre-filled with the token and spender involved. This gives the user a next action at near-zero build cost. **[FUTURE]** A Swarm-hosted, hash-pinned recovery page that survives the original site going offline.

### 14.9 Component failure

See §13.

---

## 15. Security invariants and test framework

### 15.1 Non-negotiable invariants

| # | Invariant | Test oracle |
|---|---|---|
| I1 | No entity written by an untrusted address can authorize anything | Inject a seed-shaped Arkiv entity from another address → ignored |
| I2 | Every decoded address is checked, not just the first argument | Mutate a spender inside an otherwise valid `approve` → red, real spender named |
| I3 | One undecodable call taints a whole batch | Mixed EIP-5792 batch → opaque, no partial pass |
| I4 | A stale or rolled-back snapshot never grants trust | Lower epoch → refused; past expiry → grey |
| I5 | A tampered snapshot is never used | Altered bytes from a gateway → hash mismatch → discarded |
| I6 | Chain is part of every trust decision | Same address on another chain → not trusted |
| I7 | The bytes forwarded equal the bytes scored | Mutate during the warning → wallet receives the frozen clone |
| I8 | No unanticipated method passes as safe | `eth_sendUserOperation` → unsupported, not green |
| I9 | The page cannot manufacture or suppress a verdict | Replace `window.confirm` → ignored; warning is extension-owned |
| I10 | A decoder failure never becomes a pass | Malformed calldata, depth bombs → opaque |
| I11 | Nothing identifying a user is published | Scan every Arkiv write for addresses or session identifiers |
| I12 | An override is never published as evidence | Continue past red → no observation for that counterparty |

### 15.2 Adversarial cases, including the one BOUND fails

| Case | Expected |
|---|---|
| Mutate the spender inside a valid `approve` | Red; warning names the real spender |
| Mix one undecodable call into an EIP-5792 batch | Whole batch held |
| Replay a legitimate request on another chain | Not trusted on that chain; capped |
| Seed-shaped Arkiv entity from another address | Ignored |
| Altered snapshot via a Swarm gateway | Hash mismatch; discarded; site falls to grey |
| Snapshot with a lower epoch | Refused |
| Drainer contract deployed and verified weeks early | Still capped at 35 |
| 500 fake witnesses backing the drainer | Still capped at 35 |
| Drainer sent through `send()` and `sendAsync()` | Gated identically; wallet never sees it |
| Swap the calldata while the warning is open | Wallet receives the frozen copy |
| Request field is a getter | Refused; no stable copy, no promise |
| `chainChanged`, then replay a green request | Re-scored on the new chain |
| Value-moving request by an unknown method | Unsupported; icon not green |
| **Page uses a provider reference captured before the hook ran** | **BOUND never sees the request. Reported as `bypass_possible`.** |

**The last row is a failure and is demonstrated as one.** One extension cannot force another extension's wallet to route through it, and a product implying otherwise is lying to its users. Closing it requires wallet-side integration.

### 15.3 Prototype results

**[VERIFIED]** 75 decoder checks + 38 hook checks = **113 passing**. Fixtures built with `viem`. Run `node test.js && node hook-test.js`.

### 15.4 Metrics, not marketing scores

No detection figure is published without the set of attacks it was measured against, the number of cases and the misses. *"Held nine of our eleven attack fixtures, and here are the two it missed"* is worth more than a percentage with no denominator. Report separately: mediated-request fraction, true-positive fraction within stated scope, false-hold fraction on legitimate fixtures, decision latency p50/p95, and stale-snapshot detection rate.

---

## 16. Limitations, cuts and roadmap

### 16.1 Severity rubric

**Critical:** invalidates the main claim or enables theft. **High:** enables bypass or poisoning. **Medium:** limits coverage, reliability or privacy. **Low:** presentation.

| Severity | Limitation | MVP mitigation | Remediation |
|---|---|---|---|
| **Critical** | An independent extension cannot intercept every signing path | Patch all three entry points; report coverage per request; demo the bypass | **[FUTURE]** wallet-native pre-sign hook |
| **Critical** | A trusted address is not a safe address | Check every address in every role; no claim of safety | **[FUTURE]** simulation with asset-delta checks |
| **Critical** | Permit2 signature transfers do not commit the destination | Marked never fully understood | **[FUTURE]** caller-context attestations |
| **High** | The curator is a single key | Key separation; public snapshot diffs; disclosed | **[FUTURE]** M-of-N verified in the extension |
| **High** | Proxy upgrades keep the external address | Recent-upgrade signal | **[FUTURE]** codehash pinning and upgrade monitors |
| **High** | A hijack with no infrastructure change produces no early signal | K-warning incident trigger | **[FUTURE]** script integrity monitoring |
| **Medium** | Arkiv entities are public and writable by anyone | Owner filter plus re-check; seeds not on Arkiv at all | — |
| **Medium** | Anon-RPC does not hide an address from the endpoint | Disclosed; reads minimized | **[FUTURE]** PIR or light-client reads |
| **Medium** | Swarm persistence depends on postage | Batch documented and funded | **[FUTURE]** replication monitoring |
| **Medium** | MV3 service workers suspend | Idempotent request ids; state in storage | **[FUTURE]** wallet-integrated guard |
| **Low** | New legitimate contracts from a new deployer key show red | Deployer lineage covers the common case; ENS attestation covers the rest | — |

### 16.2 The hardest unsolved problem

A trustworthy chain of *this origin belongs to this protocol, which controls this contract, which may perform this action* cannot be established by TLS (which authenticates a connection, not the code served), by an ENS name (which proves control of a name, not of a DNS domain), or by self-submitted metadata. Because the threat **is** website compromise, nothing the site serves — including a `/.well-known/` file — may authorize a new address during an incident. BOUND's answer is a curated, anchored list plus protocol self-attestation under keys the registrar does not control. That is a mitigation, not a solution.

### 16.3 What was deliberately cut, and why

| Cut | Reason |
|---|---|
| On-chain PolicyAnchor contract and guardian freeze | A second governance surface for what the ENS root + epoch already does, and a freeze reintroduces blocking |
| Safe Mode recovery application | Cannot reproduce solver-based or off-chain-dependent protocol flows; replaced by a revocation link (§14.8) |
| ERC-7730 importer as the data layer | Belongs to a different Arkiv track; coverage of the five demo protocols unverified. **[FUTURE]** useful as a *labelling* aid in the warning |
| Crawler with a mock wallet on a forked chain | A day of work the demo never shows; hand-curated addresses do the same job |
| Certificate Transparency log polling | Direct TLS polling is simpler, faster and has no propagation lag |
| Merkle proofs per snapshot entry | The snapshot is small enough to fetch whole and hash |
| Multi-curator quorum | Single key disclosed instead |
| Semaphore witness group | Moved to stretch; the demo does not depend on it |

---

## 17. Partner tracks and submission evidence

### 17.1 Track selection

Three partner picks are allowed; Arkiv and its Swarm bonus count as one. A team may win **one** Arkiv track. A project may be considered for **one** EF prize.

| Track | Prize | Why it is load-bearing | Required evidence |
|---|---|---|---|
| **Arkiv — Build on Arkiv (from scratch)** | $3,000 / $1,000 | The record of normal behaviour must not sit on one operator's server, since infrastructure takeover is the attack; expiry keeps it current; queries filter by site, kind and owner | Writes to the current Arkiv testnet; a user-visible feature reading from it; README with writing wallet and a runnable query; `/arkiv/friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`, `schema.md`; open licence; AI-use disclosure |
| **Arkiv × Swarm bonus** | $500 | The snapshot and incident reports live on Swarm; an Arkiv entity carries the reference | `/arkiv/swarm.md` with what is stored where, an entity key and its Swarm reference, postage batch id, upload and read code, reproduction steps, demo timestamp, friction notes |
| **ENS — Best Use of ENSv2** | $3,000 / $2,000 / 2 × $1,000 | Two non-cosmetic uses: the root record holding the snapshot hash under a curator-scoped role, which is what makes seeds unforgeable by a site's own DNS; and protocol subnames where teams attest their own addresses through Enhanced Access Control | ENSv2 on mainnet or Sepolia, central to the product; functional demo with no hard-coded values; live demo link; open source |
| **EF — Best Use of Anon-RPC** | $2,500 / $1,500 / $1,000 | Signing-time counterparty lookups would otherwise reveal wallet + dApp + intended counterparty together | RPC reads routed through Anon-RPC by default; a genuinely anonymizing worker; disclosed exclusions |

**[DESIGN]** CROPS is not pursued: its strongest story is continuity after the original site goes offline, which was Safe Mode, and Safe Mode is cut.

### 17.2 Track-to-feature-to-proof matrix

| Track | Feature | Live proof | Repo artifact |
|---|---|---|---|
| Arkiv | Site baselines, drift, incidents, status | Query by site and chain from the public RPC, live on stage | Importer, entity keys, query, five `/arkiv/*.md` files |
| Arkiv × Swarm | Snapshot and incident report on Swarm, referenced from Arkiv | Read the Arkiv entity, fetch the Swarm reference, verify the hash | `/arkiv/swarm.md`, batch and node details |
| ENSv2 | Root record under a curator role; protocol attestation | Publish epoch 8 on stage and watch the extension pick it up | Name, role grant proof, transaction hashes |
| EF Anon-RPC | Counterparty lookups at signing | Network trace showing reads through the worker | Harness config, worker hash, privacy disclosure |

---

## 18. Hackathon execution

### 18.1 Prechecks — do these before committing

Each is an hour or less. Any one of them failing changes the plan.

| Check | Why | Fallback |
|---|---|---|
| **A domain you control with 60-second DNS TTL and a certificate you can reissue on demand — configured *before* the event** | The most likely thing to wreck the demo; everything in the hijack act depends on repointing DNS fast | Pre-record the hijack act |
| **Arkiv testnet: which network is live for Mumbai; faucet; write one entity; query by annotation; confirm owner filtering** | The entire data layer. **Sources disagree on the current testnet name and chain id — resolve this first** | None; if Arkiv writes are unreliable the Arkiv track is the submission |
| **ENSv2 on Sepolia: register a name and grant write permission scoped to one record** | §5.2 is an assumption, not a verified fact. If roles are per-resolver, a dedicated resolver is needed | Plain text record on a name owned by a multisig, with the limitation stated |
| **Swarm: fund a postage batch, upload, read back through a gateway, verify the hash client-side** | Postage funding is a classic time sink and the bonus needs the batch id | Drop the bonus, keep Arkiv |
| **Anon-RPC: does the harness ship a genuinely anonymizing worker?** | The prize explicitly does not count a plain `fetch`. Decides whether the claim can be made honestly | Write the worker, or drop the EF submission |
| **Install MetaMask, Rabby and Coinbase Wallet; paste the console bundle; confirm the provider is patched and a test `approve` warns** | A wallet that makes `window.ethereum` non-configurable must be discovered on day one | Use whichever wallet behaves; state the limit |
| **MV3: can the service worker open an extension-owned window from a request handler with no user gesture?** | The entire warning surface | Fall back to the captured native `confirm`, as the prototype does |
| **Verify the five protocols' real addresses from their own documentation** — including the CoW relayer, which has not been confirmed against a block explorer | A wrong seed makes a real site show red on stage | — |

### 18.2 Scope

**P0 — must work end to end**

1. Extension: hook, decoder, extension-owned warning window, coverage states, popup.
2. Snapshot: format, Swarm upload, ENS root record, hash verification in the extension, one epoch bump on stage.
3. Arkiv: entity schemas, read path (bundle plus per-page-load status), write path for observations through the watcher.
4. Watcher: DNS and TLS polling with the corroboration rule, drift, incidents, status, hourly summaries.
5. Anon-RPC for signing-time counterparty facts.
6. Demo: fictional dApp, five seeded real protocols, second hijack server with cloaking, DNS and certificate swap script.
7. Adversarial test suite including the bypass case.
8. Public repo with every required write-up file.

**Cut first, in this order:** protocol ENS attestation → address scan of undecodable calldata → EIP-7702 handling if no wallet exposes it → Semaphore witness group → simulation of anything.

### 18.3 Workstreams

| Owner | Workstream | Must ship | Cut first |
|---|---|---|---|
| Person 1 | Extension: hook, decoder, warning | Provider wrapping incl. EIP-6963, `send`/`sendAsync`, provider-event invalidation, wallet-collision test; decoder with role tagging (**done, 113 checks**); frozen request bytes; coverage states; origin canonicalization; panic safety; warning window | Address scan; 7702 if unavailable |
| Person 2 | Trust layer + scoring | Snapshot format and hash verification against the ENS root; score with its cap, per chain; Arkiv schemas; read path; write path; adversarial test suite; `/arkiv/*.md` | Semaphore group (stretch) |
| Person 3 | Watcher + Swarm + ENS root | DNS and TLS polling with corroboration; drift, incident, status entities; hourly summaries; snapshot upload and ENS root publication incl. a live epoch bump; incident reports; `swarm.md` | Domain feeds; encrypted evidence packs |
| Person 4 | Demo stack + Anon-RPC + pitch | Fictional dApp and five seeded protocols; hijack server with cloaking; DNS/cert swap script; Anon-RPC lookups with the 1.5s budget; recorded bypass case; video and slides | — |

### 18.4 Critical path

| Milestone | Exit condition |
|---|---|
| M0 | A real wallet request passes through the hook on the fictional dApp |
| M1 | An untrusted rights-role address is held before the wallet sees it |
| M2 | Snapshot published to Swarm, root in ENS, extension verifies the hash |
| M3 | Arkiv read and write paths live with a reproducible public query |
| M4 | Watcher detects a staged DNS and certificate change |
| M5 | Full demo run-through, end to end, with nothing stubbed |
| M6 | Anon-RPC evidence captured; adversarial suite green except the disclosed bypass |

**A complete run-through happens before any stretch work begins.**

### 18.5 Demo script

1. **Normal day.** The fictional dApp plus five real protocols, all green in the same browser. The Arkiv baseline is queried live on screen.
2. **Where the trust comes from.** Show the ENSv2 record holding the snapshot root; fetch the snapshot from Swarm in front of the judges; show the extension rejecting a deliberately altered copy. Publish epoch 8 adding a new router and watch the extension pick it up. *This is the governance story without a freeze contract.*
3. **Hijack.** Repoint DNS to the second server and issue a new certificate. The watcher logs both; the extension turns amber **before any wallet connects**.
4. **Cloaking.** The hijacked server serves the clean page to a headless scanner and the drainer only to a real browser with a wallet. Show the scanner's verdict: clean. *This is the answer to "how is this different from a site scanner".*
5. **The click.** The warning names the untrusted counterparty and the token at risk; Cancel returns `4001` and the wallet popup never opens. Repeat on one of the five real protocols with a swap whose output address was changed — the same check catching a different protocol's attack with no protocol-specific code.
6. **Evidence and limits.** Open the incident's Swarm report from the warning and the Arkiv entity holding its reference. Then show the bypass test failing deliberately, and the invariants table.
7. **Close.** One slide of the real timeline: hijack at 14:54 UTC, first team warning at 15:41, about $1.2M lost in three hours.

Two things are pre-recorded in case the live run misbehaves: the certificate step, and the bypass case. **No clone of a real brand's site is built at any point.**

### 18.6 What judges can replay independently

- Load the extension, open the test dApp, run the benign and malicious flows with no console intervention.
- Fetch the ENS root, fetch the snapshot from a *different* Swarm gateway, compute the hash themselves.
- Query Arkiv for a site's baseline from the public RPC.
- Inspect the ENSv2 role grant and the publication transactions in an explorer.
- Run `node test.js && node hook-test.js` and see 113 checks pass.
- Run the bypass case and watch BOUND fail to see the request.

---

## 19. Claims BOUND does not make

1. BOUND does not block drainers. It warns on requests it mediates and decodes, and the user decides.
2. Installing BOUND does not protect every wallet. A page that bypasses the hook is not covered, and WalletConnect never reaches it.
3. A trusted address is not a safe one. A legitimate contract can be called with hostile arguments, and BOUND does not simulate.
4. A valid certificate and an unchanged URL say nothing about the honesty of the JavaScript served.
5. An ENS name does not prove ownership of a DNS domain. The root record proves only who published the snapshot.
6. Arkiv is a public record, not an authority. Anyone can write to it, and nothing is trusted merely for being there.
7. Swarm hosting is not an availability guarantee. Postage, nodes and gateways all still matter.
8. Anon-RPC does not hide a wallet address from the endpoint being queried, and the chain is public regardless.
9. Revoking an allowance does not cancel a signature already given, and Permit2 allowances are separate from ERC-20 ones.
10. A high behavioural score never authorizes an action the policy does not.
11. Nothing here is audited, and no accuracy figure is measured in production.

---

## 20. Competitive positioning

| Approach | Strength | Gap BOUND addresses | What BOUND still lacks |
|---|---|---|---|
| Wallet transaction simulation | Shows effects and balance deltas | Cannot say whether this counterparty belongs to the site you opened | Broad simulation, adversarial execution semantics |
| Domain blocklists | Fast on known phishing | A same-origin hijack predates any listing | Mature threat-intel feeds |
| Contract reputation lists | Fast known-risk lookup | A trusted contract with hostile parameters is still dangerous | Large proprietary labels |
| Site scanners (server-side) | Broad crawling coverage | The scanner's visit is not the user's session; cloaking defeats it | Crawl scale |
| Hardware-wallet clear signing | Interpretable calldata | Owner metadata is not origin authorization | Signing-path enforcement |
| Revocation dashboards | Useful after the fact | Act only after the bad approval | Comprehensive allowance inventory |
| **BOUND** | Origin-linked, anchored, per-request policy with an open record | Warns the first victim with no blocklist entry | Universal enforcement, simulation, breadth of curation |

This is architectural positioning, not a benchmark. Mature wallets, simulators and scanners already cover substantial parts of this workflow. BOUND's specific claim is the **site-origin-to-counterparty policy, anchored outside the site, evaluated per request, with coverage stated honestly.**

**The one-line answer to "how is this different from a site scanner":** a scanner tells you what *its* visit saw; BOUND checks what *your browser* was served, against that site's own history, and the record is open.

---

## 21. Glossary

| Term | Meaning in BOUND |
|---|---|
| **Counterparty** | Any address extracted from a request, tagged with a role |
| **Rights role** | An address that would gain the ability to move assets later |
| **Destination role** | An address that receives assets in this request |
| **Trusted** | In the snapshot, ENS-attested, a shared contract, or from a trusted deployer lineage — for this site *and chain* |
| **Snapshot** | The full trusted list, one JSON file, hash-anchored in ENS |
| **Root** | The ENSv2 record holding the snapshot hash, epoch and Swarm reference |
| **Epoch** | Monotonic snapshot version; a lower epoch is refused |
| **Cap** | The ceiling an untrusted counterparty imposes, regardless of other signals |
| **Drift** | A change in nameservers, certificate or A record |
| **Corroborated** | Drift that meets the §9.7 bar for counting against a score |
| **Witness** | A participant submitting anonymous observations; never creates trust |
| **Coverage** | Whether a given request was mediated, unsupported or possibly bypassed |

---

## 22. Open decisions

- [x] Trust model: a curated snapshot anchored in ENS, plus witnesses, feeding a confidence score with a cap
- [x] Warn, never block
- [x] Third partner pick: ENS
- [x] EF track: Anon-RPC, not CROPS
- [x] Arkiv track: Build on Arkiv (from scratch)
- [x] Demo sites: fictional dApp plus five real protocols, read-only
- [x] Opaque calls: called contract plus an unverified address scan, no simulation in v1
- [x] Recovery: link to an existing revocation tool rather than building Safe Mode
- [ ] Score weights and the N, M, Z, K values — tune on the seeded sites
- [ ] Chains covered — *default: Ethereum mainnet plus one L2*
- [ ] Watcher hosting — *default: one small always-on server*
- [ ] Curator key custody and publication cadence — *default: one key, weekly plus on demand*
- [ ] The ENSv2 name for the root record, and whether it needs a dedicated resolver — **confirm against the ENSv2 documentation before committing (§18.1)**

---

## 23. Final architecture verdict

**The concept holds only if its claim is scoped honestly, and the scope is now small enough to build.**

BOUND's security value is not another list of bad addresses. It is proving why a *specific counterparty, in a specific role, on a specific chain* does or does not belong to the site and action the user intended — and anchoring the answer somewhere the attacker's control of that site cannot reach.

Four problems decide whether it works, and all four are addressed explicitly rather than assumed away:

1. **Interception is not universal.** Patched at all three entry points, reported per request, demonstrated failing.
2. **Authority cannot come from the site.** It comes from a curator-scoped ENS record over a hash-verified snapshot.
3. **A trusted target can still be abused.** Every address in every role is checked, and Permit2's unbound destination is named as a case decoding cannot reach.
4. **Honesty is the product.** Coverage states, an invariants suite with a deliberate failing row, and a claims-not-made section.

The remaining risk is almost entirely execution: a live DNS and certificate swap, five real protocols staying green, and three partner integrations proven on stage. The prechecks in §18.1 exist to surface any of that on day one rather than on Sunday.

> **Bottom line:** verify the authority chain behind an action, not whether an address appeared in a list; say exactly what was and was not checked; and leave the decision with the user.

---

*End of final architecture document. The decoder and hook referenced as `[VERIFIED]` are implemented in `decoder.js` and `hook.js` with `test.js` and `hook-test.js` covering 113 checks.*

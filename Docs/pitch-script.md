# BOUND — Pitch Script

> **How to use this file**
> - **Part A** is the spoken pitch (about 6–7 minutes). Lines in plain text are what you say. Lines in `[SHOW: …]` are what is on screen.
> - **Part B** is the deep dive. Use it for the technical judge round, or when someone asks "how exactly does that work?"
> - **Part C** is the edge-case list, **Part D** is the problems we hit while building, **Part E** is what we do *not* claim, **Part F** is Q&A prep and a numbers cheat sheet.
> - Every number here comes from the code or the evidence logs in this repo (`client/extension/*`, `packages/*`, `services/*`, `shared/contracts/feasibility.md`, `Docs/phase-0-evidence-log.md`). The outside incidents in A2 are from public reports. **Check those dollar figures once more before going on stage.**

---

# PART A — THE SPOKEN PITCH

## A1. The hook (30 seconds)

`[SHOW: a clock reading 14:53:57 UTC, then ticking to 14:54]`

On the 14th of April 2026, at 14:54 UTC, someone took over the domain of CoW Swap — `cow.fi` — through its registrar.

The website address was still right. The padlock was still green. The smart contracts were still audited and safe.

But the JavaScript on the page was now the attacker's.

For about three hours, people who typed the correct URL and clicked "Swap" were asked to sign approvals to the attacker. Around **$1.2 million** was taken. One trader alone lost **219 ETH**.

The team's first public warning came at **15:41**. That is **47 minutes** after the attack started.

Here is the painful part: **every signal needed to warn the very first victim already existed at 14:54.** The nameservers had changed. The certificate had changed. And the page was asking the wallet to give spending rights to an address that `cow.fi` had never used before.

Nobody was checking those things at the moment of signing. BOUND does.

## A2. The problem in plain words (60 seconds)

`[SHOW: browser bar — correct URL, padlock — with the word "LIES" stamped over the page]`

Most people think phishing means a fake website with a weird URL. That is not this attack.

In this attack the website is the **real** website. The attacker controls what the real domain sends to your browser. They can do it in many ways:

- take over the **registrar** or **DNS provider** account,
- steal **CDN or deploy keys**,
- poison a **third-party script** the site loads.

Once that happens, every safety signal you were taught to trust is useless:

- **The URL is correct** — because it *is* the real domain.
- **The padlock is green** — HTTPS only proves you are talking to that domain. It says nothing about whether the code it sends is honest.
- **The contracts are audited** — but the page just asks you to approve someone *else's* contract.
- **Your wallet shows what you are signing** — but it cannot tell you whether this site *normally* asks for this. A wallet has no memory of what `cow.fi` usually does.
- **Blocklists** only list an attacker *after* people lose money. Victim number one is never protected by a blocklist.
- **Site scanners** visit the site from their own server. A smart attacker shows the scanner a clean page and shows the drainer only to a real browser with a wallet. We built exactly that trick into our demo server to prove it.

This keeps happening:

`[SHOW: timeline of incidents]`

| When | Who | How | Loss (approx.) |
|---|---|---|---|
| Dec 2021 | BadgerDAO | Stolen Cloudflare API key → script injected into the real site → users signed approvals | ~$120M |
| Aug 2022 | Curve Finance | DNS hijack at the registrar → cloned page asked for approvals | ~$570K |
| Sep 2023 | Balancer | DNS hijack through registrar social engineering | ~$238K |
| Dec 2023 | Ledger Connect Kit | Poisoned npm library loaded by many dApps → wallet drainer | ~$600K |
| Jul 2024 | Squarespace domains (Compound, Celer and others) | Registrar-level DNS hijacks | multiple sites |
| Oct 2024 | Galxe | DNS hijack through registrar social engineering | ~$270K |
| Apr 2026 | CoW Swap (`cow.fi`) | Registrar takeover, ~3 hours | ~$1.2M |

The same pattern every time: **a real domain, real contracts, a lying frontend.**

## A3. What BOUND is (30 seconds)

`[SHOW: BOUND logo + "Know where your signature is going — before you sign."]`

BOUND is a browser extension that sits between the website and your wallet.

Before any wallet request reaches your wallet, BOUND stops it for a moment and asks **two questions**:

1. **Is this site behaving differently than it normally does?**
   We look at its nameservers, its TLS certificate, which hosting network it is served from, and the actual JavaScript files it sent you.

2. **Is this exact wallet action allowed for this site?**
   We pull every address out of the request — the spender, the receiver, the contract being called — and check each one against a list of addresses this site is known to use. That list is signed in a way that the attacker cannot change, even if they own the website's DNS.

And there is one rule that holds the whole thing together:

> **Good behaviour can never approve an action. It can only make a warning louder.**

A site can look perfectly normal, but if it asks you to give spending rights to an address it has never used, BOUND warns you. That is the one thing a hijacked frontend cannot avoid doing — because stealing your money *requires* sending it somewhere new.

## A4. How it replays the CoW Swap attack (60 seconds)

`[SHOW: same hijack, now with BOUND installed]`

Let's replay 14:54 with BOUND installed.

1. **Before you even connect your wallet.** Our watcher server checks every listed site's DNS and TLS. It sees the nameservers change. A nameserver change alone is strong enough to count. It writes a public "drift" record. Your browser reads that record when you open the site and shows a Chrome notification: *"BOUND: infrastructure change — check the site before connecting your wallet."* This is the **only** protection that also helps against seed-phrase phishing pages, because those never send a wallet request at all.

2. **You click Connect anyway.** BOUND scores the connection. Drift or an active incident always sends you to the loudest screen — the **firewall** page.

3. **You click Swap.** The page asks for `approve(attacker, unlimited)`. BOUND decodes it. The token is fine, but the **spender** — the address that gets rights over your money — is not in the trusted list for `cow.fi` on this chain.
   - An untrusted spender on a listed site is capped at **35 out of 100**. That is red.
   - With corroborated infrastructure drift on top, the cap drops to **15**. That is **escalated**.

4. **The warning window opens.** It is owned by the extension, not drawn inside the web page, so the attacker's page cannot fake it or click it. It names the site, the spender, the token, and links to **Revoke.cash** for your chain. To continue you must type **`I UNDERSTAND`**.

5. **You press Cancel.** The page gets error code **4001** — the same code a wallet returns when *you* say no. **The wallet never even sees the request.**

And here is the important part: **it does not matter if the attacker deployed and verified the drainer contract weeks before. It does not matter if they faked 500 "users" saying it is fine.** Age, verified source code and crowd votes can never lift the cap. Only the trusted list can.

## A5. Where the trust comes from (45 seconds)

`[SHOW: Curator → snapshot → Arkiv → digest in ENSv2 → extension verifies]`

The obvious question is: "who decides which addresses are trusted?" The site can't — the site is the thing that gets hacked.

So the trust comes from **outside** the site:

- A **curator** collects each protocol's real addresses from its own docs and verified deployments. We checked every seeded contract's live bytecode on Sepolia — **11 out of 11 matched**.
- The curator compiles one **snapshot** file, written in canonical JSON (RFC 8785), and hashes it with **keccak256**.
- The snapshot bytes are stored on **Arkiv** as a `trust_snapshot` record.
- The **hash, the version number (epoch), and a pointer** to that Arkiv record go into an **ENSv2** text record called `bound.root.v2` on our name **`bound-v2.eth`** on Sepolia.
- Only the curator key can write that one record. ENSv2's Enhanced Access Control lets us give `ROLE_SET_TEXT` for just that one key.
- Your extension reads the ENS record, downloads the snapshot, **re-computes the hash itself**, and throws it away if it doesn't match. It also refuses any older epoch, so nobody can replay an old list.

Owning a website's DNS gives you **zero** power over any of this.

## A6. The open record (30 seconds)

`[SHOW: live Arkiv query result]`

Everything BOUND learns — infrastructure drift, incidents, each site's normal behaviour, which JavaScript files a site normally serves — is published as **public, expiring records on Arkiv**.

Anyone can query them. Anyone can recompute what BOUND concluded. This is not "trust our server." It is an open record.

And because Arkiv can be written by anyone, BOUND **only reads records from our watcher's own address**, and re-checks the owner of every record that comes back. A fake record from someone else is simply ignored.

## A7. Privacy (30 seconds)

`[SHOW: "What never leaves your browser"]`

A security tool should not become a tracking tool.

- **Monitoring is opt-in.** Until you press *Start monitoring*, BOUND injects nothing into any page and sends nothing anywhere.
- Your **wallet address, amounts, transaction hashes, and browsing history never leave your browser.**
- The anonymous reports we do send ("this site used this contract") are **encrypted with HPKE** to our aggregator's key, **padded** so their size gives little away, and sent after a **random delay**.
- When BOUND checks things on-chain, it uses **Anon-RPC** with the **Nox** worker — a **Sphinx mixnet** — so no RPC provider learns *your wallet + the site you are on + the address you are about to approve* all together.
- Instead of asking Arkiv about each site you visit (which would leak your history), BOUND downloads **one bundle for all listed sites** and looks things up locally.

## A8. Honesty slide (20 seconds)

`[SHOW: "What BOUND does not claim"]`

We want to be clear about our limits:

- BOUND **warns, it never blocks.** You always decide.
- A page that grabbed the wallet object *before* BOUND loaded, a wallet that locks its provider object, or a WalletConnect session can go around us. When we detect that, we mark the request **"bypass possible"** and we **never show a green badge** for it.
- A trusted address is not automatically a *safe* address. We do not simulate transactions yet.
- This is not audited.

We would rather tell you exactly what we check than pretend we check everything.

## A9. Close (20 seconds)

`[SHOW: the timeline — 14:54 hijack, 15:41 first warning, $1.2M, 3 hours]`

At 14:54 the signals were there. At 15:41 the first warning went out. In between, people lost money signing things their wallet could not explain.

BOUND checks the authority behind every action — **not** whether an address is on a blocklist. It anchors that authority somewhere the attacker cannot reach. It tells you exactly what it did and did not check. And it leaves the final choice with you.

**Know where your signature is going — before you sign.** Thank you.

---

# PART B — THE DEEP DIVE (technical round)

## B1. The parts of the system

| Part | Where it runs | What it does | What it is trusted for |
|---|---|---|---|
| **Hook** (`hook.js`) | Inside the web page (MAIN world), at `document_start`, all frames | Wraps the wallet's `request`, `send`, `sendAsync`; freezes the request; hands it to the extension | Nothing. It holds no secrets and assumes the page is hostile |
| **Relay** (`relay.js`) | Content script (ISOLATED world) | Carries messages between page and extension over a private random channel | Nothing on its own |
| **Frontend collector** | Content script (ISOLATED world) | Hashes the page's same-origin JavaScript files | Evidence only |
| **Service worker** (`sw.js`) | Extension background | Verifies the snapshot, reads Arkiv, scores requests, opens the warning window | The verdict |
| **Warning window** | Extension-owned popup window | Shows the verdict; Cancel → `4001` | Cannot be drawn or clicked by the page |
| **Curator** | CLI run by a person (`server/curator`) | Compiles the snapshot, writes it to Arkiv, publishes the ENS root | Creating trust |
| **Watcher / aggregator** | Docker container (hosted on Render) | Polls DNS/TLS, receives encrypted reports, writes drift/incident/status/baseline/frontend to Arkiv | Signals, never trust |
| **Arkiv** (Rabdi testnet, chain `7794095`) | Decentralized data layer | Public, expiring, queryable records | Nothing by default — every read filters by writer |
| **ENSv2** (Sepolia, chain `11155111`) | Ethereum | Holds the snapshot root under a curator-only role | The root of trust |
| **Anon-RPC** (`nox` worker) | Sandboxed iframe inside the extension | Anonymous chain reads over a Sphinx mixnet | Chain data, not identity |
| **Swarm** | Decentralized storage | Hosts the **safe page** (a recovery page that works even if the real site is hijacked). Older v1 roots also stored the snapshot here | Nothing — content-addressed |
| **Financial registry** (`ens-registry.mjs`) | Extension, read at request time | Compares same-path script hashes against a separate, scraper-seeded ENS record for 50 real DeFi frontends (B12) | Evidence only — never moves the score |

## B2. The extension, step by step

**Opt-in.** Page scripts are registered with `chrome.scripting.registerContentScripts` only when you press *Start monitoring*, and unregistered when you stop. When you stop, any report not yet sent is **deleted, never sent later**, and any open warning hands its request to the wallet instead of dropping it.

**The hook hardens itself first.** The very first thing `hook.js` does is save its own copies of `Promise`, `JSON.stringify`, `Object.freeze`, `WeakMap`, `crypto.subtle.digest`, `setTimeout`, and more. A hostile page that later overwrites `Promise.prototype.then` or `JSON.stringify` cannot change how BOUND behaves.

**Finding the wallet.** BOUND patches:
- `window.ethereum` (checked at start, on `ethereum#initialized`, and again at 1 s and 2.5 s),
- every wallet that announces itself through **EIP-6963** (`eip6963:announceProvider`),
- **MetaMask's Multichain API (CAIP-25)** — some dApps like `app.uniswap.org` never touch `window.ethereum`; they talk to MetaMask over `window.postMessage` or a `chrome.runtime.connect` port (`caip-348`). BOUND wraps both and sends `wallet_createSession` and `wallet_invokeMethod` through the same gate.

It patches **in place** (it does not wrap the wallet in a Proxy), so `on`, `removeListener` and wallet flags keep working. If no wallet is instrumented within **2 seconds**, it reports `bypass_possible`.

**Freezing the request.** Every request is deep-copied into a frozen plain object. The copy **refuses**: getters/setters (accessors), Symbol keys, objects with a non-plain prototype, circular references, nesting deeper than **32**, non-finite numbers, and anything bigger than **256 KiB**. The frozen copy is the one that gets scored and the one that gets sent to the wallet — **the bytes checked are the bytes signed.**

**Tamper check across the boundary.** The hook computes a **SHA-256 digest** of the request and of the wallet state (chain + accounts). The service worker recomputes both. If either does not match, the request is cancelled.

**Private channel.** The relay creates a random UUID and sends it to the hook with a `BOUND_INIT_V1` event, stopping the event from reaching anyone else. Every later message must carry that channel ID and exact field sets.

**Wallet state is read fresh.** Before each request the hook reads `eth_chainId` and `eth_accounts` (5-second limit). It listens to `chainChanged`, `accountsChanged` and `disconnect`. Any of them bumps a revision number; a decision taken against an old revision is void.

**Which methods get checked.**
- A long **allowlist of read-only methods** (`eth_call`, `eth_getBalance`, `eth_getLogs`, `wallet_switchEthereumChain`, `eth_sendRawTransaction`, etc.) passes straight through and does not use up the rate limit — real dApps poll these constantly.
- **Connection methods** (`eth_requestAccounts`, `wallet_requestPermissions`, `wallet_createSession`) always get a BOUND review.
- **Value-moving methods** are decoded (list in B3).
- **Anything else** is marked **unsupported** and can never be green. We use an allowlist, not a blocklist, so the next new signing method nobody thought of does not slip through with a green icon.

## B3. The decoder — turning a request into addresses with roles

Every value-moving request becomes a list of addresses, each tagged with a **role**:

| Role | Meaning | Examples |
|---|---|---|
| `rights` | Will be able to move your assets later | `approve` spender, `setApprovalForAll` operator, EIP-2612/Permit2 spender, EIP-7702 delegate |
| `destination` | Where assets go now | `transfer` recipient, router recipient, Seaport consideration recipient |
| `called` | The contract being called | the transaction `to` |
| `token` | The asset involved | the token contract |

This is what makes BOUND **protocol-agnostic**: no per-protocol ABI tables.

**Known calldata selectors:**

| Selector | Function | What BOUND extracts |
|---|---|---|
| `0x095ea7b3` | `approve(address,uint256)` | token = `to`, **spender = first argument** (rights) |
| `0x39509351` | `increaseAllowance(address,uint256)` | same as approve |
| `0xa22cb465` | `setApprovalForAll(address,bool)` | operator (rights); bool must be 0 or 1 |
| `0xa9059cbb` | `transfer(address,uint256)` | recipient (destination) |
| `0x23b872dd` | `transferFrom(address,address,uint256)` | recipient (destination) |
| `0x42842e0e` / `0xb88d4fde` | `safeTransferFrom` (with and without `bytes`) | recipient; dynamic `bytes` offset and padding checked |
| `0x87517c45` | `Permit2.approve(token, spender, uint160, uint48)` | token + spender; amount must fit 160 bits, expiration 48 bits |

> **Security rule we learned the hard way:** in `approve`, the `to` is the **token**. The dangerous address is the **spender in the calldata**. A checker that only looks at `to` misses the entire attack.

**Signed typed data (`eth_signTypedData`, v3, v4):**
- `Permit` (EIP-2612) and DAI-style `Permit` → spender is rights. Field names *and* types must match exactly.
- `PermitSingle` / `PermitBatch` (Permit2) → spender is rights, each token recorded.
- Seaport `OrderComponents` → every consideration recipient is a destination; zone and tokens recorded.
- **Permit2 signature transfers** (`PermitTransferFrom`, `PermitWitnessTransferFrom`) → the recipient is **not in the signed message**; it is chosen later when the transfer runs. BOUND extracts the spender, labels it **"Destination not fixed by signature"**, and caps it at 65 — it is never counted as fully understood.
- Anything unrecognized → BOUND scans for anything that looks like an address, marks them **unverified**, caps at 65.

**Other methods:**
- `eth_sign` → blind hash signature → score **0**, escalated, always.
- `personal_sign` → no counterparty → capped at 65.
- `wallet_signAuthorization` / `eth_signAuthorization` and `authorizationList` inside a transaction (**EIP-7702**) → the delegate is rights. **`chainId == 0`** means the delegation works on every chain → cap **0**.
- `wallet_sendCalls` (**EIP-5792** batches, up to 64 calls) → **every call** is decoded. One broken call makes the whole batch malformed; one undecodable call makes it opaque. No partial pass.

**Unknown calldata.** BOUND records the called contract and scans each 32-byte word. A word counts as an address only if the top 12 bytes are zero and the value is at least 2⁶⁴ (so normal numbers like amounts are not mistaken for addresses). These hits are marked **unverified** and can only **lower** a score, never raise it.

**Panic safety.** Truncated arguments, bad padding, wrong word counts, non-hex data, `data` and `input` disagreeing, values that are not exact integer strings, and any thrown error all become **"malformed" (cap 35)** — never a pass. All 256-bit numbers use `BigInt`, never `Number`.

## B4. Scoring

### Who counts as trusted

An address is trusted **for this site and this chain** only if one of these is true:
1. It is in the **hash-verified snapshot** for this site and chain.
2. It is **attested by the protocol itself** in its own ENSv2 name (`bound.attest.v1` record), read live through Anon-RPC.
3. It is on the **shared-contract list** (for example Permit2, WETH, Multicall3) — trusted on every site.
4. It was **deployed by a deployer** that already deployed one of this site's trusted contracts (deployer lineage). This one is softer: it gives amber, not green.

Trust is also **per role**: a snapshot "trusted counterparty" can be a rights holder or a destination; a "trusted contract" can be called or be a token. The same address on another chain starts untrusted.

### The cap rule (the core of the product)

The score starts at 100. Every address that is not trusted pulls it down to a ceiling:

| Situation | Score ceiling |
|---|---|
| Untrusted **rights** address on a **listed** site | **35** (red) |
| … with corroborated infrastructure drift | **15** (escalated) |
| Untrusted **destination** (not one of your own accounts) on a listed site | **65** (amber, address named) |
| Untrusted called contract / token on a listed site | **65** |
| Unlisted site, address seen by enough independent reporters | **65** |
| Unlisted site, not seen | **35** (15 with drift) |
| Deployer lineage match | **65** |
| Unverified scanned address, unknown typed data, Permit2 signature transfer, `personal_sign` | **65** |
| Malformed request | **35** |
| `eth_sign`, EIP-7702 with `chainId 0` | **0** |

Sending to **your own account** is never counted as untrusted.

**Why age, verified source and crowd votes never lift the cap:** an attacker who plans ahead deploys and verifies the drainer contract weeks early, and fake wallets are cheap. If any of those could lift the cap, a careful attacker would land on amber and the drain would go through almost silently.

### Verdicts

| Score | Verdict | Window tier | What the user sees |
|---|---|---|---|
| 70–100 | Green | pass | Quiet review |
| 40–69 | Amber | warning | Warning, addresses named |
| 16–39 | Red | huge | Big warning, Continue or Cancel |
| 0–15 | Escalated | firewall | Full firewall page; Continue needs typing `I UNDERSTAND` |
| no data | Grey | warning | "Not checked" with the exact reason |

These thresholds are build-time settings (`BOUND_TX_GREEN_THRESHOLD` etc.), validated so that `red < amber < green`.

**A green verdict is downgraded to grey if the request was not fully mediated** — "a wallet path may bypass BOUND." Green only ever means "we really checked this."

**Grey always explains itself**, for example: *"Not checked: no watcher baseline is published for this site and chain"* or *"the verified trust snapshot could not be read (ENS or Arkiv unreachable)."* Grey never looks like safe.

### Connection score (before the wallet connects)

Six checks, weights add up to exactly **100**:

| Check | Weight |
|---|---|
| HTTPS or local demo origin | 10 |
| Verified, current ENS/Arkiv snapshot | 25 |
| Exact domain and port is in the snapshot | 20 |
| Arkiv watcher lookup returned valid data | 10 |
| Current "normal" watcher status | 25 |
| Wallet chain/account state readable | 10 |

A passed check adds its weight, a failed check subtracts it, an unavailable check adds 0. A score of **80 or more** with no blockers is a quiet pass. **Active incident or drift always goes to the firewall tier**, whatever the arithmetic says. If the request comes from an iframe, both the top page and the frame are scored and the **lower** score wins.

## B5. Frontend integrity — "is this the JavaScript this site normally serves?"

- When you make a wallet request, the collector looks at every `<script src>` on the page.
- It only hashes **same-origin** scripts with **no query string**, and skips paths that contain a 40-hex address (those could identify a user).
- It reads them **from the browser's cache only** (`cache: 'only-if-cached'`, `credentials: 'omit'`, `redirect: 'error'`) — so it never makes a new network request and never sends cookies.
- Limits: up to **32 scripts**, **4 parallel workers**, **750 ms** per script, **1.1 s** total, **2 MiB** per script.
- Hash format: `sha256-<base64>` (the same format as Subresource Integrity).
- It records an exact coverage breakdown: how many were compared, inline, had a query, cross-origin, private-path, unavailable, or over the cap — and the numbers must add up exactly, or the evidence is thrown away.

The watcher publishes a **frontend record** per site on Arkiv. A script hash only becomes "established" after **3 different reporter keys** have seen it, it has been around for at least **1 hour**, and it was seen within the last **48 hours**.

If your page's script hash **conflicts** with the established one, the warning is raised to at least the **"huge"** tier.

If there is a conflict **and** independent corroboration (drift, an active incident, or a risky counterparty) **and** it is the top frame **and** same-origin **and** the request's numeric BOUND score is below the red threshold (`BOUND_TX_RED_THRESHOLD`, default **16**) — an unknown score never qualifies — BOUND cancels the request and **redirects you to the safe page** — a recovery page hosted on **Swarm** (`bzz.limo/bzz/2ef102c2…682c/`) that reads Arkiv on its own and shows the evidence. A changed script **alone** only warns — because normal deploys change scripts too.

To override, you need a private confirmation page and a typed `I UNDERSTAND`. The override is a one-time ticket bound to that tab, that document, that origin, that chain and the current settings version.

**Optional deep capture.** From the popup, you can turn on network capture. It uses the Chrome DevTools Protocol (`chrome.debugger`, version 1.3) to hash the **actual bytes Chrome received** for the document and its scripts — not a second download. It keeps only safe headers (content-type, CSP, etc.), never query strings, cookies, auth headers, or request bodies. Limits: 200 rows, 2 MiB per body.

## B6. The trust chain in detail

**Publishing (curator CLI):**
1. Compile the snapshot: strict JSON → **RFC 8785 canonical form** → **keccak256** digest. Two clean compiles produce byte-identical output.
2. Write one Arkiv `trust_snapshot` entity holding the canonical bytes, digest, network and epoch. The publisher refuses snapshots over **61,440 bytes** (Arkiv payload limit, with escaping). Lifetime: **7,884,000 blocks** (~6 months at ~2 s blocks).
3. Write `bound.root.v2` on `bound-v2.eth` with `{digest, epoch, arkivKey, arkivOwner, network, schemaVersion}`. The curator CLI waits for the transaction receipt before reporting success.
4. The resolver is a **dedicated ENSv2 PermissionedResolver proxy** (`0xf6efa18d…0ea0f`). The curator holds `ROLE_SET_TEXT` scoped to the resource `keccak256("bound.root.v2")` — nothing else. Protocols that self-attest get a separate role scoped to `bound.attest.v1`. We tested live that an unauthorized key's write **reverts**.

**Verifying (extension, every 5 minutes):**
1. Read the root through **UniversalResolverV2** over Anon-RPC; check the chain really is Sepolia.
2. Fetch the Arkiv entity; check its key, owner, kind, digest, epoch and network all match the root.
3. Recompute keccak256 over the exact bytes received. Reject on mismatch.
4. Reject if: epoch is lower than the one we hold (**rollback**), same epoch but different content (**equivocation**), wrong network, wrong root name, `generatedAt` is in the future, or the snapshot has expired.
5. Cache it — and **re-verify the cached copy every time it is read**, so a tampered local cache is also caught.
6. If the live read fails but the cached snapshot is still valid, use it and log why. If nothing valid is left, everything goes grey. **A stale snapshot never blocks anything.**

**Legacy v1 path (Swarm):** older roots (`bound.root.v1`) point to a Swarm reference. In that mode BOUND requires **two Swarm gateways with different origins** to return byte-identical content before it will even hash it.

**ENS lookup cache (three levels):**
- **L1** — values *this extension* read live from ENS, in memory + `chrome.storage.session`; 1-hour TTL, 5-minute TTL for "no record" answers.
- **L2** — the watcher's copy on Arkiv (`ens_record`). Labelled **`arkiv_unconfirmed`** and **can never grant trust or move a score.**
- **L3** — live ENS over Anon-RPC. The source of truth; always wins.

## B7. The watcher and aggregator

**Drift detection** (`server/watcher/drift.js`):
- **Nameservers** — read through **DNS-over-HTTPS** from the parent zone. A change **counts on its own**.
- **TLS certificate** — read by a **direct TLS connection** (no Certificate Transparency lag). A change counts only if the **issuer** or the **set of names** changes. A normal renewal with only a new fingerprint does **not** count.
- **A records** — a change counts only if the IPs move to a **different hosting network (ASN)**. ASN comes from **Team Cymru's DNS service** (`<reversed-ip>.origin.asn.cymru.com`). If the lookup fails or returns more than one ASN, it **cannot** corroborate.

Why so strict? Certificates renew every few weeks and IPs move every time a site redeploys behind a CDN. If every one of those raised an alarm, users would learn to ignore BOUND, and a warning people ignore protects nobody.

**Incidents** are declared on either trigger:
- **A:** corroborated drift **plus** at least one warned report (the registrar-takeover path), or
- **B:** **K = 3** independent warned reports naming the same counterparty, with no drift at all (the poisoned-script path — which leaves no DNS trace).

One warning alone declares nothing — that stops a competitor from griefing a healthy site into a red banner.

**Recovery** needs a fresh normal infrastructure poll **and** an explicit operator approval entry (per site, per incident ID, with an expiry). No approval file = no recovery. It fails closed.

**Encrypted reports.** The extension seals every report batch with **HPKE (RFC 9180, base mode): DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM**, using the `@hpke/core` library. The aggregator's public key is **pinned at build time** and shown only as its key ID. Plaintext is **padded to a multiple of 1 KiB**. The key ID and protocol name are bound in the AAD. The aggregator **rejects plaintext batches** with HTTP 400. This encryption key is separate from the Arkiv signing key.

**Aggregator behaviour:**
- `POST /v1/observations` returns **202 only after the reports are written to Arkiv**. Otherwise **503 retry** and the extension retries; duplicates are dropped by operation ID.
- More than **30 batches per address in 10 minutes → 429**.
- **Stateless container.** On start it **rebuilds its state from Arkiv** (live observations with their original block times, current baseline/status entities), then waits for any transaction its predecessor left in flight. A replacement container is an exact copy.
- **One aggregator per writer key** — two would collide on transaction nonces. On Render (which keeps the old instance alive during deploys) we set `BOUND_STARTUP_WRITE_DELAY_MS=60000`.
- Multi-arch Docker image (`linux/amd64`, `linux/arm64`), `/healthz` health check.
- Timestamps are **rounded to the hour** for privacy.

**Arkiv record lifetimes** (Rabdi, ~2 s per block):

| Kind | Lifetime | Approx. |
|---|---|---|
| observation | 345,600 blocks | 8 days |
| baseline, drift, incident, status, frontend | 43,200 blocks | 24 hours, republished hourly |
| trust_snapshot | 7,884,000 blocks | ~6 months |

Storage stays roughly flat instead of growing forever.

## B8. Reading Arkiv safely

- Query: `$owner = addr(<watcher>) AND arkiv.schema = str('bound.record.v1') AND <kind filter> ORDER BY $key ASC`.
- Pages of **32**, at most **256 pages**, response capped at 1 MB.
- If the block number **changes between pages**, the result might be a mix of two moments, so BOUND restarts once and then refuses.
- If the block number goes **backwards** compared to what we saw before, it refuses (stops a stale or lying RPC from rolling us back).
- Every row's owner is **re-checked** after the query. Expired rows are dropped.
- The bundle is cached **5 minutes**; for an actual decision it must have been verified in the last **30 seconds**.

## B9. Anon-RPC

- Worker: **`nox`**, a **Sphinx mixnet** worker, specifier contract `0x35133267…e1b7A9A` on Sepolia — copied from the upstream `adopters.json5`, not made up. We confirmed live that it is deployed bytecode.
- We **refuse** the `passthrough` reference worker for any privacy claim — it is a plain `fetch`.
- The worker runs in a **sandboxed iframe** (manifest `sandbox` pages) inside an **offscreen document**.
- Only an allowlist of read methods is permitted: Ethereum reads (`eth_call`, `eth_getCode`, `eth_getStorageAt`, …) and Arkiv reads (`arkiv_query`, `arkiv_getEntity`, …). Requests over 256 KiB are refused. Only extension pages can call it — never a web page.
- **Budget:** signing-time chain facts get **1.5 seconds**. If the budget runs out, the request is scored **without** them — so an untrusted address **stays capped**. It never falls back to a public RPC and never treats "didn't check in time" as "trusted".
- The popup **diagnostic** checks that the anonymous route really reaches Sepolia (`0xaa36a7`) and Arkiv Rabdi (`0x76edaf`).

## B10. Observations (how the baseline grows) and why they can't be poisoned

- An observation is sent **only** when: the verdict was green or amber, the site's status is **normal**, and **you pressed Continue** and the wallet actually received the request (the hook sends back a one-time receipt token).
- **Never** recorded: anything during an active incident, anything you reached by overriding a red warning, anything you cancelled.
- Before sending, BOUND removes your accounts and every address found in `from`, `owner`, `holder`, `offerer` fields.
- It reports a (site, address) pair at most **once a week**.
- Reports are not a trust source. Reporter keys are **rotating pseudonyms** — they count distinct keys, not distinct people.

## B11. Incident and warning history (new — "Show more" on the warning page)

- Each **address-warning report** now also carries the reporting client's numeric **score (0–100)** and an **hour-rounded UTC timestamp**. The watcher rejects a report whose timestamp is in the future, and deduplicates reports per site/counterparty/reporter within the same hour.
- The warning window's "Show more" section does an **owner-wide, anonymous Arkiv query** (over Anon-RPC) for the current host + wallet chain, filtered locally, and shows up to **5 unexpired incidents** and **5 scored warnings**.
- This is read-only history, not a verdict: a score shown here is **not a probability**, and **missing history is not proof of safety** — the UI says so explicitly. It cannot raise or lower the live score.
- Older watcher deployments reject the new scored-report shape, so the watcher and the extension must be upgraded together.
- CLI equivalent for anyone checking the claim themselves: `node --env-file=.env scripts/watcher/incident-history.mjs <site> <chainId>`.

## B12. ENS financial-site registry comparison (new — observational, not a trust signal)

- Separate from the trust snapshot. For each real top-level HTTPS wallet request, BOUND derives a deterministic subname `site-<sha256(hostname)-prefix>.bound-v2.eth`, reads its `url` and `com.bound.frontend-observation.v1` text records through the **same pinned resolver and Anon-RPC path** as the trust snapshot, and compares same-path script hashes already collected by the frontend collector (B5).
- The registry itself is seeded from **50 real financial/DeFi frontends** (Aave, Uniswap, Lido, Curve, Coinbase, etc.) — hashes collected by an independent public-HTTPS scraper (`scripts/registry/financial_registry.py`), published to real Sepolia ENS subnames with real transaction hashes (see `fixtures/financial-registry/ENS-RECORDS.md`). 26 of the 50 candidate sites yielded comparable script hashes; the rest were unavailable or had nothing comparable.
- **This never changes the score or triggers the safe-page redirect.** It is shown as a separate line in the warning window: "✓ matched-subset" (scripts match), "× changed" (same-path hash differs — observational only), or "unavailable" (stale, no record, no overlapping paths). It is explicitly a public, unreviewed, scraper-collected data point — not a curated baseline.
- Why it exists: it is a second, independently-sourced data point a judge or user can verify themselves on a public ENS explorer, on top of (never instead of) the reviewed trust snapshot and the watcher's own reporter-corroborated frontend baseline.

---

# PART C — EDGE CASES BOUND HANDLES

## C1. Attacks on the wallet request itself

| Edge case | What BOUND does |
|---|---|
| Page **changes the request while the warning is open** (score A, sign B) | Request is deep-cloned and frozen at entry; the wallet gets the frozen copy |
| Request field is a **getter** that returns different values each time | Refused outright; passed to the wallet unscored and logged as malformed |
| Request digest altered between page and extension | SHA-256 of request and wallet state re-computed; mismatch → cancel |
| Drainer sent through legacy **`send()`** or **`sendAsync()`** | All three entry points share one gate; callback styles supported |
| dApp uses **MetaMask Multichain / CAIP-25** instead of `window.ethereum` | `postMessage` and `chrome.runtime.connect` port both wrapped |
| Several wallets announced through **EIP-6963** | Each announced provider is patched |
| Page overwrites `Promise`, `JSON.stringify`, `postMessage` after load | Hook saved native copies before the page ran |
| Wallet provider object is **locked** (non-writable) | Cannot patch → reported as `bypass_possible`, never green |
| Page draws a **fake BOUND warning** | Real warning is an extension window; the page DOM can't reach it |
| Message sent to the warning from a wrong window, or replayed | Must come from the exact warning page URL with matching request ID, matching window ID; each decision is single-use |
| Page **navigates** or reloads while a warning is open | Tab revision changes → pending request cancelled |
| Same tab, but a **different document** (bfcache, iframe swap) | `documentId` checked at every step; stale document → cancel |
| User **closes the warning window** | Request cancelled |
| **Chain or account changes** during a warning | Revision bumped → decision void, request re-scored or cancelled |
| Request comes from a **cross-origin iframe** | Both top page and frame origins are scored; warning names the frame |
| **Look-alike subdomains** (`foo.swap.cow.fi`, `cow.fi.evil.example`) | No suffix matching. Exact host + port only |
| Same trusted address used on **another chain** | Trust is per (site, chain) — starts untrusted |
| HTTP site (not HTTPS) | Unsupported origin, except localhost demo |
| Huge or deeply nested request (**JSON depth bomb**) | >32 levels or >256 KiB → refused safely |
| Page spams requests | 8 per frame per 10 s and 128 pending total; extra requests are passed to the wallet (which still asks the user) rather than silently refused |

## C2. Attacks hidden inside the transaction

| Edge case | What BOUND does |
|---|---|
| `approve` on a real token, but **spender is the attacker** | Spender (first argument) is checked, not just `to`. Capped at 35 |
| **Real router**, but the **output address** is changed | Destination role → 65, address named |
| **Unlimited** approval / `setApprovalForAll` | Spender/operator is rights → capped |
| **EIP-2612 permit** or **DAI permit** signature | Spender extracted from typed data |
| **Permit2** `PermitSingle` / `PermitBatch` | Spender + every token extracted |
| **Permit2 signature transfer** (recipient not in signature) | Labelled "destination not fixed", never fully understood |
| **Seaport** order with a hidden consideration recipient | Every recipient is a destination |
| **EIP-7702** delegation to hostile code | Delegate is rights |
| EIP-7702 with **`chainId = 0`** (works on all chains) | Cap 0 — escalated |
| **`eth_sign`** blind signature | Score 0, always escalated |
| **EIP-5792 batch** with one bad call hidden among good ones | Whole batch tainted — no partial pass |
| **Truncated** `approve` (no spender bytes) | Malformed, not green. *(Our prototype originally got this wrong.)* |
| Wrong address padding, wrong word count, bad `bytes` padding | Malformed |
| `data` and `input` both set and different | Malformed |
| Permit2 amount ≥ 2¹⁶⁰ or expiration ≥ 2⁴⁸ | Malformed |
| Typed data with **extra fields** or wrong field types | Treated as opaque, addresses scanned, capped |
| **Unknown contract call** | Called contract checked + address-shaped words scanned, marked unverified |
| Big numbers looking like addresses | Words below 2⁶⁴ ignored |
| A new **wallet method** nobody anticipated (`eth_sendUserOperation`, vendor methods) | Unsupported, never green |
| Sending ETH to yourself | Your own account is never flagged as a destination |

## C3. Attacks on the trust data

| Edge case | What BOUND does |
|---|---|
| **Fake "trusted" record** written to Arkiv by someone else | Seeds never come from Arkiv records; reads filter and re-check owner |
| **Altered snapshot** from a gateway or RPC | keccak256 re-computed locally; mismatch → discarded |
| **Old snapshot replayed** (rollback) | Lower epoch refused |
| Same epoch, **different content** (equivocation) | Refused |
| Snapshot published under a **different ENS name** | Refused (root name is bound into the snapshot) |
| Snapshot dated **in the future** | Refused |
| Snapshot **expired** | Not used; sites fall to grey; popup says stale |
| **Tampered local cache** | Cached snapshot re-verified on every read |
| Swarm gateways serve **different bytes** (v1 path) | Two distinct origins must agree byte-for-byte |
| Arkiv pages from **different blocks** | Restart once, then refuse |
| Arkiv RPC returns an **older block** than before | Refused |
| Watcher's ENS copy differs from live ENS | Live always wins; the cached copy is labelled unconfirmed and the warning says they differ |
| **Unauthorized key** tries to write the ENS root | Reverts (tested live on Sepolia) |
| Curator publishes to the **shared resolver implementation** by mistake | Refused — must be the dedicated proxy |
| **500 fake witnesses** vouch for the drainer | Witnesses never lift the cap. Still 35 |
| Drainer **deployed and verified weeks earlier** | Age and verification never lift the cap. Still 35 |
| Attacker **overrides warnings** to train the baseline | Overrides are never published as evidence |
| Reports sent during an **active incident** | Suppressed |
| Competitor sends a flood of fake warnings to **grief a healthy site** | Needs K=3 independent reports or corroborated drift |
| Warning report **backdated or future-dated** to game history | Watcher rejects any `observedAt` in the future; hour-bucket dedup stops repeat-spam from one reporter |
| Someone writes a **fake registry record** under the financial-registry subname pattern | Resolver and exact host must still match the pinned proxy; a mismatched record is `unavailable`, never trusted, and never touches the score |

## C4. Normal-life events that must NOT cause false alarms

| Event | What BOUND does |
|---|---|
| Certificate renewal (same issuer, same names) | Not corroborated drift |
| IP change within the same CDN/hosting network | Not corroborated drift |
| Site deploys new JavaScript | Script mismatch alone only warns; never redirects without corroboration |
| Protocol ships **Router v2** from its usual deployer | Deployer lineage → amber, not red; green once attested or in the next snapshot |
| Protocol attests its new contract in its own ENS name | Trusted, no warning |
| Approving **Permit2 / WETH / Multicall3** on any site | Shared-contract list → trusted |
| dApp polling `eth_chainId`, `eth_call` constantly | Read-only methods skip review and the rate limit |

## C5. Failures and outages — BOUND gets quieter, never falsely green

| What is down | What BOUND does |
|---|---|
| ENS / Arkiv snapshot read | Uses cached snapshot while valid; otherwise grey with a reason |
| Arkiv at page load | Last cached bundle; with none, grey ("offline baseline") |
| Anon-RPC slow | 1.5 s budget, then scored without those facts — untrusted stays capped |
| Anon-RPC down | Never falls back to a public RPC |
| Aggregator down | Reports queued locally, retried with exponential backoff (max 1 hour) |
| Aggregator restarts | Rebuilds itself from Arkiv |
| MV3 service worker suspended | State kept in `chrome.storage.session`/`local`; rebuilt on wake |
| Warning cannot be opened | Request handed to the wallet (which still asks the user) — unless it needed typed confirmation, then it is cancelled |
| Nobody answers the warning for 10 minutes | Handed to the wallet; escalated requests are cancelled instead |
| Wallet state unreadable ("locked") | Marked unsupported with an explanation; never fake-scored |
| Notifications disabled | Badge and popup still show status |
| User stops monitoring | Unsent reports deleted, open warnings handed to the wallet, capture detached |

---

# PART D — PROBLEMS WE FACED WHILE BUILDING

Use these when a judge asks "what was hard?" They show we hit real walls and fixed them honestly.

1. **Our first decoder scored a broken `approve` as green.** If the spender bytes were cut off, there was "nothing to compare", so it looked clean. We changed the rule: a known selector with missing arguments is **malformed**, never clean.

2. **`app.uniswap.org` never used `window.ethereum`.** It talks to MetaMask through the Multichain API (CAIP-25) over `postMessage` and `chrome.runtime` ports. Our hook saw nothing. We had to wrap both transports.

3. **Some wallets lock their provider object.** In a wallet audit we found that an immutable provider simply cannot be patched from the page, and a partially patched provider could get wrapped twice. We made patching idempotent and report these cases as `bypass_possible` instead of pretending.

4. **Normal dApp traffic used up our rate limit.** Polling `eth_chainId` and friends burned the 8-per-10-seconds quota, so real connection attempts got cancelled. We moved read-only methods out of the rate limit.

5. **We were blocking, and that broke our own principle.** Early on, a connection score below 80 was silently cancelled, timeouts were only 45–50 seconds (too short to read the evidence), and a locked wallet forced a cancel. We rewrote it around **"warn, never block"**: tiered warnings, a full firewall page, a 10-minute window, and the user always decides.

6. **ENSv2 documentation was out of date.** The old docs described a pre-audit contract layout. Our first role bitmap was wrong. We verified against the live Sepolia bytecode (selector `0x33cc44a0` for `initialize((address,uint256)[],bytes[])`) and rewrote the roles. We also learned that roles are scoped by **record key**, not by name — so we use a **dedicated resolver** just for BOUND.

7. **We accidentally targeted the shared resolver implementation** instead of our own proxy. The publisher now refuses that.

8. **Publishers and readers disagreed.** The curator could publish things the extension would later reject. We made the publishers refuse anything a reader would refuse, and made them wait for transaction receipts before saying "done".

9. **A seed file had an empty ENS address and placeholder code hashes.** We replaced every placeholder with live Sepolia bytecode keccak256 and verified all 11 contracts.

10. **A hand-typed constant had a transposed digit.** We caught it with an independent known-answer test (CREATE-address and EIP-1967 slots) before it shipped.

11. **Swarm made us work for it.** Postage batches are a time sink; the upload gateway redirected our new safe page to `/forbidden` until approved; and the two gateways we compared are run by the same operator, so we could prove the *mechanism* but not true *independence*. We moved the trust snapshot to Arkiv (`bound.root.v2`) and kept Swarm for the public safe page.

12. **Arkiv's public RPC ran out of anonymous query budget.** We needed an access key, kept outside the repo.

13. **Arkiv query pages can come from different blocks.** That could give a mixed, inconsistent bundle. Our reader detects it and refuses instead of trusting a half-picture.

14. **A transaction can be broadcast while the client loses the reply.** We journal signed transactions and operation IDs and read back before acknowledging, so a crash never creates a duplicate.

15. **The cold-start chicken-and-egg.** A brand-new site has no baseline → every request is grey → grey requests produce no observations → the baseline never grows. We added declared scopes that publish an empty baseline first.

16. **Hosting.** Render's free plan sleeps (which stops hourly republishing), and zero-downtime deploys briefly ran two aggregators on one key, colliding on nonces. We made the container stateless (rebuild from Arkiv on start) and added a 60-second startup write delay.

17. **MV3 service workers die after ~30 seconds idle.** Anything in memory disappears. All important state lives in `chrome.storage.session` / `local`, and Anon-RPC re-attaches to the still-running offscreen worker.

18. **Network timeouts on Arkiv calls** threw errors in the middle of decisions. Every read now has its own hard timeout and degrades to grey.

---

# PART E — WHAT BOUND DOES NOT CLAIM

Say these out loud if asked. Honesty is part of the product.

1. BOUND **does not block** drainers. It warns on requests it mediates and decodes; you decide.
2. Installing BOUND **does not protect every wallet path.** A page holding the wallet object from before BOUND loaded, a locked provider, or WalletConnect can bypass it. Those are shown as `bypass_possible`, never green. A real fix needs wallet-native integration.
3. **A trusted address is not a safe address.** A legitimate contract can be called with hostile arguments. We do not simulate yet.
4. **An ENS name does not prove who owns a DNS domain.** The root record proves only who published the snapshot.
5. **Arkiv is a public record, not an authority.** Anyone can write; nothing is trusted for just being there.
6. **Anon-RPC hides who is asking, not what is asked.** The endpoint still sees the address being checked (the chain is public anyway). The NetLog proof that no direct connection happens is still pending.
7. **Reporter keys are pseudonyms, not proven people.** There is no Sybil resistance yet (Semaphore group is a stretch goal). That is exactly why reporters can never create trust.
8. **Script hashing covers same-origin external scripts only.** Inline scripts and cross-origin CDN scripts are counted but not compared. The counterparty check still catches what they try to sign.
9. **The curator is a single key today** (rotation rehearsed, not yet performed). M-of-N is future work.
10. **Report delay is 2–10 seconds in this build** for testing; the privacy target is 30 seconds to 30 minutes.
11. **Revoking an approval does not cancel a signature already given**, and Permit2 allowances are separate from ERC-20 ones.
12. **Nothing here is audited**, and we publish no accuracy percentage without the test set it was measured on.
13. **The incident/warning history panel and the ENS financial registry comparison are both read-only evidence, not verdicts.** A clean history is not proof of safety; a "changed" registry hash is not proof of compromise. Neither can move the score or trigger the safe-page redirect.
14. **The financial registry's 50 entries are an unreviewed, scraper-collected convenience sample** — ranked by self-reported TVL, not an endorsement, not a complete top-50, and not proof those are each site's real wallet-connecting frontend.

---

# PART F — Q&A PREP AND CHEAT SHEET

## F1. Likely questions

**"How is this different from a site scanner?"**
A scanner tells you what *its* visit saw. BOUND checks what *your* browser was served, against that site's own history, at the moment you sign. Our demo server shows a clean page to `HeadlessChrome` and the drainer to real browsers — the scanner says "clean", BOUND still catches it.

**"How is this different from transaction simulation (wallet previews)?"**
Simulation shows *what* happens. It cannot say whether *this site* normally sends you to *this address*. They are complementary.

**"Why not just a blocklist?"**
A blocklist needs a victim first. BOUND compares against the site's own history, so victim number one is protected.

**"What if the protocol launches a new contract?"**
If it comes from their usual deployer → amber, not red. If they attest it in their own ENS name → green immediately. Otherwise it enters the next snapshot.

**"Who is the curator? Isn't that centralised?"**
Today, one key, and we say so. The snapshot and its diffs are public, the curator code is open source, and anyone can run their own curator and point the extension at it. M-of-N signatures are the next step.

**"What if your watcher is down?"**
The counterparty check doesn't need the watcher at all — it uses the verified snapshot. You lose fresh drift signals, and the popup shows when data was last updated.

**"What stops someone poisoning Arkiv?"**
Seeds are never read from Arkiv records. Every read filters to our watcher's address and re-checks the owner. The trust snapshot is only accepted if its keccak256 matches the ENS root.

**"Does this slow down my wallet?"**
Decisions are local, from data fetched in advance. Network facts at signing time have a hard 1.5-second budget.

**"Why should I believe your numbers?"**
Run `npm test` in the root suite. The Arkiv query in the README is runnable by anyone.

**"Isn't a 50-site 'financial registry' just a trust list in disguise?"**
No — it never touches the score or the redirect. It's a second, independently-verifiable data point (real Sepolia transactions anyone can look up) sitting next to, not inside, the reviewed trust snapshot. We say this explicitly in the warning UI and in Part E.

## F2. Numbers cheat sheet

| Thing | Value |
|---|---|
| CoW Swap hijack start / first warning | 14:54 UTC / 15:41 UTC (47 min) |
| CoW Swap loss | ~$1.2M over ~3 h; 219 ETH from one trader |
| Automated tests (root `npm test`) | 719 pass, 0 fail |
| Seeded contracts bytecode-verified | 11 / 11 |
| ENS root name / record | `bound-v2.eth` / `bound.root.v2` (Sepolia, 11155111) |
| PermissionedResolver | `0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f` |
| Arkiv network | Rabdi testnet, chain `7794095`, schema `bound.record.v1` |
| Watcher / writer address | `0xe63393558e36df643347326e7e03ad5fb0e6c867` |
| Anon-RPC worker | `nox` (Sphinx mixnet), `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A` |
| Safe page (Swarm) | `bzz.limo/bzz/2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c/` |
| Report encryption | HPKE: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM; 1 KiB padding |
| Snapshot hash | keccak256 over RFC 8785 canonical JSON |
| Connection weights | origin 10, snapshot 25, domain 20, Arkiv 10, watcher 25, wallet 10; pass ≥ 80 |
| Transaction bands | green ≥ 70, amber ≥ 40, red ≥ 16, escalated < 16 |
| Safe-page redirect score gate | numeric score must be `< 16` (`BOUND_TX_RED_THRESHOLD`); unknown score never qualifies |
| Incident/warning history shown | up to 5 incidents + 5 scored warnings, owner-wide Arkiv query, current host + chain only |
| Financial registry (new) | 50 real DeFi frontends seeded; 26/50 yielded comparable script hashes; subname `site-<sha256(host)>.bound-v2.eth` |
| Key caps | untrusted rights 35 (15 with drift); untrusted destination 65; malformed 35; `eth_sign` 0 |
| Signing-time chain budget | 1.5 s |
| Warning lifetime | 10 min (hook hard stop 11 min) |
| Request size / depth limit | 256 KiB / 32 levels |
| Rate limit | 8 requests per frame per 10 s; 128 pending |
| Frontend record maturity | 3 reporter keys, 1 hour, 48 h window |
| Script collection limits | 32 scripts, 4 workers, 750 ms each, 1.1 s total, 2 MiB each |
| Arkiv lifetimes | observation 8 days; signals 24 h; trust snapshot ~6 months |
| Aggregator rate limit | 30 batches per address per 10 min |
| Snapshot size limit | 61,440 bytes (publisher), 8 MiB (reader) |

## F3. Live demo run-order (if you have a demo slot)

1. **Normal day.** Start monitoring in the popup (green dot on the badge). Open the test dApp; connect → quiet pass with the 6-check breakdown and pie chart. Approve a trusted spender → green.
2. **Where trust comes from.** Show `bound-v2.eth` → `bound.root.v2` on a Sepolia explorer. Show the service-worker console lines: `digest check: MATCH`, `trust snapshot VERIFIED`.
3. **Run the Arkiv query** from the README live; show the watcher's records.
4. **Hijack.** In the demo server terminal, type `hijack`. Same URL, different `/app.js`.
5. **Scanner trick.** With `BOUND_DEMO_SCANNER_CLEAN=1`, show that a `HeadlessChrome` request gets the clean page.
6. **The click.** Press the approve button → red/escalated warning naming the untrusted spender, the token, the Revoke.cash link. Press Cancel → page gets `4001`, the wallet popup never opens.
7. **Frontend mismatch.** Show the script hash conflict in the warning and the safe-page redirect on Swarm.
8. **Show more.** Open "Show more" on the warning page — point out the incident/warning history panel and the ENS financial-registry comparison line, and say out loud that neither one moved the score.
9. **Limits.** Show a `bypass_possible` case honestly. Close with the 14:54 → 15:41 timeline.

> **Pre-record backups** of the hijack step and the bypass case in case live networking misbehaves. **Never build a clone of a real brand's site** — the demo uses our own test dApp.

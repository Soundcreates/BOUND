# Swarm evidence status

**Arkiv-to-Swarm link not yet proven.** The intended Swarm artifacts include canonical snapshot bytes and public incident-report bytes. Arkiv incident records contain a plain, unencrypted reference and report digest. A secret-bearing or encrypted reference must not be published.

Before this gate can pass, record the test-network configuration, public artifact digests and references, independent second-gateway read and hash, entity key, public link, postage batch lifetime and funding source, Bee service, upload/read code, reproduction commands, timestamp, and observed failure modes. The separate safe-page upload and its available evidence are documented below; an Arkiv entity linking it has not been verified. Snapshot and Swarm implementations belong to Developer 2; Developer 3 gathers the evidence and integrates through their adapter.

## Gateway-only transport

`createSwarmAdapter` in `integrations/swarm/index.js` now supports explicit host-paid uploads:

```js
const gateway = createSwarmAdapter({
  uploadUrl: 'https://api.gateway.ethswarm.org',
  gatewayUrls: ['https://api.gateway.ethswarm.org'],
  stampedByHost: true,
});
const {reference, digest} = await gateway.put(publicBytes);
const verifiedBytes = await gateway.getVerified(reference, digest);
```

Host mode omits all postage headers and checks upload read-back against the input digest. It rejects a simultaneously supplied batch ID. `createSwarmAdapter({gatewayUrls})` creates a read-only adapter without an upload endpoint, batch or wallet. Existing response limits, timeouts, redirect rejection and externally anchored digest checks still apply. A digest received from the same untrusted gateway is not a trust anchor. Host-paid postage has operator-controlled availability and retention.

This is byte transport, not a domain lookup database. Signed domain-feed publishing, proof validation, TTL and extension coordination remain the separate domain-cache implementation described in `Docs/swarm-domain-cache-plan.md`. Safe-page collection publication uses `npm run swarm:safe:publish` and verifies all served files separately.

## Demonstrated safe-page upload and reproduction

On 2026-11-07 the separately uploaded public safe-page collection was reachable at [bzz.limo](https://bzz.limo/bzz/2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c/). Its reference is `2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c`. An earlier read through the upload gateway redirected to `/forbidden`; a successful read on a different gateway does not establish long-term availability.

This upload used the host-paid gateway mode of [`scripts/swarm/publish-safe-page.mjs`](../scripts/swarm/publish-safe-page.mjs), using `https://api.gateway.ethswarm.org`; it supplies no postage batch header. The host controls postage: its actual batch ID and funding wallet are not known from this repository and must be obtained from the provider if the judges require them. The user's own Bee-node funding is not evidence that this gateway upload used that node or its stamp.

To repeat, install dependencies with `npm ci`, run `node apps/safe-page/build.mjs`, then `npm run swarm:safe:check`. To perform an actual public upload, run `npm run swarm:safe:publish`; the command returns a reference only after attempting readback. Gateway availability and publication policy apply. To read an existing upload without uploading again, open the link above or run `curl -L https://bzz.limo/bzz/2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c/`. For strict readback against the current locally built files, run `BOUND_SWARM_GATEWAY_URL=https://bzz.limo npm run swarm:safe:publish -- --verify 2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c`; a different build can legitimately fail the byte comparison. The adapter's upload and verified-read code is in [`integrations/swarm/index.js`](../integrations/swarm/index.js).

**Qualification gaps:** No verified Arkiv entity key is currently documented that points to this reference; the incident schema has a `reportReference` field, but that is not evidence that this safe-page upload was recorded there. The demo-video timestamp and host postage details still need confirmation. This file must be updated with the actual entity key, the corresponding reference, accessible link, and video timestamp after the linked flow is demonstrated. Do not publish an encrypted reference containing its decryption key in Arkiv.

# Swarm evidence status

**Not yet proven.** The intended Swarm artifacts are canonical snapshot bytes and public incident-report bytes. Arkiv incident records should contain the plain, unencrypted reference and report digest. A secret-bearing or encrypted reference must not be published.

Before this gate can pass, record the test-network configuration, public artifact digests and references, independent second-gateway read and hash, entity key, public link, postage batch lifetime and funding source, Bee service, upload/read code, reproduction commands, timestamp, and observed failure modes. No reference, batch, endpoint, or upload is asserted here until actually verified. Snapshot and Swarm implementations belong to Developer 2; Developer 3 gathers the evidence and integrates through their adapter.

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

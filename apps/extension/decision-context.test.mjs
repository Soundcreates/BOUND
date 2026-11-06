import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionContext, readPreconnectionSiteStatus } from "./decision-context.mjs";
import { evaluate } from "../../packages/policy-core/index.mjs";
import { mayRecordObservation, warningCandidates } from "../../packages/policy-core/observations.mjs";

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shared = "0x0000000000000000000000000000000000000001";
const counterparty = "0x0000000000000000000000000000000000000002";
const contract = "0x0000000000000000000000000000000000000003";
const deployer = "0x0000000000000000000000000000000000000004";
const attested = "0x0000000000000000000000000000000000000005";
const witnessedAddress = "0x0000000000000000000000000000000000000006";
const unknownObservation = "0x0000000000000000000000000000000000000007";
const deployedContract = "0x0000000000000000000000000000000000000008";
const site = "xn--bcher-kva.example:8443";
const now = Date.parse("2026-11-08T12:00:00Z");
const future = "2026-11-09T00:00:00Z";

function snapshot({
  sites = { [site]: { "1": {
    trustedCounterparties: [counterparty], trustedContracts: [contract], deployers: [deployer], source: "curated fixture"
  } } },
  epoch = 7
} = {}) {
  return {
    snapshot: {
      schemaVersion: 1, epoch, generatedAt: "2026-11-08T10:00:00Z", expiresAt: "2026-11-15T10:00:00Z",
      network: "sepolia", sharedContracts: { "1": [shared] }, sites
    },
    root: { epoch }
  };
}

function watcherRecords(overrides = {}) {
  return [
    { owner, kind: "baseline", site, chain: "1", expiresAt: future, witnessed: [witnessedAddress] },
    { owner, kind: "drift", site, chain: "1", expiresAt: future, active: true, corroborated: true },
    { owner, kind: "status", site, chain: "1", expiresAt: future, status: "active" },
    { owner, kind: "observation", site, chain: "1", expiresAt: future, value: unknownObservation }
  ].map((record) => ({ ...record, ...overrides }));
}

function adapters({ snapshotResult = snapshot(), records = watcherRecords(), anonRecords = records, attestations = [{ address: attested, site, chain: "0x1" }], deployments = [], uncurated = true } = {}) {
  return {
    readVerifiedSnapshot: async () => snapshotResult,
    readWatcherBundle: async (...args) => {
      assert.equal(args.length, 0, "the seeded bundle read must not receive site or chain");
      return records;
    },
    ...(uncurated ? { readUncuratedViaAnonRpc: async (query) => {
      assert.equal(typeof query.site, "string");
      assert.match(query.chain, /^\d+$/);
      return anonRecords;
    } } : {}),
    readProtocolAttestationsViaAnonRpc: async (query) => {
      assert.match(query.chain, /^\d+$/);
      return attestations;
    },
    readVerifiedDeploymentsViaAnonRpc: async (query) => {
      assert.match(query.chain, /^\d+$/);
      return deployments;
    }
  };
}

test("composes exact host and normalized-chain trust sources with owned baseline signals", async () => {
  const context = await createDecisionContext({
    siteOrigin: "https://BÜCHER.example:8443/path", chainId: "0x01", watcherOwner: owner,
    adapters: adapters({ deployments: [{ address: deployedContract, deployer, site, chain: "0x1" }] }), now
  });
  assert.equal(context.site, site);
  assert.equal(context.chain, "1");
  assert.equal(context.baseline, "seeded");
  assert.equal(context.drift, true);
  assert.equal(context.incidentStatus, "active");
  assert.deepEqual(context.witnessed, new Set([witnessedAddress]));
  assert.deepEqual(context.policy[counterparty].sources, ["snapshot"]);
  assert.deepEqual(context.policy[contract].sources, ["snapshot"]);
  assert.deepEqual(context.policy[counterparty].rolesBySource.snapshot, ["rights", "destination"]);
  assert.deepEqual(context.policy[contract].rolesBySource.snapshot, ["called", "token"]);
  assert.deepEqual(context.policy[shared].sources, ["shared_contract"]);
  assert.equal(context.policy[deployer], undefined);
  assert.deepEqual(context.policy[deployedContract].sources, ["deployer_lineage"]);
  assert.deepEqual(context.policy[attested].sources, ["ens_attestation"]);
  assert.equal(context.policy[unknownObservation], undefined);
  assert.equal(context.status, "ready");
});

test("fake adapter data drives trusted, malicious, and active-incident decision paths", async () => {
  const normalRecords = watcherRecords().filter(record => record.kind !== "drift").map(record => record.kind === "status" ? { ...record, status: "normal" } : record);
  const contextFor = records => createDecisionContext({ siteOrigin: `https://${site}`, chainId: "0x1", watcherOwner: owner, adapters: adapters({ records }), now });
  const normal = await contextFor(normalRecords);
  const trusted = evaluate({ classification: { kind: "decoded", entries: [{ role: "rights", address: counterparty }, { role: "called", address: contract }] }, ...normal });
  assert.equal(trusted.verdict, "green");
  assert.equal(mayRecordObservation({ verdict: trusted.verdict, incidentStatus: normal.incidentStatus, action: "continue" }), true);
  const malicious = evaluate({ classification: { kind: "decoded", entries: [{ role: "rights", address: unknownObservation }] }, ...normal });
  assert.equal(malicious.verdict, "red");
  assert.deepEqual(warningCandidates({ site, chain: "1", addresses: malicious.warnedAddresses }), [{ site, chain: "1", kind: "warned", value: unknownObservation }]);
  assert.equal(mayRecordObservation({ verdict: malicious.verdict, incidentStatus: normal.incidentStatus, action: "continue" }), false);
  const wrongRole = evaluate({ classification: { kind: "decoded", entries: [{ role: "rights", address: contract }] }, ...normal });
  assert.equal(wrongRole.verdict, "red");
  const active = await contextFor(normalRecords.map(record => record.kind === "status" ? { ...record, status: "active" } : record));
  assert.equal(mayRecordObservation({ verdict: "green", incidentStatus: active.incidentStatus, action: "continue" }), false);
});

test("an observed address is visible but does not become trusted or witnessed", async () => {
  const records = [{ owner, kind: "baseline", site, chain: "1", expiresAt: future, observed: [unknownObservation], witnessed: [] }];
  const context = await createDecisionContext({ siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: adapters({ snapshotResult: snapshot({ sites: {} }), anonRecords: records }), now });
  assert.equal(context.observed.has(unknownObservation), true);
  assert.equal(context.witnessed.has(unknownObservation), false);
  assert.equal(context.policy[unknownObservation], undefined);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [{ role: "rights", address: unknownObservation }] }, ...context }).verdict, "red");
});

test("page-load status uses fresh anonymous data and never falls back to a stale bundle", async () => {
  let bundleReads = 0;
  const source = {
    readVerifiedSnapshot: async () => snapshot(),
    readWatcherBundle: async () => { bundleReads++; return watcherRecords().map(record => ({ ...record, status: "normal" })); },
    readSiteStatusViaAnonRpc: async query => { assert.deepEqual(query, { site }); return watcherRecords(); }
  };
  const input = { siteOrigin: `https://${site}`, watcherOwner: owner, adapters: source, now };
  assert.equal((await readPreconnectionSiteStatus(input)).status, "active");
  source.readSiteStatusViaAnonRpc = async () => { throw new Error("offline"); };
  assert.equal((await readPreconnectionSiteStatus(input)).status, "unknown");
  assert.equal(bundleReads, 0);
});

test("trust and status expiring while adapters are running are not used", async () => {
  let elapsed = 0;
  const soon = new Date(now + 1000).toISOString();
  const source = snapshot();
  source.snapshot.expiresAt = soon;
  const records = watcherRecords().map(record => ({ ...record, expiresAt: soon }));
  const sourceAdapters = adapters({ snapshotResult: source, records });
  sourceAdapters.readWatcherBundle = async () => { elapsed = 1001; return records; };
  const input = { siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: sourceAdapters, now, elapsedNow: () => elapsed };
  assert.equal((await createDecisionContext(input)).baseline, null);
  elapsed = 0;
  assert.equal((await readPreconnectionSiteStatus(input)).status, "unknown");

  source.snapshot.expiresAt = future;
  elapsed = 0;
  const context = await createDecisionContext(input);
  assert.equal(context.snapshotAvailable, true);
  assert.equal(context.baseline, null);
});

test("trust does not suffix-match hosts or cross chains", async () => {
  const exactHost = await createDecisionContext({
    siteOrigin: "https://sub.xn--bcher-kva.example:8443", chainId: "1", watcherOwner: owner,
    adapters: adapters({ anonRecords: watcherRecords().map((record) => ({ ...record, site: "sub.xn--bcher-kva.example:8443" })) }), now
  });
  assert.equal(exactHost.baseline, "uncurated");
  assert.equal(exactHost.policy[counterparty], undefined);

  const otherChain = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "10", watcherOwner: owner, adapters: adapters({ anonRecords: [] }), now
  });
  assert.equal(otherChain.baseline, null);
  assert.equal(otherChain.policy[shared], undefined);

  const noAnonAdapter = await createDecisionContext({
    siteOrigin: "https://sub.xn--bcher-kva.example:8443", chainId: "1", watcherOwner: owner,
    adapters: adapters({ uncurated: false }), now
  });
  assert.equal(noAnonAdapter.baseline, null);
  assert.equal(noAnonAdapter.policy[counterparty], undefined);
});

test("missing, stale, incoherent, or unavailable snapshots fail closed", async () => {
  for (const snapshotResult of [
    null,
    { ...snapshot(), root: { epoch: 6 } },
    { ...snapshot(), snapshot: { ...snapshot().snapshot, expiresAt: "2026-11-08T11:00:00Z" } },
    Promise.reject(new Error("offline"))
  ]) {
    const context = await createDecisionContext({ siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: adapters({ snapshotResult }), now });
    assert.equal(context.baseline, null);
    assert.equal(context.policy[counterparty], undefined);
    assert.equal(context.drift, false);
  }
});

test("snapshot epochs compare exactly as safe numbers or bounded decimal strings", async () => {
  const bigEpoch = "9007199254740993";
  const context = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "0x1", watcherOwner: owner,
    adapters: adapters({ snapshotResult: snapshot({ epoch: bigEpoch }) }), now
  });
  assert.equal(context.snapshotAvailable, true);
  assert.equal(context.baseline, "seeded");

  let watcherCalls = 0;
  const unsafe = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: {
      readVerifiedSnapshot: async () => ({ ...snapshot(), snapshot: { ...snapshot().snapshot, epoch: Number(bigEpoch) } }),
      readWatcherBundle: async () => { watcherCalls++; return watcherRecords(); }
    }, now
  });
  assert.equal(unsafe.baseline, null);
  assert.equal(watcherCalls, 0);

  let mismatchWatcherCalls = 0;
  const epochMismatch = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: {
      readVerifiedSnapshot: async () => ({ ...snapshot({ epoch: "9007199254740992" }), root: { epoch: "9007199254740993" } }),
      readWatcherBundle: async () => { mismatchWatcherCalls++; return watcherRecords(); }
    }, now
  });
  assert.equal(epochMismatch.baseline, null);
  assert.equal(mismatchWatcherCalls, 0);

  const oversizedEpoch = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: { readVerifiedSnapshot: async () => snapshot({ epoch: `1${"0".repeat(78)}` }) }, now
  });
  assert.equal(oversizedEpoch.baseline, null);

  let called = false;
  const oversizedChain = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: `1${"0".repeat(78)}`, watcherOwner: owner,
    adapters: { readVerifiedSnapshot: async () => { called = true; return snapshot(); } }, now
  });
  assert.equal(oversizedChain.status, "invalid_context");
  assert.equal(called, false);
});

test("watcher data is fail-closed, owner-checked, and never trusted as policy", async () => {
  const validSnapshot = snapshot();
  const mismatch = watcherRecords().map((record) => ({ ...record, owner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
  const badOwner = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: adapters({ records: mismatch }), now
  });
  assert.equal(badOwner.baseline, null);
  assert.equal(badOwner.incidentStatus, "unknown");

  const observationsOnly = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: adapters({ records: watcherRecords().filter((record) => record.kind !== "baseline") }), now
  });
  assert.equal(observationsOnly.baseline, null);
  assert.equal(observationsOnly.policy[unknownObservation], undefined);
  assert.equal(observationsOnly.incidentStatus, "unknown");

  const unavailable = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: { ...adapters({ snapshotResult: validSnapshot }), readWatcherBundle: async () => { throw new Error("offline"); } }, now
  });
  assert.equal(unavailable.baseline, null);
  assert.equal(unavailable.status, "watcher_baseline_unavailable");

  for (const badExpiry of [undefined, "not-a-date", "2026-11-08T11:00:00Z"]) {
    const expired = watcherRecords().map((record) => ({ ...record, expiresAt: badExpiry }));
    const context = await createDecisionContext({
      siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: adapters({ records: expired }), now
    });
    assert.equal(context.baseline, null);
    assert.equal(context.drift, false);
    assert.equal(context.witnessed.size, 0);
  }
});

test("snapshot deployers are identities only; lineage needs exact verified deployment evidence", async () => {
  const context = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: adapters({ deployments: [
      { address: deployedContract, deployer, site, chain: "1" },
      { address: unknownObservation, deployer, site: `sub.${site}`, chain: "1" },
      { address: unknownObservation, deployer, site, chain: "10" },
      { address: unknownObservation, deployer: contract, site, chain: "1" }
    ] }), now
  });
  assert.deepEqual(context.policy[deployedContract].sources, ["deployer_lineage"]);
  assert.equal(context.policy[deployer], undefined);
  assert.equal(context.policy[unknownObservation], undefined);
});

test("only verified, exact-scope protocol attestations add attestation trust", async () => {
  const context = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: adapters({ attestations: [
      { address: attested, site, chain: "1" },
      { address: unknownObservation, site: `sub.${site}`, chain: "1" },
      { address: unknownObservation, site, chain: "10" }
    ] }), now
  });
  assert.deepEqual(context.policy[attested].sources, ["ens_attestation"]);
  assert.equal(context.policy[unknownObservation], undefined);
});

test("incident status is active or normal only from one current watcher-owned status record", async () => {
  const withStatus = (statusRecords) => [
    ...watcherRecords().filter((record) => record.kind !== "status"),
    ...statusRecords
  ];
  const read = async (records) => createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner, adapters: adapters({ records }), now
  });
  assert.equal((await read(withStatus([{ owner, kind: "status", site, chain: "1", expiresAt: future, status: "active" }]))).incidentStatus, "active");
  assert.equal((await read(withStatus([{ owner, kind: "status", site, chain: "1", expiresAt: future, status: "normal" }]))).incidentStatus, "normal");
  assert.equal((await read(withStatus([]))).incidentStatus, "unknown");
  assert.equal((await read(withStatus([
    { owner, kind: "status", site, chain: "1", expiresAt: future, status: "active" },
    { owner, kind: "status", site, chain: "1", expiresAt: future, status: "normal" }
  ]))).incidentStatus, "active");
  assert.equal((await read(withStatus([
    { owner, kind: "status", site, chain: "1", expiresAt: future, status: "normal" },
    { owner, kind: "status", site, chain: "1", expiresAt: future, status: "future-value" }
  ]))).incidentStatus, "unknown");
  assert.equal((await read(withStatus([{ owner, kind: "status", site, chain: "1", expiresAt: "2026-11-08T11:00:00Z", status: "normal" }]))).incidentStatus, "unknown");
});

test("loopback HTTP origins are allowed only for test hosts", async () => {
  const local = await createDecisionContext({
    siteOrigin: "http://localhost:5173", chainId: "1", watcherOwner: owner,
    adapters: adapters({ anonRecords: watcherRecords().map((record) => ({ ...record, site: "localhost:5173" })) }), now
  });
  assert.equal(local.site, "localhost:5173");
  assert.equal(local.baseline, "uncurated");

  let snapshotCalls = 0;
  const externalHttp = await createDecisionContext({
    siteOrigin: "http://example.com", chainId: "1", watcherOwner: owner,
    adapters: { ...adapters(), readVerifiedSnapshot: async () => { snapshotCalls++; return snapshot(); } }, now
  });
  assert.equal(externalHttp.status, "invalid_context");
  assert.equal(snapshotCalls, 0);
});

test("snapshot is checked before site reads and every adapter wait is bounded", async () => {
  let siteReadCalls = 0;
  const stale = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: {
      readVerifiedSnapshot: async () => ({ ...snapshot(), snapshot: { ...snapshot().snapshot, expiresAt: "2026-11-08T11:00:00Z" } }),
      readWatcherBundle: async (...args) => { siteReadCalls++; assert.equal(args.length, 0); return watcherRecords(); },
      readUncuratedViaAnonRpc: async () => { siteReadCalls++; return watcherRecords(); },
      readProtocolAttestationsViaAnonRpc: async () => { siteReadCalls++; return []; },
      readVerifiedDeploymentsViaAnonRpc: async () => { siteReadCalls++; return []; }
    }, now
  });
  assert.equal(stale.baseline, null);
  assert.equal(siteReadCalls, 0);

  const anonTimeout = await createDecisionContext({
    siteOrigin: `https://sub.${site}`, chainId: "1", watcherOwner: owner,
    adapters: {
      readVerifiedSnapshot: async () => snapshot(),
      readUncuratedViaAnonRpc: () => new Promise(() => {})
    }, now
  });
  assert.equal(anonTimeout.baseline, null);
  assert.equal(anonTimeout.incidentStatus, "unknown");

  const bulkTimeout = await createDecisionContext({
    siteOrigin: `https://${site}`, chainId: "1", watcherOwner: owner,
    adapters: { readVerifiedSnapshot: async () => snapshot(), readWatcherBundle: () => new Promise(() => {}) }, now
  });
  assert.equal(bulkTimeout.baseline, null);
  assert.equal(bulkTimeout.status, "watcher_baseline_unavailable");
});

test("preconnection status uses only current exact-site owned records from the whole bundle", async () => {
  let bundleArgs = null;
  const statusRecord = (status, overrides = {}) => ({ owner, kind: "status", site, chain: "1", expiresAt: future, status, ...overrides });
  const read = (records, snapshotResult = snapshot(), origin = `https://${site}`) => readPreconnectionSiteStatus({
    siteOrigin: origin, watcherOwner: owner, now,
    adapters: {
      readVerifiedSnapshot: async () => snapshotResult,
      readWatcherBundle: async (...args) => { bundleArgs = args; return records; }
    }
  });

  const active = await read([statusRecord("active")]);
  const futureIso = new Date(Date.parse(future)).toISOString();
  assert.deepEqual(active, { site, status: "active", checkedAt: new Date(now).toISOString(), expiresAt: futureIso });
  assert.deepEqual(bundleArgs, []);

  const normal = await read([statusRecord("normal")]);
  assert.equal(normal.status, "normal");
  assert.equal(normal.expiresAt, futureIso);
  assert.equal((await read([statusRecord("normal", { expiresAt: "2026-11-08T11:00:00Z" })])).status, "unknown");
  assert.equal((await read([statusRecord("normal", { owner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })])).status, "unknown");
  assert.equal((await read([statusRecord("active"), statusRecord("normal")])).status, "active");
  assert.equal((await read([
    statusRecord("normal"), statusRecord("active", { owner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
  ])).status, "normal");

  const twoChains = snapshot({ sites: { [site]: {
    "1": { trustedCounterparties: [], trustedContracts: [], deployers: [], source: "test" },
    "10": { trustedCounterparties: [], trustedContracts: [], deployers: [], source: "test" }
  } } });
  assert.equal((await read([statusRecord("active")], twoChains)).status, "active");
  assert.equal((await read([statusRecord("normal"), statusRecord("normal", { chain: "10" })], twoChains)).status, "normal");
  assert.equal((await read([statusRecord("normal")], twoChains)).status, "unknown");
  assert.equal((await read([
    statusRecord("normal"), statusRecord("active"), statusRecord("normal", { chain: "10" })
  ], twoChains)).status, "active");

  let bundleCalls = 0;
  const badSnapshot = await readPreconnectionSiteStatus({
    siteOrigin: `https://${site}`, watcherOwner: owner, now,
    adapters: {
      readVerifiedSnapshot: async () => ({ ...snapshot(), root: { epoch: 6 } }),
      readWatcherBundle: async () => { bundleCalls++; return [statusRecord("active")]; }
    }
  });
  assert.equal(badSnapshot.status, "unknown");
  assert.equal(bundleCalls, 0);

  const wrongHost = await read([statusRecord("active", { site: `sub.${site}` })], snapshot(), `https://sub.${site}`);
  assert.equal(wrongHost.status, "unknown");
  assert.equal(wrongHost.expiresAt, null);

  const expiresAtSnapshot = "2026-11-08T14:00:00Z";
  const snapshotBounded = await read([statusRecord("active")], {
    ...snapshot(), snapshot: { ...snapshot().snapshot, expiresAt: expiresAtSnapshot }
  });
  assert.equal(snapshotBounded.status, "active");
  assert.equal(snapshotBounded.expiresAt, new Date(Date.parse(expiresAtSnapshot)).toISOString());
});

test("preconnection status allows only loopback HTTP test origins and times out", async () => {
  const localSite = "localhost:5173";
  const localSnapshot = snapshot({ sites: { [localSite]: { "1": {
    trustedCounterparties: [], trustedContracts: [], deployers: [], source: "local test"
  } } } });
  const localStatus = await readPreconnectionSiteStatus({
    siteOrigin: "http://localhost:5173", watcherOwner: owner, now,
    adapters: {
      readVerifiedSnapshot: async () => localSnapshot,
      readWatcherBundle: async (...args) => {
        assert.equal(args.length, 0);
        return [{ owner, kind: "status", site: localSite, chain: "1", expiresAt: future, status: "normal" }];
      }
    }
  });
  assert.deepEqual(localStatus, { site: localSite, status: "normal", checkedAt: new Date(now).toISOString(), expiresAt: new Date(Date.parse(future)).toISOString() });

  const timeout = await readPreconnectionSiteStatus({
    siteOrigin: `https://${site}`, watcherOwner: owner, now,
    adapters: { readVerifiedSnapshot: () => new Promise(() => {}), readWatcherBundle: async () => [] }
  });
  assert.equal(timeout.status, "unknown");
  assert.equal(timeout.expiresAt, null);
});

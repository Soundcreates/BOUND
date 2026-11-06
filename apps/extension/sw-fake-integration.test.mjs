import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

globalThis.crypto ??= webcrypto;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "0x00000000000000000000000000000000000000aa";
const TRUSTED = "0x0000000000000000000000000000000000000011";
const ACCOUNT = "0x0000000000000000000000000000000000000022";
const TOKEN = "0x0000000000000000000000000000000000000033";
const SPENDER = "0x0000000000000000000000000000000000000044";
const SITE = "green.example";

test("service worker uses fake trust and watcher adapters for observation flows", async () => {
  const tempBase = await realpath(os.tmpdir());
  const tempRoot = await mkdtemp(path.join(tempBase, "bound-sw-fake-"));
  let resolvedTemp;
  try {
    resolvedTemp = await realpath(tempRoot);
    const relative = path.relative(tempBase, resolvedTemp);
    assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));

    const extensionRoot = path.join(resolvedTemp, "apps", "extension");
    const decoderRoot = path.join(resolvedTemp, "packages", "decoder");
    const policyRoot = path.join(resolvedTemp, "packages", "policy-core");
    await Promise.all([mkdir(extensionRoot, { recursive: true }), mkdir(decoderRoot, { recursive: true }), mkdir(policyRoot, { recursive: true })]);
    for (const file of ["sw.js", "connection-score.mjs", "score-settings.mjs", "score-config.mjs", "observation-queue.mjs", "observation-dispatcher.mjs", "decision-context.mjs", "anon-rpc-host.mjs", "network-capture.mjs", "frontend-integrity.mjs"]) {
      await copyFile(path.join(repoRoot, "apps", "extension", file), path.join(extensionRoot, file));
    }
    await copyFile(path.join(repoRoot, "packages", "decoder", "index.mjs"), path.join(decoderRoot, "index.mjs"));
    for (const file of ["index.mjs", "observations.mjs"]) {
      await copyFile(path.join(repoRoot, "packages", "policy-core", file), path.join(policyRoot, file));
    }

    await writeFile(path.join(extensionRoot, "trust-adapter.mjs"), `
      export async function getWatcherOwner() { return "${OWNER}"; }
      export const decisionAdapters = {
        async readVerifiedSnapshot() { return globalThis.__boundFake.adapters.snapshot; },
        async readWatcherBundle() { const adapters = globalThis.__boundFake.adapters; return adapters.getRecords ? adapters.getRecords() : adapters.records; }
      };
    `);
    await writeFile(path.join(extensionRoot, "anon-rpc-engine.mjs"), `export function createAnonEngine() { throw new Error('not used by fake integration'); }`);
    await writeFile(path.join(extensionRoot, "watcher-adapter.mjs"), `
      export async function isObservationConfigured() { return true; }
      export async function sendObservationBatch(records, { signal } = {}) {
        if (signal?.aborted) throw new Error("aborted");
        globalThis.__boundFake.sent.push(structuredClone(records));
      }
    `);

    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const snapshot = {
      schemaVersion: 1,
      epoch: 1,
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: future,
      network: "test",
      sharedContracts: {},
      sites: Object.fromEntries([SITE, "red.example", "incident.example"].map(site => [site, {
        "1": { trustedCounterparties: [], trustedContracts: [TRUSTED], deployers: [], source: "fake" }
      }]))
    };
    const local = {};
    const session = {};
    const fake = {
      site: SITE,
      adapters: {
        snapshot: { snapshot, root: { epoch: 1 } },
        records: [
          { owner: OWNER, kind: "baseline", site: SITE, chain: "1", expiresAt: future, witnessed: [] },
          { owner: OWNER, kind: "status", status: "normal", site: SITE, chain: "1", expiresAt: future }
        ]
      },
      sent: [],
      notifications: [],
      windows: [],
      listeners: [],
      alarms: new Map(),
      currentDocuments: new Map()
    };
    globalThis.__boundFake = fake;
    const store = data => ({
      async get(keys) {
        const names = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(names.filter(key => key in data).map(key => [key, data[key]]));
      },
      async set(values) { Object.assign(data, values); }
    });

    globalThis.chrome = {
      runtime: {
        id: "fake-extension",
        getURL: file => `chrome-extension://fake-extension/${file}`,
        onMessage: { addListener(fn) { fake.listeners.push(fn); } },
        async getContexts() { return []; },
        async sendMessage() { return { error: "unused" }; }
      },
      storage: { local: store(local), session: store(session) },
      alarms: {
        onAlarm: { addListener(fn) { fake.onAlarm = fn; } },
        async create(name, info = {}) { fake.alarms.set(name, info); },
        async clear(name) { fake.alarms.delete(name); }
      },
      tabs: {
        onUpdated: { addListener(fn) { fake.onUpdated = fn; } },
        onRemoved: { addListener() {} },
        async query() { return [{ id: 1, url: `https://${SITE}/` }]; },
        async get(id) { return { id, url: `https://${SITE}/` }; },
        async sendMessage(_id, _message, options) { assert.equal(options.documentId, fake.currentDocuments.get("1:0")); return { scripts: [{ label: "Inline script", source: "inline DOM", hash: "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=" }], unavailable: 0 }; }
      },
      webNavigation: {
        async getFrame({ tabId, frameId }) { return { documentId: fake.currentDocuments.get(`${tabId}:${frameId}`) }; }
      },
      windows: {
        onRemoved: { addListener(fn) { fake.onWindowRemoved = fn; } },
        async create(options) {
          const window = { id: 200 + fake.windows.length, url: options.url };
          fake.windows.push(window);
          return window;
        }
      },
      notifications: {
        async create(id, options) { fake.notifications.push({ id, ...options }); return id; },
        async clear() { return true; }
      },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
    };

    const swUrl = pathToFileURL(path.join(extensionRoot, "sw.js")).href;
    await import(swUrl);
    const listener = fake.listeners[0];
    assert.equal(typeof listener, "function");

    const waitFor = async predicate => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("Timed out waiting for the fake service worker");
    };
    const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
    const hash = async value => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    };
    const scenarioRecords = status => [
      { owner: OWNER, kind: "baseline", site: fake.site, chain: "1", expiresAt: future, witnessed: [], observed: [SPENDER] },
      { owner: OWNER, kind: "status", status, site: fake.site, chain: "1", expiresAt: future }
    ];
    const makeSender = (site, documentId) => {
      fake.currentDocuments.set(`1:0`, documentId);
      return { id: "fake-extension", tab: { id: 1, url: `https://${site}/` }, frameId: 0, documentId, url: `https://${site}/` };
    };
    const connectionState = { chainId: "0x1", accounts: [] };
    const connect = async (method, sender) => {
      const request = { method, params: method === "wallet_requestPermissions" ? [{ eth_accounts: {} }] : [] };
      return send({ type: "BOUND_REQUEST_V1", request, state: connectionState, digest: await hash(JSON.stringify(request)), stateDigest: await hash(JSON.stringify(connectionState)) }, sender);
    };
    for (const method of ["eth_requestAccounts", "wallet_requestPermissions", "eth_accounts", "eth_coinbase", "metamask_getProviderState"]) {
      const connectionSender = makeSender(SITE, `connection-${method}`);
      fake.site = SITE;
      fake.adapters.records = scenarioRecords("normal");
      assert.equal((await connect(method, connectionSender)).action, "continue");
      for (const status of ["active", "drift"]) {
        fake.adapters.records = scenarioRecords(status);
        const result = await connect(method, connectionSender);
        assert.equal(result.action, "cancel");
        assert.equal(result.connectionStatus, status);
      }
      fake.adapters.records = [];
      assert.equal((await connect(method, connectionSender)).connectionStatus, "unknown");
      assert.equal(local.boundWarningHistory.at(-1).method, method);
      assert.equal(local.boundWarningHistory.at(-1).verdict, "connection blocked");
      assert.match(local.boundWarningHistory.at(-1).reasons[0], /unavailable/);
    }
    const connectionSender = makeSender(SITE, "connection-cross-frame");
    fake.adapters.records = scenarioRecords("normal");
    assert.equal((await connect("eth_requestAccounts", { ...connectionSender, url: "https://unknown.example/" })).connectionStatus, "unknown");
    fake.currentDocuments.set("1:0", "replacement-doc");
    assert.equal((await connect("eth_requestAccounts", connectionSender)).action, "cancel");
    const startRequest = async (site, request, status = "normal") => {
      fake.site = site;
      fake.adapters.records = scenarioRecords(status);
      const sender = makeSender(site, `doc-${site}`);
      const state = { chainId: "0x1", accounts: [ACCOUNT] };
      const payload = JSON.stringify(request), statePayload = JSON.stringify(state);
      const windowIndex = fake.windows.length;
      const resultPromise = send({
        type: "BOUND_REQUEST_V1", request, state,
        digest: await hash(payload), stateDigest: await hash(statePayload)
      }, sender);
      await waitFor(() => fake.windows.length > windowIndex);
      const window = fake.windows[windowIndex];
      const id = new URL(window.url).searchParams.get("request");
      const warningSender = { id: "fake-extension", frameId: 0, tab: { windowId: window.id }, url: window.url };
      await send({ type: "BOUND_GET_V1", id }, warningSender);
      return { id, window, warningSender, resultPromise, sender };
    };
    const choose = async (entry, action = "continue") => {
      assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: entry.id, action }, entry.warningSender), { ok: true });
      return entry.resultPromise;
    };

    assert.deepEqual(await send({ type: "BOUND_STATUS_V1" }, { id: "fake-extension" }), { observationReporting: true });
    await waitFor(() => session.boundSiteStatuses?.[1]?.status === "normal");

    // A slower earlier refresh must not erase a later incident status.
    let releaseOld, reads = 0;
    fake.adapters.getRecords = () => ++reads === 1
      ? new Promise(resolve => { releaseOld = () => resolve(scenarioRecords("normal")); })
      : Promise.resolve(scenarioRecords("active"));
    fake.onAlarm({ name: "bound-site-status-refresh" });
    await waitFor(() => typeof releaseOld === "function");
    fake.onAlarm({ name: "bound-site-status-refresh" });
    await waitFor(() => session.boundSiteStatuses?.[1]?.status === "active");
    await waitFor(() => fake.notifications.length === 1);
    assert.match(fake.notifications[0].message, /active incident.*green\.example/);
    releaseOld();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(session.boundSiteStatuses[1].status, "active");
    fake.onAlarm({ name: "bound-site-status-refresh" });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fake.notifications.length, 1);
    fake.adapters.getRecords = () => Promise.resolve(scenarioRecords("drift"));
    fake.onAlarm({ name: "bound-site-status-refresh" });
    await waitFor(() => fake.notifications.length === 2);
    assert.match(fake.notifications[1].message, /infrastructure change.*green\.example/);
    delete fake.adapters.getRecords;

    const trusted = await startRequest(SITE, { method: "eth_sendTransaction", params: [{ to: TRUSTED, data: "0x" }] });
    const trustedDetails = await send({ type: "BOUND_GET_V1", id: trusted.id }, trusted.warningSender);
    assert.equal(trustedDetails.verdict, "green");
    assert.equal(trustedDetails.frontend.scripts[0].hash, "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
    const forwarded = await choose(trusted);
    assert.ok(forwarded.receiptToken);
    assert.equal(local.boundObservationQueue?.some(record => record.kind === "observation") ?? false, false);
    const receipt = { type: "BOUND_FORWARDED_V1", receiptToken: forwarded.receiptToken, digest: forwarded.digest, stateDigest: forwarded.stateDigest };
    assert.deepEqual(await send(receipt, { ...trusted.sender, frameId: 4 }), { ok: false });
    assert.deepEqual(await send(receipt, trusted.sender), { ok: true });
    assert.deepEqual(await send(receipt, trusted.sender), { ok: false });
    await waitFor(() => local.boundObservationQueue?.some(record => record.site === SITE && record.kind === "observation"));

    local.boundObservationQueue = [];
    local.boundObservationSeen = {};
    const approve = {
      method: "eth_sendTransaction",
      params: [{ to: TOKEN, data: `0x095ea7b3${SPENDER.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}` }]
    };
    const red = await startRequest("red.example", approve);
    const redDetails = await send({ type: "BOUND_GET_V1", id: red.id }, red.warningSender);
    assert.equal(redDetails.verdict, "red");
    assert.deepEqual(redDetails.observedAddresses, [SPENDER]);
    await waitFor(() => local.boundObservationQueue?.some(record => record.kind === "warned" && record.value === SPENDER));
    assert.equal(await send({ type: "BOUND_DECISION_V1", id: red.id, action: "continue" }, red.warningSender).then(result => result.ok), true);
    await red.resultPromise;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(local.boundObservationQueue.some(record => record.site === "red.example" && record.kind === "observation"), false);

    local.boundObservationQueue = [];
    local.boundObservationSeen = {};
    const incident = await startRequest("incident.example", { method: "eth_sendTransaction", params: [{ to: TRUSTED, data: "0x" }] }, "active");
    assert.equal((await send({ type: "BOUND_GET_V1", id: incident.id }, incident.warningSender)).verdict, "green");
    await choose(incident);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(local.boundObservationQueue.filter(record => record.kind === "observation").length, 0);
  } finally {
    const finalPath = await realpath(tempRoot);
    const finalRelative = path.relative(tempBase, finalPath);
    if ((resolvedTemp && finalPath !== resolvedTemp) || !finalRelative || finalRelative === ".." || finalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(finalRelative)) {
      throw new Error("Refusing to remove an unexpected temporary path");
    }
    await rm(finalPath, { recursive: true, force: true });
    delete globalThis.__boundFake;
    delete globalThis.chrome;
  }
});

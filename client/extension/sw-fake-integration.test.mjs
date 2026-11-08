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

    const extensionRoot = path.join(resolvedTemp, "client", "extension");
    const safePageRoot = path.join(resolvedTemp, "client", "safe-page", "src");
    const decoderRoot = path.join(resolvedTemp, "shared", "decoder");
    const policyRoot = path.join(resolvedTemp, "shared", "policy-core");
    const contractsRoot = path.join(resolvedTemp, "shared", "contracts");
    await Promise.all([
      mkdir(extensionRoot, { recursive: true }),
      mkdir(safePageRoot, { recursive: true }),
      mkdir(decoderRoot, { recursive: true }),
      mkdir(policyRoot, { recursive: true }),
      mkdir(contractsRoot, { recursive: true })
    ]);
    for (const file of [
      "sw.js",
      "connection-score.mjs",
      "score-settings.mjs",
      "score-config.mjs",
      "observation-queue.mjs",
      "observation-dispatcher.mjs",
      "decision-context.mjs",
      "settings.mjs",
      "anon-rpc-host.mjs",
      "network-capture.mjs",
      "frontend-integrity.mjs",
      "frontend-redirect.mjs",
      "warning-checks.mjs",
      "ticket-store.mjs",
      "frontend-routing.mjs",
      "warning-checks.mjs"
    ]) {
      await copyFile(path.join(repoRoot, "client", "extension", file), path.join(extensionRoot, file));
    }
    await copyFile(path.join(repoRoot, "client", "safe-page", "src", "fragment.mjs"), path.join(safePageRoot, "fragment.mjs"));
    await copyFile(path.join(repoRoot, "shared", "decoder", "index.mjs"), path.join(decoderRoot, "index.mjs"));
    for (const file of ["index.mjs", "observations.mjs", "frontend.mjs"]) {
      await copyFile(path.join(repoRoot, "shared", "policy-core", file), path.join(policyRoot, file));
    }
    for (const file of ["index.js", "frontend.js"]) {
      await copyFile(path.join(repoRoot, "shared", "contracts", file), path.join(contractsRoot, file));
    }

    await writeFile(path.join(extensionRoot, "trust-adapter.mjs"), `
      export async function getWatcherOwner() { return "${OWNER}"; }
      export const decisionAdapters = {
        async readVerifiedSnapshot() { return globalThis.__boundFake.adapters.snapshot; },
        async readEnsRegistry({observed}) { return {status:'matched-subset',compared:observed.scripts.length,unfamiliar:0}; },
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
      const ADDRESS = /^0x[0-9a-f]{40}$/i;
      export function toIntakeEvent(record) {
        if (!record || typeof record !== "object" || typeof record.site !== "string" || typeof record.chain !== "string" || typeof record.reporterKey !== "string" || !record.reporterKey || record.reporterKey.length > 128) throw new Error("Invalid queued observation");
        if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(record.chain)) throw new Error("Invalid observation chain");
        let chainId; try { chainId = BigInt(record.chain); } catch { throw new Error("Invalid observation chain"); }
        if (chainId < 1n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid observation chain");
        let url; try { url = new URL(\`https://\${record.site}\`); } catch { throw new Error("Invalid observation site"); }
        if (url.host !== record.site || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid observation site");
        if (record.kind === "frontend") {
          return { site: record.site, kind: "frontend", chainId: Number(chainId), reporterKey: record.reporterKey, path: record.path, hash: record.hash };
        }
        if (record.kind === "warned" && record.value === undefined) return null;
        if (!ADDRESS.test(record.value) || !["observation", "warned"].includes(record.kind) || (record.observationKind !== undefined && (record.kind !== "observation" || record.observationKind !== "called-contract"))) throw new Error("Invalid queued observation");
        return { site: record.site, kind: record.kind === "warned" ? "warned" : record.observationKind ?? "counterparty", value: record.value, chainId: Number(chainId), reporterKey: record.reporterKey };
      }
      export function encodeObservationBatch(records) {
        if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error("Invalid observation batch count");
        const events = records.map(toIntakeEvent).filter(Boolean);
        const body = JSON.stringify({ schemaVersion: 1, events });
        if (new TextEncoder().encode(body).length > 60000) throw new Error("Observation batch exceeds 60000 bytes");
        return body;
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
    const local = { boundMonitoring: true };
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
        async query() { return [{ id: 1, url: `https://${fake.site}/` }]; },
        async get(id) { return { id, url: `https://${fake.site}/` }; },
        async sendMessage(_id, message, options) {
          if (message?.type === "BOUND_RETRY_GUARD_V1") return true;
          assert.equal(options.documentId, fake.currentDocuments.get("1:0"));
          const hash = "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";
          const url = `https://${fake.site}/`;
          return {
            version: 1,
            documentUrl: url,
            scripts: [{ path: "/app.js", hash }],
            coverage: { total: 1, compared: 1, inlineExcluded: 0, queryExcluded: 0, crossOriginExcluded: 0, privatePathExcluded: 0, unavailable: 0, overCap: 0 }
          };
        }
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
    const connect = async (method, sender, state = connectionState) => {
      const request = { method, params: method === "wallet_requestPermissions" ? [{ eth_accounts: {} }] : [] };
      return send({ type: "BOUND_REQUEST_V1", request, state, digest: await hash(JSON.stringify(request)), stateDigest: await hash(JSON.stringify(state)) }, sender);
    };
    // Passive account reads never open UI: the wallet only discloses granted accounts.
    for (const method of ["eth_accounts", "eth_coinbase", "metamask_getProviderState"]) {
      const before = fake.windows.length;
      const result = await connect(method, makeSender(SITE, `passive-${method}`));
      assert.equal(result.action, "continue");
      assert.equal(result.readOnly, true);
      assert.equal(fake.windows.length, before, `${method} must not open a review`);
    }
    // Connection prompts always open a review and are never cancelled on score alone.
    const review = async (method, sender, status, state = connectionState) => {
      fake.adapters.records = status ? scenarioRecords(status) : [];
      const index = fake.windows.length;
      const resultPromise = connect(method, sender, state);
      await waitFor(() => fake.windows.length > index);
      const window = fake.windows[index];
      const id = new URL(window.url).searchParams.get("request");
      const warningSender = { id: "fake-extension", frameId: 0, tab: { windowId: window.id }, url: window.url };
      const details = await send({ type: "BOUND_GET_V1", id }, warningSender);
      return { id, warningSender, resultPromise, details };
    };
    for (const method of ["eth_requestAccounts", "wallet_requestPermissions"]) {
      fake.site = SITE;
      const sender = makeSender(SITE, `connection-${method}`);
      const verified = await review(method, sender, "normal");
      assert.equal(verified.details.kind, "connection");
      assert.equal(verified.details.frontendRegistry.status, "matched-subset");
      assert.equal(verified.details.frontendRegistry.compared, 1);
      assert.equal(verified.details.tier, "pass");
      assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: verified.id, action: "continue" }, verified.warningSender), { ok: true });
      assert.equal((await verified.resultPromise).action, "continue");
      for (const status of ["active", "drift"]) {
        const danger = await review(method, sender, status);
        assert.equal(danger.details.tier, "firewall");
        assert.equal(danger.details.verdict, "escalated");
        assert.equal(danger.details.connectionStatus, status);
        assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: danger.id, action: "continue" }, danger.warningSender), { ok: false, error: "confirmation_required" });
        assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: danger.id, action: "continue", confirmation: "I UNDERSTAND" }, danger.warningSender), { ok: true });
        assert.equal((await danger.resultPromise).action, "continue", `${status} stays user-decidable`);
      }
      const missing = await review(method, sender, null);
      assert.ok(["warning", "huge"].includes(missing.details.tier));
      assert.equal(local.boundWarningHistory.at(-1).method, method);
      assert.match(local.boundWarningHistory.at(-1).verdict, /^connection · /);
      assert.match(local.boundWarningHistory.at(-1).reasons[0], /unavailable/);
      assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: missing.id, action: "cancel" }, missing.warningSender), { ok: true });
      assert.equal((await missing.resultPromise).action, "cancel");
    }
    const slowWallet = await review("eth_requestAccounts", makeSender(SITE, "slow-wallet"), null, null);
    assert.equal(slowWallet.details.locked, true);
    assert.equal(typeof slowWallet.details.connectionScore.score, "number");
    assert.equal(slowWallet.details.connectionScore.verified, false);
    assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id: slowWallet.id, action: "continue" }, slowWallet.warningSender), { ok: true });
    assert.equal((await slowWallet.resultPromise).action, "continue");
    const connectionSender = makeSender(SITE, "connection-cross-frame");
    fake.adapters.records = scenarioRecords("normal");
    const crossFrame = await review("eth_requestAccounts", { ...connectionSender, url: "https://unknown.example/" }, "normal");
    assert.notEqual(crossFrame.details.tier, "pass", "an unverified requesting frame cannot ride on a verified top page");
    await send({ type: "BOUND_DECISION_V1", id: crossFrame.id, action: "cancel" }, crossFrame.warningSender);
    await crossFrame.resultPromise;
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

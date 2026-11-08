import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;
let listener;
let windowRemoved;
let tabUpdated;
let blockHistory;
const windows = [];
const currentDocuments = new Map();
let failCreate = false;
const data = { boundMonitoring: true };
const storage = {
  async get(keys) {
    if (keys === "boundWarningHistory" && blockHistory) {
      const gate = blockHistory;
      blockHistory = null;
      gate.enter();
      await gate.wait;
    }
    const names = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(names.filter(name => name in data).map(name => [name, data[name]]));
  },
  async set(values) { Object.assign(data, values); }
};
globalThis.chrome = {
  runtime: { id: "extension", getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener(fn) { listener = fn; } } },
  tabs: { onUpdated: { addListener(fn) { tabUpdated = fn; } }, onRemoved: { addListener() {} } },
  webNavigation: { async getFrame({ tabId, frameId }) { return { documentId: currentDocuments.get(`${tabId}:${frameId}`) || (frameId === 2 ? "doc-1" : "top") }; } },
  alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
  windows: { onRemoved: { addListener(fn) { windowRemoved = fn; } }, async create(options) { if (failCreate) throw new Error("window unavailable"); const window = { id: 100 + windows.length, url: options.url }; windows.push(window); return window; } },
  storage: { local: storage, session: storage },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};
await import("./sw.js");

const page = { id: "extension", tab: { id: 1, url: "https://top.example/" }, frameId: 2, documentId: "doc-1", url: "https://frame.example/" };
const request = { method: "eth_sendTransaction", params: [{ to: "0x0000000000000000000000000000000000000001", data: "0x" }] };
const state = { chainId: "0x1", accounts: ["0x0000000000000000000000000000000000000002"] };
async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function message(overrides = {}) {
  return { type: "BOUND_REQUEST_V1", request, state, digest: await hash(JSON.stringify(request)), stateDigest: await hash(JSON.stringify(state)), ...overrides };
}
function send(value, sender) { return new Promise(resolve => listener(value, sender, resolve)); }
async function untilWindow(index) {
  for (let i = 0; i < 100; i++) { if (windows[index]) return windows[index]; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("Warning was not created");
}
function warningSender(window, overrides = {}) {
  return { id: "extension", frameId: 0, tab: { windowId: window.id }, url: window.url, ...overrides };
}

test("mismatched payload digest is cancelled before any warning is created", async () => {
  const count = windows.length;
  const result = await send(await message({ digest: "0".repeat(64) }), page);
  assert.equal(result.action, "cancel");
  assert.equal(windows.length, count);
});

test("oversized provider state is rejected before a warning or decision", async () => {
  const count = windows.length;
  const result = await send(await message({ state: { chainId: `0x${"1".repeat(9000)}`, accounts: [] } }), page);
  assert.equal(result.action, "cancel");
  assert.equal(windows.length, count);
});

test("a request from a replaced browser document cannot open a warning", async () => {
  const tab = { id: 5, url: "https://top.example/" };
  currentDocuments.set("5:2", "replacement");
  const count = windows.length;
  const result = await send(await message(), { ...page, tab });
  assert.equal(result.action, "cancel");
  assert.equal(windows.length, count);
});

test("first run seeds the default settings so requests are checked and reported", async () => {
  assert.equal(data.boundSettings?.watcherOwner, "0xe63393558e36df643347326e7e03ad5fb0e6c867");
  assert.equal(data.boundSettings?.watcherUrl, "https://bound-aggregator-0-1-1.onrender.com/v1/observations");
  // Source runs pin no aggregator key, and reports are never sent unencrypted.
  assert.deepEqual(await send({ type: "BOUND_STATUS_V1" }, { id: "extension" }), { observationReporting: false });
});

test("extension reports that observation transport is not configured", async () => {
  const saved = data.boundSettings;
  data.boundSettings = { ...saved, watcherUrl: "" };
  try { assert.deepEqual(await send({ type: "BOUND_STATUS_V1" }, { id: "extension" }), { observationReporting: false }); }
  finally { data.boundSettings = saved; }
});

test("popup data diagnostic reports missing saved settings without starting a network lookup", async () => {
  delete data.boundSettings;
  const result = await send({ type: "BOUND_DATA_DIAGNOSTIC_V1" }, { id: "extension", url: "chrome-extension://extension/popup.html" });
  assert.deepEqual(result, { configured: false });
});

test("popup data diagnostic reports missing saved settings without starting a network lookup", async () => {
  delete data.boundSettings;
  const result = await send({ type: "BOUND_DATA_DIAGNOSTIC_V1" }, { id: "extension", url: "chrome-extension://extension/popup.html" });
  assert.deepEqual(result, { configured: false });
});

test("warning decisions require the matching browser window and extension page", async () => {
  const index = windows.length;
  const pending = send(await message({ topOrigin: "https://attacker.example", frameOrigin: "https://attacker.example" }), page);
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  const get = { type: "BOUND_GET_V1", id };
  const decide = { type: "BOUND_DECISION_V1", id, action: "continue" };
  for (const sender of [
    warningSender(window, { url: `https://attacker.example/warning.html?request=${id}` }),
    warningSender(window, { frameId: 1 }),
    warningSender(window, { tab: { windowId: window.id + 1 } }),
    warningSender(window, { url: "chrome-extension://extension/popup.html" }),
    warningSender(window, { url: "chrome-extension://extension/warning.html?request=wrong" })
  ]) {
    assert.equal(await send(get, sender), null);
    assert.deepEqual(await send(decide, sender), { ok: false });
  }
  const details = await send(get, warningSender(window));
  assert.equal(details.topOrigin, "https://top.example");
  assert.equal(details.frameOrigin, "https://frame.example");
  assert.deepEqual(await send({ ...decide, action: "cancel" }, warningSender(window)), { ok: true });
  assert.equal((await pending).action, "cancel");
  assert.deepEqual(await send(decide, warningSender(window)), { ok: false });
});

test("state changes only invalidate requests from their browser frame and document", async () => {
  const index = windows.length;
  const pending = send(await message(), page);
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  listener({ type: "BOUND_STATE_CHANGE_V1", event: "chainChanged" }, { ...page, frameId: 3 }, () => {});
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  listener({ type: "BOUND_STATE_CHANGE_V1", event: "chainChanged" }, { ...page, documentId: "other" }, () => {});
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  listener({ type: "BOUND_STATE_CHANGE_V1", event: "chainChanged" }, page, () => {});
  assert.equal((await pending).action, "cancel");
  assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id, action: "continue" }, warningSender(window)), { ok: false });
});

test("closing the matching warning window cancels its request", async () => {
  const index = windows.length;
  const pending = send(await message(), page);
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  windowRemoved(window.id + 1);
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  windowRemoved(window.id);
  assert.equal((await pending).action, "cancel");
  assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id, action: "continue" }, warningSender(window)), { ok: false });
});

test("warned events are queued after opening and before a decision, without the decision", async () => {
  data.boundObservationQueue = [];
  const signed = { method: "eth_sign", params: [state.accounts[0], "0x00"] };
  const index = windows.length;
  const pending = send(await message({ request: signed, digest: await hash(JSON.stringify(signed)) }), page);
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  assert.equal(data.boundObservationQueue.length, 1);
  assert.deepEqual(Object.keys(data.boundObservationQueue[0]).sort(), ["chain", "kind", "observedAt", "reporterKey", "score", "site"]);
  assert.equal(data.boundObservationQueue[0].score, 0);
  assert.match(data.boundObservationQueue[0].observedAt, /T\d{2}:00:00\.000Z$/);
  assert.equal(data.boundObservationQueue[0].kind, "warned");
  assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id, action: "cancel" }, warningSender(window)), { ok: true });
  assert.equal((await pending).action, "cancel");
  assert.equal(data.boundObservationQueue.length, 1);
});

test("a failed warning window cancels a typed-confirmation request without a warned event", async () => {
  data.boundObservationQueue = [];
  data.boundObservationSeen = {};
  const signed = { method: "eth_sign", params: [state.accounts[0], "0x00"] };
  failCreate = true;
  try {
    const result = await send(await message({ request: signed, digest: await hash(JSON.stringify(signed)) }), page);
    // Required confirmation cannot be bypassed when the warning cannot open.
    assert.equal(result.action, "cancel");
    assert.equal(data.boundObservationQueue.length, 0);
  } finally { failCreate = false; }
});

test("a full observation queue is disclosed without blocking the warning", async () => {
  data.boundObservationQueue = Array.from({ length: 500 }, (_, index) => ({ site: `site${index}.example`, kind: "warned", chain: "1", reporterKey: "key" }));
  data.boundObservationSeen = {};
  delete data.boundObservationQueueError;
  const signed = { method: "eth_sign", params: [state.accounts[0], "0x00"] };
  const index = windows.length;
  const pending = send(await message({ request: signed, digest: await hash(JSON.stringify(signed)) }), page);
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  assert.ok(await send({ type: "BOUND_GET_V1", id }, warningSender(window)));
  assert.equal(data.boundObservationQueueError, true);
  assert.equal(data.boundObservationQueue.length, 500);
  assert.deepEqual(await send({ type: "BOUND_DECISION_V1", id, action: "cancel" }, warningSender(window)), { ok: true });
  assert.equal((await pending).action, "cancel");
});

test("bypass reports from concurrent frames remain visible to later requests", async () => {
  data.boundCoverage = {};
  const tab = { id: 2, url: "https://top.example/" };
  listener({ type: "BOUND_COVERAGE_V1", coverage: "bypass_possible" }, { tab, frameId: 1, documentId: "frame-1" }, () => {});
  listener({ type: "BOUND_COVERAGE_V1", coverage: "bypass_possible" }, { tab, frameId: 2, documentId: "frame-2" }, () => {});
  const index = windows.length;
  const pending = send(await message(), { ...page, tab, frameId: 0, documentId: "top" });
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  const details = await send({ type: "BOUND_GET_V1", id }, warningSender(window));
  assert.equal(details.coverage, "bypass_possible");
  assert.equal(Object.values(data.boundCoverage).filter(item => item.bypassPossible).length >= 2, true);
  await send({ type: "BOUND_DECISION_V1", id, action: "cancel" }, warningSender(window));
  assert.equal((await pending).action, "cancel");
});

test("warning and local history preserve explicit approval pairs", async () => {
  const token = "0x0000000000000000000000000000000000000010";
  const spender = "0x0000000000000000000000000000000000000020";
  const approval = { method: "eth_sendTransaction", params: [{ to: token, data: `0x095ea7b3${spender.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}` }] };
  const index = windows.length;
  const pending = send(await message({ request: approval, digest: await hash(JSON.stringify(approval)) }), { ...page, tab: { id: 4, url: "https://top.example/" } });
  const window = await untilWindow(index);
  const id = new URL(window.url).searchParams.get("request");
  const details = await send({ type: "BOUND_GET_V1", id }, warningSender(window));
  assert.deepEqual(details.approvals, [{ token, spender }]);
  assert.deepEqual(data.boundWarningHistory.at(-1).approvals, [{ token, spender }]);
  await send({ type: "BOUND_DECISION_V1", id, action: "cancel" }, warningSender(window));
  assert.equal((await pending).action, "cancel");
});

test("state changes and navigation during preparation cancel before opening a warning", async () => {
  for (const change of ["state", "navigation"]) {
    const tab = { id: change === "state" ? 6 : 7, url: "https://top.example/" };
    const sender = { ...page, tab };
    let release, enter;
    const wait = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { enter = resolve; });
    blockHistory = { wait, enter };
    const count = windows.length;
    const pending = send(await message(), sender);
    await entered;
    if (change === "state") listener({ type: "BOUND_STATE_CHANGE_V1", event: "chainChanged" }, sender, () => {});
    else tabUpdated(tab.id, { status: "loading" }, tab);
    release();
    assert.equal((await pending).action, "cancel");
    assert.equal(windows.length, count);
  }
});

test("a failed coverage write makes subsequent requests fail closed", async () => {
  const originalSet = storage.set;
  storage.set = async values => {
    if (Object.hasOwn(values, "boundCoverage")) throw new Error("session storage unavailable");
    return originalSet(values);
  };
  try {
    const tab = { id: 3, url: "https://top.example/" };
    listener({ type: "BOUND_COVERAGE_V1", coverage: "bypass_possible" }, { tab, frameId: 1, documentId: "frame" }, () => {});
    const index = windows.length;
    const pending = send(await message(), { ...page, tab, frameId: 0, documentId: "top" });
    const window = await untilWindow(index);
    const id = new URL(window.url).searchParams.get("request");
    const details = await send({ type: "BOUND_GET_V1", id }, warningSender(window));
    assert.equal(details.coverage, "bypass_possible");
    await send({ type: "BOUND_DECISION_V1", id, action: "cancel" }, warningSender(window));
    assert.equal((await pending).action, "cancel");
  } finally { storage.set = originalSet; }
});

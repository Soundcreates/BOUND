import { classifyRequest, cloneRequest } from "../../packages/decoder/index.mjs";
import { canonicalSite, evaluate } from "../../packages/policy-core/index.mjs";
import { observationCandidates, warnedEvent } from "../../packages/policy-core/observations.mjs";
import { enqueue } from "./observation-queue.mjs";
import { anonRpc } from "./anon-rpc-host.mjs";

const pending = new Map();
const rate = new Map();
const MAX_PENDING_PER_FRAME = 8;
const DEADLINE_MS = 55_000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BOUND_REQUEST_V1") {
    handleRequest(message, sender, sendResponse);
    return true;
  }
  if (message?.type === "BOUND_MALFORMED_V1") {
    handleMalformed(message, sender);
    return;
  }
  if (message?.type === "BOUND_ANON_RPC_V1") {
    if (sender.id !== chrome.runtime.id || sender.tab) {
      sendResponse({ error: "unauthorized" });
      return;
    }
    anonRpc(message.request).then(sendResponse, () => sendResponse({ error: "anon_rpc_unavailable" }));
    return true;
  }
  if (message?.type === "BOUND_GET_V1") {
    const entry = pending.get(message.id);
    if (isWarningPage(sender) && entry) sendResponse(entry.details);
    else sendResponse(null);
    return;
  }
  if (message?.type === "BOUND_DECISION_V1") {
    const entry = pending.get(message.id);
    if (!isWarningPage(sender) || !entry || entry.used) {
      sendResponse({ ok: false });
      return;
    }
    if (entry.details.verdict === "escalated" && message.action === "continue" && message.confirmation !== "I UNDERSTAND") {
      sendResponse({ ok: false, error: "confirmation_required" });
      return;
    }
    entry.used = true;
    finish(message.id, message.action === "continue" ? "continue" : "cancel");
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "BOUND_STATE_CHANGE_V1") {
    for (const [id, entry] of pending) {
      if (entry.details.tabId === sender.tab?.id && entry.details.frameId === sender.frameId && entry.details.documentId === sender.documentId) finish(id, "cancel");
    }
  }
  if (message?.type === "BOUND_COVERAGE_V1" && message.coverage === "bypass_possible" && sender.tab?.id !== undefined) {
    setCoverage(sender.tab.id, sender.frameId, sender.documentId, "bypass_possible").catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) {
    invalidate((item) => item.tabId === tabId);
    clearCoverage(tabId).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  invalidate((item) => item.tabId === tabId);
  clearCoverage(tabId).catch(() => {});
});

async function handleRequest(message, sender, sendResponse) {
  const frameKey = `${sender.tab?.id}:${sender.frameId}:${sender.documentId || sender.url}`;
  const now = Date.now();
  const recent = (rate.get(frameKey) || []).filter((at) => now - at < 10_000);
  if (recent.length >= MAX_PENDING_PER_FRAME || pending.size >= 128) {
    sendResponse({ action: "cancel" });
    return;
  }
  recent.push(now);
  rate.set(frameKey, recent);

  let request, bytes;
  try {
    request = cloneRequest(message.request);
    bytes = JSON.stringify(request);
    if (new TextEncoder().encode(bytes).length > 262144) throw new TypeError("Oversized request");
  } catch {
    sendResponse({ action: "cancel" });
    return;
  }
  const digest = await sha256(bytes);
  const stateDigest = await sha256(JSON.stringify(message.state ?? null));
  if (digest !== message.digest || stateDigest !== message.stateDigest) {
    sendResponse({ action: "cancel", digest: message.digest, stateDigest: message.stateDigest });
    return;
  }
  const classification = classifyRequest(request);
  if (classification.kind === "read_only") {
    sendResponse({ action: "continue", digest, stateDigest, readOnly: true });
    return;
  }
  const locked = !validProviderState(message.state);
  const evaluated = evaluate({ classification, baseline: null, signerAccounts: locked ? [] : message.state.accounts });
  const id = crypto.randomUUID();
  const details = {
    id,
    method: classification.method,
    target: classification.entries.find((entry) => entry.role === "called")?.address || request.params?.[0]?.to || "",
    kind: classification.kind,
    verdict: evaluated.verdict,
    score: evaluated.score,
    reasons: locked ? [...evaluated.reasons, "Wallet chain/account state is unavailable."] : evaluated.reasons,
    entries: classification.entries,
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    documentId: sender.documentId,
    topOrigin: originOf(sender.tab?.url),
    frameOrigin: originOf(sender.url),
    chainId: locked ? null : message.state.chainId,
  };
  const coverage = locked || classification.kind === "unsupported" ? "unsupported" : "mediated";
  details.coverage = coverage;
  details.locked = locked;
  if (sender.tab?.id !== undefined) setCoverage(sender.tab.id, sender.frameId, sender.documentId, coverage).catch(() => {});
  if (!locked && evaluated.score !== null && evaluated.score <= 39) await enqueue([warnedEvent({ site: siteFrom(sender.tab?.url), chain: message.state.chainId })]).catch(() => {});
  await recordWarning(details).catch(() => {});
  const result = new Promise((resolve) => {
    const timer = setTimeout(() => finish(id, "cancel"), DEADLINE_MS);
    pending.set(id, { details, resolve, timer, used: false });
  });
  chrome.windows.create({
    url: chrome.runtime.getURL(`warning.html?request=${encodeURIComponent(id)}`),
    type: "popup",
    width: 440,
    height: 600
  }).catch(() => finish(id, "cancel"));
  result.then((action) => {
    if (!locked && action === "continue" && ["green", "amber"].includes(evaluated.verdict)) {
      enqueue(observationCandidates({
        site: siteFrom(sender.tab?.url),
        chain: message.state?.chainId || "unknown",
        classification,
        request,
        accounts: message.state?.accounts || []
      })).catch(() => {});
    }
    sendResponse({ action: locked ? "cancel" : action, digest, stateDigest, readOnly: false });
  });
}

function handleMalformed(message, sender) {
  if (sender.tab?.id === undefined || typeof message.id !== "string") return;
  const frameKey = `${sender.tab.id}:${sender.frameId}:${sender.documentId || sender.url}`;
  const now = Date.now();
  const recent = (rate.get(frameKey) || []).filter((at) => now - at < 10_000);
  if (recent.length >= MAX_PENDING_PER_FRAME || pending.size >= 128) return;
  recent.push(now);
  rate.set(frameKey, recent);
  const id = crypto.randomUUID();
  const details = {
    id,
    method: String(message.method || "unknown").slice(0, 100),
    target: "Not decoded",
    kind: "malformed",
    verdict: "red",
    score: 35,
    reasons: ["Request could not be frozen safely; it was cancelled."],
    entries: [],
    coverage: "mediated",
    malformed: true,
    tabId: sender.tab.id,
    frameId: sender.frameId,
    documentId: sender.documentId,
    topOrigin: originOf(sender.tab.url),
    frameOrigin: originOf(sender.url),
    chainId: null
  };
  const timer = setTimeout(() => finish(id, "cancel"), DEADLINE_MS);
  pending.set(id, { details, resolve: () => {}, timer, used: false });
  setCoverage(sender.tab.id, sender.frameId, sender.documentId, "mediated").catch(() => {});
  recordWarning(details).catch(() => {});
  chrome.windows.create({
    url: chrome.runtime.getURL(`warning.html?request=${encodeURIComponent(id)}`),
    type: "popup",
    width: 440,
    height: 600
  }).catch(() => finish(id, "cancel"));
}

function finish(id, action) {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(action);
}
function invalidate(predicate) {
  for (const [id, entry] of pending) if (predicate(entry.details)) finish(id, "cancel");
}
async function setCoverage(tabId, frameId, documentId, value) {
  const { boundCoverage = {} } = await chrome.storage.session.get("boundCoverage");
  const key = `${tabId}:${frameId}:${documentId || "unknown"}`;
  const bypassPossible = value === "bypass_possible" || boundCoverage[key]?.bypassPossible === true;
  boundCoverage[key] = { tabId, frameId, documentId, value, bypassPossible };
  await chrome.storage.session.set({ boundCoverage });
  const frames = Object.values(boundCoverage).filter((item) => item.tabId === tabId);
  const current = frames.some((item) => item.bypassPossible) ? "bypass_possible" : frames.some((item) => item.value === "unsupported") ? "unsupported" : frames.some((item) => item.value === "mediated") ? "mediated" : "";
  chrome.action.setBadgeText({ tabId, text: current === "bypass_possible" ? "BYP" : current === "unsupported" ? "UNS" : current === "mediated" ? "MED" : "" });
  if (current) chrome.action.setBadgeBackgroundColor({ tabId, color: current === "bypass_possible" ? "#a52a2a" : current === "unsupported" ? "#7c5b13" : "#1e6045" });
}
async function clearCoverage(tabId) {
  const { boundCoverage = {} } = await chrome.storage.session.get("boundCoverage");
  for (const [key, item] of Object.entries(boundCoverage)) if (item.tabId === tabId) delete boundCoverage[key];
  await chrome.storage.session.set({ boundCoverage });
  chrome.action.setBadgeText({ tabId, text: "" });
}
async function recordWarning(details) {
  const { boundWarningHistory = [] } = await chrome.storage.local.get("boundWarningHistory");
  boundWarningHistory.push({
    time: Date.now(),
    site: details.topOrigin,
    frame: details.frameOrigin,
    method: details.method,
    chainId: details.chainId,
    verdict: details.verdict,
    score: details.score,
    entries: (details.entries || []).map(({ address, role }) => ({ address, role }))
  });
  await chrome.storage.local.set({ boundWarningHistory: boundWarningHistory.slice(-50) });
}
function isWarningPage(sender) {
  if (typeof sender.url !== "string" || sender.frameId !== 0) return false;
  try {
    const actual = new URL(sender.url);
    const expected = new URL(chrome.runtime.getURL("warning.html"));
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch { return false; }
}
function originOf(value) {
  try { return new URL(value).origin; } catch { return "unknown"; }
}
function validProviderState(state) {
  return Boolean(state && typeof state.chainId === "string" && /^0x[0-9a-f]+$/i.test(state.chainId) &&
    Array.isArray(state.accounts) && state.accounts.length <= 32 && state.accounts.every((account) => typeof account === "string" && /^0x[0-9a-f]{40}$/i.test(account)));
}
function siteFrom(value) {
  return canonicalSite(value) || "unknown";
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

import { assessFrontend, frontendObservationCandidates, isFrontendPath, isFrontendHash } from "../../packages/policy-core/frontend.mjs";
import { createFrontendRedirect } from "./frontend-redirect.mjs";
import { createTicketStore, createTicketMessageHandler } from "./ticket-store.mjs";
import { applyFrontendWarning } from "./frontend-routing.mjs";
import { classifyRequest, cloneRequest } from "../../packages/decoder/index.mjs";
import { canonicalSite, evaluate } from "../../packages/policy-core/index.mjs";
import { mayRecordObservation, observationCandidates, warningCandidates } from "../../packages/policy-core/observations.mjs";
import { createObservationDispatcher } from "./observation-dispatcher.mjs";
import { sendObservationBatch, isObservationConfigured } from "./watcher-adapter.mjs";
import { createDecisionContext, readFrontendContext, readPreconnectionSiteStatus } from "./decision-context.mjs";
import { decisionAdapters, getWatcherOwner } from "./trust-adapter.mjs";
import { anonRpc } from "./anon-rpc-host.mjs";
import { createNetworkCapture, isCapturePage } from "./network-capture.mjs";
import { scoreConnection } from "./connection-score.mjs";
import { SCORE_SETTINGS } from "./score-settings.mjs";
import { ensureDefaultSettings } from "./settings.mjs";

const pending = new Map();
const pendingObservations = new Map();
const rate = new Map();
const tabRevisions = new Map();
const frameRevisions = new Map();
const statusRequests = new Map();
const networkCapture = chrome.debugger ? createNetworkCapture({
  api: chrome.debugger,
  onDetach: (_source, reason) => {
    if (reason === "canceled_by_user") {
      chrome.storage.local.set({ boundMonitoring: false }).catch(() => {});
    }
  }
}) : null;
const MAX_PENDING_PER_FRAME = 8;
// The user decides; BOUND only gives up on a warning nobody answers for this long.
// Deadline timers call timer?.unref?.(): a browser timer id is a number with no unref,
// and under Node's test runner unref lets the process exit instead of waiting it out.
const DEADLINE_MS = 10 * 60_000;
// Only these prompt the wallet to grant access; they always get a BOUND review.
const CONNECTION_METHODS = new Set(["eth_requestAccounts", "wallet_requestPermissions", "wallet_createSession"]);
const TIER_VERDICT = { pass: "green", warning: "amber", huge: "red", firewall: "escalated" };
function connectionTier(connectionScore, allowed) {
  const score = connectionScore.score, blockers = connectionScore.blockers || [];
  const huge = SCORE_SETTINGS.connection?.huge ?? 40, firewall = SCORE_SETTINGS.connection?.firewall ?? 16;
  // Detected danger is always the loudest tier, whatever the arithmetic says.
  if (blockers.some(item => /incident|drift/i.test(item))) return "firewall";
  if (allowed) return "pass";
  if (score < firewall) return "firewall";
  if (score < huge || blockers.length) return "huge";
  return "warning";
}
const STATUS_ALARM = "bound-site-status-refresh";
const STATUS_EXPIRY_PREFIX = "bound-site-status-expiry:";
let coverageOperation = Promise.resolve();
let coverageUncertain = false;
let settingsRevision = 0;
let settingsEpoch = 0;
const tickets = createTicketStore({storage: chrome.storage.session, extensionId: chrome.runtime.id});
const ticketReady = (async () => {
  await chrome.storage.session.setAccessLevel?.({accessLevel: "TRUSTED_CONTEXTS"});
  settingsRevision = await tickets.revision();
})();
const redirect = createFrontendRedirect({api: {tabs: chrome.tabs, webNavigation: {getFrame: browserFrame}, alarms: chrome.alarms, runtime: chrome.runtime, getSettings: async () => {
  const {boundSettings = {}} = await chrome.storage.local.get("boundSettings");
  return {safePageUrl: boundSettings.safePageUrl || "", watcherOwner: await getWatcherOwner()};
}}, tickets});
const confirmTicket = createTicketMessageHandler({tickets, extensionId: chrome.runtime.id,
  confirmUrl: chrome.runtime.getURL("confirm.html"), navigate: (tabId, url) => chrome.tabs.update(tabId, {url})});
const guardWaiters = new Map();
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k));
async function guardRetry(message, sender) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,"0")).join("");
  const key = `${sender.tab.id}:${sender.documentId}:${message.id}`;
  if (guardWaiters.has(key)) return false;
  return new Promise(resolve => {
    const timer = setTimeout(() => {guardWaiters.delete(key); resolve(false);}, 500);
    guardWaiters.set(key, {sender, message, nonce, resolve: result => {clearTimeout(timer); guardWaiters.delete(key); resolve(result);}});
    Promise.resolve(chrome.tabs.sendMessage(sender.tab.id, {type:"BOUND_RETRY_GUARD_V1",id:message.id,digest:message.digest,stateDigest:message.stateDigest,nonce}, {documentId:sender.documentId})).catch(() => guardWaiters.get(key)?.resolve(false));
  });
}
chrome.webNavigation.onCommitted?.addListener(details => { void ticketReady.then(() => redirect.handleNavigation(details)).catch(() => {}); });
chrome.webNavigation.onErrorOccurred?.addListener(details => { void ticketReady.then(() => redirect.handleNavigation(details)).catch(() => {}); });
chrome.alarms.onAlarm.addListener(alarm => { void ticketReady.then(() => redirect.onAlarm(alarm)).catch(() => {}); });
void ticketReady.then(() => redirect.resume()).catch(() => {});
const dispatcher = createObservationDispatcher({ send: sendObservationBatch });
async function enqueueReports(records) {
  if (!records.length || !(await monitoringEnabled())) return;
  try { await dispatcher.enqueue(records); }
  catch { await chrome.storage.local.set({ boundObservationQueueError: true }).catch(() => {}); }
}

// Monitoring is opt-in. Until the user clicks Start monitoring in the popup, BOUND
// injects nothing into pages, checks no request, records nothing, reads no trust
// data and sends no report: every wallet request goes straight to the wallet.
let monitoringCache = null;
async function monitoringEnabled() {
  if (monitoringCache === null) {
    const { boundMonitoring } = await chrome.storage.local.get("boundMonitoring");
    monitoringCache = boundMonitoring === true;
  }
  return monitoringCache;
}

// Page scripts exist only while monitoring is on. They are registered on Start and
// removed on Stop, so a page loaded while monitoring is off runs no BOUND code at
// all. Open tabs keep whatever they loaded with until they are reloaded.
const PAGE_MATCHES = ["http://127.0.0.1/*", "http://localhost/*", "https://*/*"];
const PAGE_SCRIPTS = [
  { id: "bound-hook", js: ["hook.js"], world: "MAIN" },
  { id: "bound-relay", js: ["relay.js", "frontend-collector.js"], world: "ISOLATED" }
].map((script) => ({ ...script, matches: PAGE_MATCHES, runAt: "document_start", allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true }));
const QUEUE_KEYS = ["boundObservationQueue", "boundObservationDispatchAt", "boundObservationGeneration", "boundObservationScheduledGeneration", "boundObservationRetry"];
let monitoringOperation = Promise.resolve();
function applyMonitoring(on) {
  monitoringOperation = monitoringOperation.catch(() => {}).then(async () => {
    const scripting = chrome.scripting;
    if (scripting?.getRegisteredContentScripts) {
      const ids = PAGE_SCRIPTS.map((script) => script.id);
      const registered = (await scripting.getRegisteredContentScripts({ ids })).map((script) => script.id);
      if (on) {
        const missing = PAGE_SCRIPTS.filter((script) => !registered.includes(script.id));
        if (missing.length) await scripting.registerContentScripts(missing);
      } else if (registered.length) await scripting.unregisterContentScripts({ ids: registered });
    }
    if (on) {
      if (decisionAdapters) await chrome.alarms.create(STATUS_ALARM, { periodInMinutes: 5 });
      return;
    }
    // Consent withdrawn: reports not yet sent are dropped, never sent later.
    await chrome.alarms.clear(dispatcher.alarmName);
    await chrome.storage.local.remove(QUEUE_KEYS);
    await chrome.alarms.clear(STATUS_ALARM);
    for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith(STATUS_EXPIRY_PREFIX)) await chrome.alarms.clear(alarm.name);
    await networkCapture?.stopAll();
  });
  return monitoringOperation;
}
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== "local" || !changes.boundMonitoring) return;
  monitoringCache = changes.boundMonitoring.newValue === true;
  refreshMonitoringBadges(monitoringCache).catch(() => {});
  applyMonitoring(monitoringCache).catch(() => {});
  if (monitoringCache) {
    refreshPublicData().catch(() => {});
    dispatcher.resume().catch(() => {});
  } else {
    // Stopping hands any open warning's request to the wallet rather than dropping it.
    for (const id of [...pending.keys()]) finish(id, "forward");
  }
});
// Reconcile registrations with the stored choice every time the worker starts.
monitoringEnabled().then(on => Promise.all([applyMonitoring(on), refreshMonitoringBadges(on)])).catch(() => {});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === dispatcher.alarmName) monitoringEnabled().then((on) => on && dispatcher.dispatch()).catch(() => {});
});
monitoringEnabled().then((on) => on && dispatcher.resume()).catch(() => {});

// Seed the defaults on first run so requests are checked instead of all scoring
// grey. Decisions wait for this; a failure leaves the extension unconfigured.
const settingsReady = ensureDefaultSettings(chrome.storage.local)
  .then((seeded) => { if (seeded) refreshPublicData().catch(() => {}); })
  .catch(() => {});

// A grey verdict means nothing was checked. Say why, so it never reads as safe.
const UNCHECKED_REASONS = {
  invalid_context: "Not checked: BOUND has no watcher owner for this site and chain. Open BOUND Options and save the settings.",
  snapshot_unavailable: "Not checked: the verified trust snapshot could not be read (ENS or Arkiv unreachable).",
  watcher_baseline_unavailable: "Not checked: no watcher baseline is published for this site and chain.",
  unavailable: "Not checked: BOUND's trust data could not be read.",
};
function uncheckedReason(context) {
  return context.baseline ? null : UNCHECKED_REASONS[context.status] || UNCHECKED_REASONS.unavailable;
}
if (decisionAdapters) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === STATUS_ALARM) refreshPublicData().catch(() => {});
    else if (alarm.name.startsWith(STATUS_EXPIRY_PREFIX)) {
      const tabId = Number(alarm.name.slice(STATUS_EXPIRY_PREFIX.length));
      if (Number.isInteger(tabId)) chrome.tabs.get(tabId).then((tab) => {
        if (tab?.url) return refreshSiteStatus(tabId, tab.url, tabRevisions.get(tabId) || 0);
      }).catch(() => {});
    }
  });
  refreshPublicData().catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["BOUND_CANCEL_DELIVERED_V1", "BOUND_SAFE_READY_V1", "BOUND_SAFE_CONFIRM_V1", "BOUND_TICKET_GET_V1", "BOUND_TICKET_APPROVE_V1"].includes(message?.type)) {
    (async () => { await ticketReady; if (message.type === "BOUND_CANCEL_DELIVERED_V1") return redirect.acknowledge(message,sender);
      await redirect.bindExtensionDocument(sender);
      if (message.type.startsWith("BOUND_SAFE_")) return redirect.handleMessage(message,sender);
      if (!await currentDocument(sender)) return {ok:false};
      return confirmTicket(message,sender);
    })().then(sendResponse, () => sendResponse({ok:false})); return true;
  }
  if (message?.type === "BOUND_RETRY_GUARDED_V1") {
    if (!exact(message,["type","id","digest","stateDigest","nonce"]) || sender.id !== chrome.runtime.id || sender.frameId !== 0) return;
    const key = `${sender.tab?.id}:${sender.documentId}:${message.id}`, waiter = guardWaiters.get(key);
    if (waiter && ["id","digest","stateDigest"].every(k => message[k] === waiter.message[k]) && message.nonce === waiter.nonce && sender.url === waiter.sender.url) {
      currentDocument(sender).then(ok => waiter.resolve(ok), () => waiter.resolve(false));
    }
    return;
  }
  if (message?.type === "BOUND_CAPTURE_V1" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html")) {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!networkCapture || !Number.isInteger(tab?.id)) return { ok: false, error: "Capture unavailable" };
      if (message.action === "start" && !(await monitoringEnabled())) return { ok: false, error: "Start monitoring first. While monitoring is off, BOUND captures nothing." };
      if (message.action === "start" && !isCapturePage(tab.url)) return { ok: false, error: "Open an HTTPS website or a local test page first. Chrome internal pages such as chrome://newtab cannot be captured." };
      if (message.action === "start") await networkCapture.start(tab.id);
      else if (message.action === "stop") await networkCapture.stop(tab.id);
      else if (message.action !== "status") return { ok: false, error: "Invalid action" };
      return { ok: true, capture: networkCapture.snapshot(tab.id) };
    })().then(sendResponse, () => sendResponse({ ok: false, error: "Unable to attach to this page. Close DevTools or another debugger and try again; Chrome may also restrict this page." }));
    return true;
  }
  if (message?.type === "BOUND_SETTINGS_CHANGED_V1" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("options.html")) {
    settingsEpoch++; invalidate(()=>true);
    ticketReady.then(() => tickets.advanceRevision()).then(revision => {settingsRevision = revision; return refreshPublicData();}).then(()=>sendResponse({ok:true}),()=>sendResponse({ok:false}));return true;
  }
  if (message?.type === "BOUND_STATUS_V1" && sender.id === chrome.runtime.id && !sender.tab) {
    isObservationConfigured().then(observationReporting=>sendResponse({ observationReporting }),()=>sendResponse({ observationReporting:false }));
    return true;
  }
  if (message?.type === "BOUND_DATA_DIAGNOSTIC_V1" && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html")) {
    diagnoseData().then(sendResponse, () => sendResponse({ error: "diagnostic_failed" }));
    return true;
  }
  if (message?.type === "BOUND_REQUEST_V1") {
    handleRequest(message, sender, sendResponse).catch(() => sendResponse({action:"cancel",digest:message.digest,stateDigest:message.stateDigest}));
    return true;
  }
  if (message?.type === "BOUND_FORWARDED_V1") {
    monitoringEnabled().then((on) => on ? confirmForwarded(message, sender) : { ok: false }).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "BOUND_MALFORMED_V1") {
    monitoringEnabled().then((on) => on && handleMalformed(message, sender)).catch(() => {});
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
  if (message?.type === "BOUND_GET_V1" || message?.type === "BOUND_DECISION_V1") {
    handleWarningMessage(message, sender).then(sendResponse, () => sendResponse(message.type === "BOUND_GET_V1" ? null : { ok: false }));
    return true;
  }
  if (message?.type === "BOUND_STATE_CHANGE_V1") {
    if (sender.id !== chrome.runtime.id || !exact(message,["type","event"])) return;
    if (sender.frameId === 0 && Number.isInteger(sender.tab?.id)) void ticketReady.then(() => tickets.forTab(sender.tab.id)).then(t => t && tickets.remove(t.id)).catch(() => {});
    const key = `${sender.tab?.id}:${sender.frameId}:${sender.documentId || sender.url}`;
    frameRevisions.set(key, (frameRevisions.get(key) || 0) + 1);
    for (const [id, entry] of pending) {
      if (entry.details.tabId === sender.tab?.id && entry.details.frameId === sender.frameId && entry.details.documentId === sender.documentId) finish(id, "cancel");
    }
  }
  if (message?.type === "BOUND_COVERAGE_V1" && message.coverage === "bypass_possible" && sender.tab?.id !== undefined) {
    monitoringEnabled().then((on) => on && setCoverage(sender.tab.id, sender.frameId, sender.documentId, "bypass_possible")).catch(() => {});
  }
});

async function diagnoseData() {
  const { boundSettings } = await chrome.storage.local.get("boundSettings");
  const configured = Boolean(boundSettings?.ensRootName && boundSettings?.ensResolver && boundSettings?.arkivRpcUrl && boundSettings?.watcherOwner && boundSettings?.anonBootstrapUrl && boundSettings?.anonRpcUrl && boundSettings?.anonWorkerId === "nox");
  if (!configured) return { configured: false };
  const [ens, arkiv] = await Promise.all([anonRpc({ method: "eth_chainId" }), anonRpc({ network: "arkiv", method: "eth_chainId" })]);
  const result = { configured: true, anonymousEns: ens?.result === "0xaa36a7" ? "ok" : (ens?.error || "unexpected_chain"), anonymousArkiv: arkiv?.result === "0x76edaf" ? "ok" : (arkiv?.error || "unexpected_chain") };
  if (result.anonymousEns !== "ok" || result.anonymousArkiv !== "ok") return result;
  try { await decisionAdapters.readVerifiedSnapshot(); result.snapshot = "ok"; }
  catch { result.snapshot = "unavailable"; return result; }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return { ...result, siteStatus: "no_active_site" };
  const owner = await getWatcherOwner();
  const status = await readPreconnectionSiteStatus({ siteOrigin: tab.url, watcherOwner: owner, adapters: decisionAdapters });
  return { ...result, siteStatus: status.status, evidence: status.evidence };
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "loading" || change.url) {
    networkCapture?.reset(tabId);
    tabRevisions.set(tabId, (tabRevisions.get(tabId) || 0) + 1);
    invalidate((item) => item.tabId === tabId);
    clearCoverage(tabId).catch(() => {});
    if (decisionAdapters && (change.url || tab?.url)) {
      refreshSiteStatus(tabId, change.url || tab.url, tabRevisions.get(tabId)).catch(() => {});
    }
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void ticketReady.then(() => tickets.removeTab(tabId)).catch(() => {});
  networkCapture?.stop(tabId).catch(() => {});
  tabRevisions.set(tabId, (tabRevisions.get(tabId) || 0) + 1);
  statusRequests.delete(tabId);
  invalidate((item) => item.tabId === tabId);
  clearCoverage(tabId).catch(() => {});
});
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, entry] of pending) if (entry.windowId === windowId) finish(id, "cancel");
});

// Hand the page's request to the wallet unscored. BOUND never refuses a request;
// when it cannot score one it says so and lets the wallet and the user decide.
function passThrough(message, sendResponse) {
  sendResponse({ action: "continue", digest: message.digest, stateDigest: message.stateDigest, readOnly: true });
}

async function handleRequest(message, sender, sendResponse) {
  await ticketReady;
  const frameKey = `${sender.tab?.id}:${sender.frameId}:${sender.documentId || sender.url}`;
  const tabRevision = tabRevisions.get(sender.tab?.id) || 0;
  const frameRevision = frameRevisions.get(frameKey) || 0;
  const revision=settingsRevision, epoch=settingsEpoch;
  const valid = () => settingsEpoch===epoch && settingsRevision===revision && (tabRevisions.get(sender.tab?.id) || 0) === tabRevision && (frameRevisions.get(frameKey) || 0) === frameRevision;
  let request, bytes;
  try {
    request = cloneRequest(message.request);
    bytes = JSON.stringify(request);
    if (new TextEncoder().encode(bytes).length > 262144) throw new TypeError("Oversized request");
  } catch {
    sendResponse({ action: "cancel" });
    return;
  }
  let stateBytes;
  try {
    stateBytes = JSON.stringify(message.state ?? null);
    if (typeof stateBytes !== "string" || stateBytes.length > 8192) throw new TypeError("Oversized provider state");
  } catch {
    sendResponse({ action: "cancel", digest: message.digest, stateDigest: message.stateDigest });
    return;
  }
  const digest = await sha256(bytes);
  const stateDigest = await sha256(stateBytes);
  if (digest !== message.digest || stateDigest !== message.stateDigest) {
    sendResponse({ action: "cancel", digest: message.digest, stateDigest: message.stateDigest });
    return;
  }
  const classification = classifyRequest(request);
  // Passive reads (including already-granted accounts) never open UI and do not
  // consume the interactive rate limit: real dApps poll these constantly. The
  // wallet itself only discloses accounts the site was already granted.
  if (classification.kind === "read_only" && !CONNECTION_METHODS.has(request.method)) {
    sendResponse({ action: "continue", digest, stateDigest, readOnly: true });
    return;
  }
  const chainId = validProviderState(message.state) ? String(BigInt(message.state.chainId)) : null;
  const approved = sender.id === chrome.runtime.id && sender.frameId === 0 && chainId && originOf(sender.url) === originOf(sender.tab?.url) && await currentDocument(sender)
    ? await tickets.findApproved({tabId:sender.tab.id,documentId:sender.documentId,topOrigin:originOf(sender.url),chainId,settingsRevision:revision}) : null;
  if (!(await monitoringEnabled())) { if (approved) sendResponse({action:"cancel",digest,stateDigest}); else passThrough(message,sendResponse); return; }
  const now = Date.now();
  const recent = (rate.get(frameKey) || []).filter((at) => now - at < 10_000);
  if (recent.length >= MAX_PENDING_PER_FRAME || pending.size >= 128) {
    // Under load, hand the intact request to the wallet instead of refusing it.
    sendResponse(approved ? {action:"cancel",digest,stateDigest} : { action: "continue", digest, stateDigest, readOnly: true });
    return;
  }
  recent.push(now);
  rate.set(frameKey, recent);
  const eligibleFrontend = validProviderState(message.state) && classification.kind !== "unsupported";
  const frontendPromise = eligibleFrontend ? readFrontendEvidence(sender) : Promise.resolve(null);
  const incidentHistoryPromise = eligibleFrontend && sender.frameId === 0 && originOf(sender.url) === originOf(sender.tab?.url) ? (async()=>{
    let timer;try {return await Promise.race([decisionAdapters.readIncidentHistory({site:siteFrom(sender.url),chain:chainId}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),8000);})]);}
    catch{return null;}finally{clearTimeout(timer);}
  })() : Promise.resolve(null);
  const registryPromise = eligibleFrontend && sender.frameId === 0 && originOf(sender.url) === originOf(sender.tab?.url) ? (async () => {
    try {
      const observed = await frontendPromise;
      let timer;
      try { return await Promise.race([decisionAdapters.readEnsRegistry({siteOrigin:sender.url,observed}), new Promise(resolve => { timer=setTimeout(() => resolve({status:'unavailable',reason:'ENS registry lookup timed out'}),8000); })]); }
      finally { clearTimeout(timer); }
    } catch { return {status:'unavailable',reason:'ENS registry lookup failed'}; }
  })() : Promise.resolve({status:'unavailable',reason:'Registry comparison requires a top-level supported request'});
  const communityPromise = eligibleFrontend ? (async () => { try { await settingsReady; return await readFrontendContext({ siteOrigin: sender.url, chainId: message.state.chainId, watcherOwner: await getWatcherOwner(), adapters: decisionAdapters }); } catch { return null; } })() : Promise.resolve(null);
  const frontendAssessment = async (counterpartyRisk = false) => {
    const [evidence, community, registry, incidentHistory] = await Promise.all([frontendPromise, communityPromise, registryPromise, incidentHistoryPromise]);
    const c = community || {state:'unavailable', ageMs:null, frontend:null, corroboratedDrift:false, activeIncident:false, ambiguous:false};
    const frame = {isTop:sender.frameId === 0, sameOrigin:originOf(sender.url) === originOf(sender.tab?.url), ambiguous:c.ambiguous};
    const assessment = assessFrontend({observed:evidence, record:c.frontend, now:Date.now(), drift:c.corroboratedDrift, incident:c.activeIncident, counterpartyRisk, frame, dataState:c.state, ageMs:c.ageMs});
    return {evidence, community:c, frame, assessment, registry, incidentHistory};
  };
  const routeFrontend = async (details, frontendData) => {
    const assessment = frontendData.assessment;
    if (approved && assessment.comparison === "conflict") {
      if (!valid()) return {cancel:true};
      const guarded = await guardRetry(message,sender);
      const current = await currentDocument(sender);
      if (!current) await tickets.remove(approved.id);
      if (!guarded || !current || !valid() || !await monitoringEnabled()) return {cancel:true};
      const consumed = await tickets.consume({tabId:sender.tab.id,documentId:sender.documentId,topOrigin:originOf(sender.url),chainId,settingsRevision:revision,comparison:"conflict",requestId:message.id,digest,stateDigest});
      if (!consumed || !valid() || !await monitoringEnabled()) return {cancel:true};
      return {overrideUsed:true};
    }
    if (!approved && valid() && await monitoringEnabled()) {
      const {boundSettings = {}} = await chrome.storage.local.get("boundSettings");
      const result = await redirect.begin({sender,requestId:message.id,digest,stateDigest,details,assessment,chainId,settingsRevision:revision,safePageUrl:boundSettings.safePageUrl || ""});
      if (result) { if (!valid() || !await monitoringEnabled() || !await currentDocument(sender)) {await tickets.remove(result.ticket); return {cancel:true};} return {result}; }
    }
    return {};
  };
  if (CONNECTION_METHODS.has(request.method)) {
    let statuses = [];
    const origins = [...new Set([originOf(sender.tab?.url), originOf(sender.url)])];
    try {
      const owner = await getWatcherOwner();
      if (origins.every(origin => origin !== "unknown" && origin !== "null")) {
        statuses = await Promise.all(origins.map(siteOrigin => readPreconnectionSiteStatus({ siteOrigin, watcherOwner: owner, adapters: decisionAdapters })));
      }
    } catch { /* Missing evidence blocks the connection. */ }
    const connectionScore = scoreConnection({ origins: origins.map((origin, index) => ({ origin, status: statuses[index] })), providerValid: validProviderState(message.state) });
    // A connection is never refused on score: "verified" only decides whether the
    // review is a quiet pass or a louder tier the user has to read.
    const silentPass = connectionScore.verified;
    if (!valid() || !(await currentDocument(sender))) {
      sendResponse({ action: "cancel", digest, stateDigest, connectionStatus: "unknown" });
      return;
    }
    const connectionStatus = statuses.some(item => item.status === "active") ? "active" : statuses.some(item => item.status === "drift") ? "drift" : "unknown";
    const connectionCoverage = await bypassPossible(sender.tab.id) ? "bypass_possible" : "mediated";
    await setCoverage(sender.tab.id, sender.frameId, sender.documentId, connectionCoverage).catch(() => {});
    // Every connection request gets a review; the score only sets its severity.
    const tier = connectionTier(connectionScore, silentPass);
    const reason = `Connection score ${connectionScore.score}/100; silent-pass threshold ${connectionScore.threshold}. ${connectionScore.blockers.join('; ') || (silentPass ? 'Connection checks passed.' : 'Some checks failed or are unavailable.')}`;
    const id = crypto.randomUUID();
    const frontendData = await frontendAssessment();
    let details = {
      id, kind: "connection", method: request.method, target: "", tier, verdict: TIER_VERDICT[tier], score: connectionScore.score,
      connectionScore, connectionStatus, reasons: [reason], entries: [], approvals: [], coverage: connectionCoverage, locked: !validProviderState(message.state),
      tabId: sender.tab?.id, frameId: sender.frameId, documentId: sender.documentId,
      topOrigin: originOf(sender.tab?.url), frameOrigin: originOf(sender.url), chainId: message.state?.chainId ?? null,
      incidentStatus: connectionStatus === "active" ? "active" : statuses.length && statuses.every(item => item.status === "normal") ? "normal" : "unknown",
      frontend: frontendData.evidence, frontendRegistry: frontendData.registry, incidentHistory:frontendData.incidentHistory
    };
    details = applyFrontendWarning({details, assessment: frontendData.assessment});
    const route = await routeFrontend(details, frontendData);
    if (route.result || route.cancel) {sendResponse(route.result || {action:"cancel",digest,stateDigest}); return;}
    details = applyFrontendWarning({details, assessment: frontendData.assessment, overrideUsed:route.overrideUsed});
    await recordWarning({ ...details, verdict: `connection · ${tier}` }).catch(() => {});
    if (!valid() || pending.size >= 128 || !(await currentDocument(sender)) || !valid() || route.overrideUsed && !(await monitoringEnabled())) {
      sendResponse({ action: "cancel", digest, stateDigest });
      return;
    }
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => finish(id, "forward"), DEADLINE_MS);
      timer?.unref?.();
      pending.set(id, { details, resolve, timer, used: false });
    });
    openWarning(id);
    result.then((action) => {
      let receiptToken;
      if ((action === 'continue' || action === 'forward') && pendingObservations.size < 128) {
        receiptToken = crypto.randomUUID(); const timer = setTimeout(() => pendingObservations.delete(receiptToken), 10000);
        pendingObservations.set(receiptToken, {timer, sender, digest, stateDigest, valid, classification, request, state:message.state, coverage:connectionCoverage, frontendData, verdict:details.verdict, incidentStatus:details.incidentStatus, connection:true});
      }
      sendResponse({ action: action === "forward" ? "continue" : action, digest, stateDigest, readOnly: false, connectionScore: { score: connectionScore.score, threshold: connectionScore.threshold }, ...(silentPass ? {} : { connectionStatus }), ...(receiptToken ? {receiptToken} : {}), ...(route.overrideUsed && action === "continue" ? {typedApproved:true} : {}) });
    });
    return;
  }
  if (classification.kind === "read_only") {
    sendResponse({ action: "continue", digest, stateDigest, readOnly: true });
    return;
  }
  const locked = !validProviderState(message.state);
  const bypass = sender.tab?.id !== undefined && await bypassPossible(sender.tab.id);
  const coverage = locked || classification.kind === "unsupported" ? "unsupported" : bypass ? "bypass_possible" : "mediated";
  let context = { baseline: null, incidentStatus: "unknown" };
  if (!locked && decisionAdapters) {
    try { await settingsReady; const watcherOwner=await getWatcherOwner();context = await createDecisionContext({ siteOrigin: sender.tab?.url, chainId: message.state.chainId, watcherOwner, adapters: decisionAdapters }); }
    catch { /* Unavailable policy data leaves the request grey. */ }
  }
  const frontendData = await frontendAssessment(false);
  if (!valid() || !(await currentDocument(sender)) || !valid()) { sendResponse({ action: "cancel", digest, stateDigest }); return; }
  const evaluated = evaluate({ classification, ...context, signerAccounts: locked ? [] : message.state.accounts, coverage, thresholds: SCORE_SETTINGS.transaction });
  const id = crypto.randomUUID();
  frontendData.assessment = (await frontendAssessment(evaluated.counterpartyRisk)).assessment;
  let details = {
    id,
    method: classification.method,
    target: classification.entries.find((entry) => entry.role === "called")?.address || request.params?.[0]?.to || "",
    kind: classification.kind,
    checkEvidence: {
      snapshotVerified: context.snapshotAvailable === true ? true : null,
      siteMatched: context.siteMatched ?? null,
      watcherLookup: context.watcherBaselineAvailable === true ? true : null,
      watcherStatus: context.incidentStatus || "unknown",
      walletAvailable: !locked
    },
    verdict: evaluated.verdict,
    score: evaluated.score,
    reasons: [...(locked ? [...evaluated.reasons, "Wallet chain/account state is unavailable."] : evaluated.reasons), ...(!locked && evaluated.verdict === "grey" && evaluated.coverage !== "unsupported" && uncheckedReason(context) ? [uncheckedReason(context)] : [])],
    entries: classification.entries,
    frontend: frontendData.evidence,
    frontendRegistry: frontendData.registry,
    incidentHistory: frontendData.incidentHistory,
    networkCapture: networkCapture?.snapshot(sender.tab?.id) || { active: false, rows: [], missing: 0 },
    observedAddresses: [...new Set(classification.entries.filter(entry => entry.verified !== false && typeof entry.address === "string" && context.observed?.has(entry.address.toLowerCase())).map(entry => entry.address.toLowerCase()))],
    approvals: classification.approvals || [],
    tabId: sender.tab?.id,
    frameId: sender.frameId,
    documentId: sender.documentId,
    topOrigin: originOf(sender.tab?.url),
    frameOrigin: originOf(sender.url),
    chainId: locked ? null : message.state.chainId,
    incidentStatus: context.incidentStatus || "unknown",
    ensLookup: context.ensLookup?.attestation || null,
    ensInconsistent: context.ensLookup?.inconsistent === true,
  };
  details = applyFrontendWarning({details, assessment: frontendData.assessment});
  const route = await routeFrontend(details, frontendData);
  if (route.result || route.cancel) {sendResponse(route.result || {action:"cancel",digest,stateDigest}); return;}
  details = applyFrontendWarning({details, assessment: frontendData.assessment, overrideUsed:route.overrideUsed});
  details.coverage = coverage;
  details.locked = locked;
  if (sender.tab?.id !== undefined) setCoverage(sender.tab.id, sender.frameId, sender.documentId, coverage).catch(() => {});
  await recordWarning(details).catch(() => {});
  if (!valid() || !(await currentDocument(sender)) || !valid() || route.overrideUsed && !(await monitoringEnabled())) { sendResponse({ action: "cancel", digest, stateDigest }); return; }
  if (pending.size >= 128) { sendResponse({ action: details.requireTypedConfirmation ? "cancel" : "continue", digest, stateDigest, readOnly: true }); return; }
  const result = new Promise((resolve) => {
    // Unanswered for the whole deadline: hand it to the wallet, which still asks the user.
    const timer = setTimeout(() => finish(id, "forward"), DEADLINE_MS);
    timer?.unref?.();
    pending.set(id, { details, resolve, timer, used: false });
  });
  const warnings = !locked && evaluated.score !== null && evaluated.score < SCORE_SETTINGS.transaction.amber
    ? warningCandidates({ site: siteFrom(sender.tab?.url), chain: message.state.chainId, addresses: evaluated.warnedAddresses, request, accounts: message.state.accounts }).map(warning => ({...warning, score:evaluated.score, observedAt:new Date(Math.floor(Date.now()/3600000)*3600000).toISOString()})) : [];
  openWarning(id, warnings);
  result.then((action) => {
    let receiptToken;
    if (!locked && mayRecordObservation({ verdict: evaluated.verdict, incidentStatus: context.incidentStatus, action })) {
      if (pendingObservations.size < 128) {
        receiptToken = crypto.randomUUID();
        const timer = setTimeout(() => pendingObservations.delete(receiptToken), 10_000);
        pendingObservations.set(receiptToken, { timer, sender, digest, stateDigest, valid, classification, request, state: message.state, coverage, frontendData, verdict:evaluated.verdict, incidentStatus:context.incidentStatus });
      }
    }
    // "forward" means the warning could not be shown: hand it to the wallet, record nothing.
    sendResponse({ action: action === "forward" ? "continue" : action, digest, stateDigest, readOnly: false, ...(receiptToken ? { receiptToken } : {}), ...(route.overrideUsed && action === "continue" ? {typedApproved:true} : {}) });
  });
}

async function readFrontendEvidence(sender) {
  if (!Number.isInteger(sender.tab?.id) || typeof sender.documentId !== "string" || typeof chrome.tabs.sendMessage !== "function") return null;
  let timer;
  try {
    const evidence = await Promise.race([
      chrome.tabs.sendMessage(sender.tab.id, { type: "BOUND_COLLECT_FRONTEND_V1" }, { documentId: sender.documentId }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("frontend collection timeout")), 1200); })
    ]);
    const fields = ['total','compared','inlineExcluded','queryExcluded','crossOriginExcluded','privatePathExcluded','unavailable','overCap'];
    if (!evidence || evidence.version !== 1 || evidence.documentUrl !== sender.url || new TextEncoder().encode(JSON.stringify(evidence)).length > 32768 || !Array.isArray(evidence.scripts) || evidence.scripts.length > 32 || !evidence.scripts.every(item => isFrontendPath(item.path) && isFrontendHash(item.hash)) || !evidence.coverage || !fields.every(k => Number.isSafeInteger(evidence.coverage[k]) && evidence.coverage[k] >= 0) || evidence.coverage.total > 100000 || fields.slice(1).reduce((n,k) => n + evidence.coverage[k],0) !== evidence.coverage.total || evidence.coverage.compared !== evidence.scripts.length) return null;
    return evidence;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function confirmForwarded(message, sender) {
  const entry = pendingObservations.get(message?.receiptToken);
  if (!entry || sender.id !== chrome.runtime.id || sender.tab?.id !== entry.sender.tab?.id || sender.frameId !== entry.sender.frameId || sender.documentId !== entry.sender.documentId || message.digest !== entry.digest || message.stateDigest !== entry.stateDigest) return { ok: false };
  pendingObservations.delete(message.receiptToken);
  clearTimeout(entry.timer);
  if (!entry.valid() || !(await currentDocument(sender)) || !entry.valid()) return { ok: false };
  await enqueueCurrentObservation(entry);
  return { ok: true };
}

async function enqueueCurrentObservation({ classification, request, state, sender, coverage, frontendData, verdict, incidentStatus, connection, valid }) {
  if (!decisionAdapters) return;
  await settingsReady;const watcherOwner=await getWatcherOwner();if(!watcherOwner)return;
  const community = await readFrontendContext({siteOrigin:sender.url, chainId:state.chainId, watcherOwner, adapters:decisionAdapters});
  const currentStatus = connection ? await readPreconnectionSiteStatus({siteOrigin:sender.url, watcherOwner, adapters:decisionAdapters}) : null;
  const latest = connection ? null : await createDecisionContext({ siteOrigin: sender.tab?.url, chainId: state.chainId, watcherOwner, adapters: decisionAdapters });
  const currentCoverage = sender.tab?.id !== undefined && await bypassPossible(sender.tab.id) ? "bypass_possible" : coverage;
  const evaluated = connection ? null : evaluate({ classification, ...latest, signerAccounts: state.accounts, coverage: currentCoverage, thresholds: SCORE_SETTINGS.transaction });
  if (frontendData && !await tickets.hasOverrideDocument({tabId:sender.tab.id,documentId:sender.documentId})) {
    const frame = {...frontendData.frame, ambiguous:community.ambiguous};
    const assessment = assessFrontend({observed:frontendData.evidence, record:community.frontend, now:Date.now(), drift:community.corroboratedDrift, incident:community.activeIncident, counterpartyRisk:evaluated?.counterpartyRisk ?? false, frame, dataState:community.state, ageMs:community.ageMs});
    const args = {site:siteFrom(sender.url), chain:state.chainId, observed:frontendData.evidence, frame, verdict: evaluated?.verdict ?? verdict, incidentStatus:latest?.incidentStatus ?? (currentStatus?.status === "normal" ? "normal" : "unknown"), action:'continue', rawDrift:community.rawDrift, incident:community.activeIncident, communityReportingSafe:community.communityReportingSafe, overrideUsed:false};
    const original = frontendObservationCandidates({...args, verdict, incidentStatus, assessment:frontendData.assessment, frame:frontendData.frame, rawDrift:frontendData.community.rawDrift, incident:frontendData.community.activeIncident, communityReportingSafe:frontendData.community.communityReportingSafe});
    if (original.length && valid() && await currentDocument(sender) && !await tickets.hasOverrideDocument({tabId:sender.tab.id,documentId:sender.documentId}) && valid()) await enqueueReports(frontendObservationCandidates({...args, assessment}));
  }
  if (connection) return;
  if (!mayRecordObservation({ verdict: evaluated.verdict, incidentStatus: latest.incidentStatus, action: "continue" })) return;
  await enqueueReports(observationCandidates({ site: siteFrom(sender.tab?.url), chain: state.chainId, classification, request, accounts: state.accounts }));
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
  let details = {
    id,
    method: String(message.method || "unknown").slice(0, 100),
    target: "Not decoded",
    kind: "malformed",
    verdict: "red",
    score: 35,
    reasons: ["Request could not be frozen safely; BOUND passed it to the wallet unscored."],
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
  // The hook already forwarded it unscored; keep a local diagnostic only.
  setCoverage(sender.tab.id, sender.frameId, sender.documentId, "mediated").catch(() => {});
  recordWarning(details).catch(() => {});
}

function openWarning(id, warnings = []) {
  const entry = pending.get(id);
  entry.window = chrome.windows.create({
    url: chrome.runtime.getURL(`warning.html?request=${encodeURIComponent(id)}`),
    type: "popup", width: entry.details.kind === "connection" ? 520 : 480, height: entry.details.kind === "connection" ? 720 : 660
  }).then(async (window) => {
    entry.windowId = window.id;
    if (pending.get(id) === entry && warnings.length) await enqueueReports(warnings).catch(() => {});
    return window;
  }).catch(() => { finish(id, "forward"); return null; });
}

async function handleWarningMessage(message, sender) {
  const denied = message.type === "BOUND_GET_V1" ? null : { ok: false };
  const entry = pending.get(message.id);
  if (!entry || !isWarningPage(sender) || new URL(sender.url).searchParams.get("request") !== message.id) return denied;
  const window = await entry.window;
  if (!window || sender.tab?.windowId !== window.id || pending.get(message.id) !== entry || entry.used) return denied;
  if (message.type === "BOUND_GET_V1") return entry.details;
  if ((entry.details.requireTypedConfirmation || entry.details.verdict === "escalated") && message.action === "continue" && message.confirmation !== "I UNDERSTAND") return { ok: false, error: "confirmation_required" };
  entry.used = true;
  finish(message.id, message.action === "continue" ? "continue" : "cancel");
  return { ok: true };
}

function finish(id, action) {
  const entry = pending.get(id);
  if (!entry) return;
  if (action === "forward" && entry.details.requireTypedConfirmation) action = "cancel";
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(action);
}
function invalidate(predicate) {
  for (const [id, entry] of pending) if (predicate(entry.details)) finish(id, "cancel");
}
function updateCoverage(operation) {
  const current = coverageOperation.then(operation);
  coverageOperation = current.catch(() => { coverageUncertain = true; });
  return current;
}
function setCoverage(tabId, frameId, documentId, value) {
  return updateCoverage(async () => {
    const { boundCoverage = {}, boundSiteStatuses = {} } = await chrome.storage.session.get(["boundCoverage", "boundSiteStatuses"]);
    const key = `${tabId}:${frameId}:${documentId || "unknown"}`;
    const bypassPossible = value === "bypass_possible" || boundCoverage[key]?.bypassPossible === true;
    boundCoverage[key] = { tabId, frameId, documentId, value, bypassPossible };
    await chrome.storage.session.set({ boundCoverage });
    updateBadge(tabId, boundCoverage, boundSiteStatuses);
  });
}
function clearCoverage(tabId) {
  return updateCoverage(async () => {
    const { boundCoverage = {}, boundSiteStatuses = {}, boundSiteAlerts = {} } = await chrome.storage.session.get(["boundCoverage", "boundSiteStatuses", "boundSiteAlerts"]);
    for (const [key, item] of Object.entries(boundCoverage)) if (item.tabId === tabId) delete boundCoverage[key];
    delete boundSiteStatuses[tabId];
    delete boundSiteAlerts[tabId];
    await chrome.storage.session.set({ boundCoverage, boundSiteStatuses, boundSiteAlerts });
    await chrome.notifications?.clear(`bound-site-${tabId}`).catch(() => {});
    setMonitoringBadge(tabId, monitoringCache === true);
    if (decisionAdapters) chrome.alarms.clear(`${STATUS_EXPIRY_PREFIX}${tabId}`).catch(() => {});
  });
}
function updateBadge(tabId, coverage, statuses) {
  monitoringEnabled().then(on => setMonitoringBadge(tabId, on)).catch(() => {});
}
function setMonitoringBadge(tabId, on) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2b2b2b" });
  chrome.action.setBadgeTextColor?.({ tabId, color: "#34d399" });
  chrome.action.setBadgeText({ tabId, text: on ? "●" : "" });
}
async function refreshMonitoringBadges(on) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) if (Number.isInteger(tab.id)) setMonitoringBadge(tab.id, on);
}
chrome.tabs.onCreated?.addListener(tab => {
  if (Number.isInteger(tab.id)) monitoringEnabled().then(on => setMonitoringBadge(tab.id, on)).catch(() => {});
});
async function refreshSiteStatus(tabId, siteOrigin, revision) {
  if (!(await monitoringEnabled())) return;
  const request = Symbol("status request");
  statusRequests.set(tabId, request);
  const settingsAtStart = settingsRevision;
  const valid = () => statusRequests.get(tabId) === request && settingsRevision === settingsAtStart && (tabRevisions.get(tabId) || 0) === revision;
  const watcherOwner=await getWatcherOwner();
  const status = await readPreconnectionSiteStatus({ siteOrigin, watcherOwner, adapters: decisionAdapters });
  await updateCoverage(async () => {
    if (!valid()) return;
    const { boundCoverage = {}, boundSiteStatuses = {}, boundSiteAlerts = {} } = await chrome.storage.session.get(["boundCoverage", "boundSiteStatuses", "boundSiteAlerts"]);
    if (!valid()) return;
    boundSiteStatuses[tabId] = status;
    await chrome.storage.session.set({ boundSiteStatuses });
    updateBadge(tabId, boundCoverage, boundSiteStatuses);
    const expiresAt = Date.parse(status.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) await chrome.alarms.create(`${STATUS_EXPIRY_PREFIX}${tabId}`, { when: expiresAt });
    else await chrome.alarms.clear(`${STATUS_EXPIRY_PREFIX}${tabId}`);
    const alertable = valid() && Number.isFinite(expiresAt) && expiresAt > Date.now() && ["drift", "active"].includes(status.status);
    const alertKey = `${status.site}:${status.status}`;
    if (alertable && boundSiteAlerts[tabId] !== alertKey && chrome.notifications) {
      try {
        await chrome.notifications.create(`bound-site-${tabId}`, {
          type: "basic", iconUrl: chrome.runtime.getURL("alert-icon.png"),
          title: status.status === "active" ? "BOUND: active site incident" : "BOUND: infrastructure change",
          message: status.status === "active" ? `The watcher reports an active incident for ${status.site}. Check the site before connecting your wallet.` : `The watcher reports an infrastructure change for ${status.site}. Check the site before connecting your wallet.`
        });
        if (valid()) { boundSiteAlerts[tabId] = alertKey; await chrome.storage.session.set({ boundSiteAlerts }); }
        else await chrome.notifications.clear(`bound-site-${tabId}`);
      } catch { /* The badge and popup remain available when notifications are disabled. */ }
    } else if (!alertable && boundSiteAlerts[tabId]) {
      delete boundSiteAlerts[tabId];
      await chrome.storage.session.set({ boundSiteAlerts });
      await chrome.notifications?.clear(`bound-site-${tabId}`).catch(() => {});
    }
  });
}
async function refreshOpenSiteStatuses() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab.id) && typeof tab.url === "string").map((tab) => refreshSiteStatus(tab.id, tab.url, tabRevisions.get(tab.id) || 0)));
}
async function refreshPublicData(){
  if (!(await monitoringEnabled())) return;
  // refresh() already downloads the watcher bundle; the per-tab status reads below
  // are bundle-first, so they reuse it instead of issuing per-tab Arkiv queries.
  if(typeof decisionAdapters?.refresh==="function")await decisionAdapters.refresh();
  await refreshOpenSiteStatuses();
}
async function bypassPossible(tabId) {
  try {
    await coverageOperation;
    if (coverageUncertain) return true;
    const { boundCoverage = {} } = await chrome.storage.session.get("boundCoverage");
    return Object.values(boundCoverage).some((item) => item.tabId === tabId && item.bypassPossible);
  } catch { return true; }
}
async function browserFrame({tabId, frameId}) {
  const frame = await chrome.webNavigation.getFrame({tabId, frameId}).catch(() => null);
  if (frame || frameId !== 0 || !chrome.runtime.getContexts) return frame;
  const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB'], tabIds: [tabId]});
  const context = contexts.find(c => c.frameId === 0 && c.documentUrl?.startsWith(chrome.runtime.getURL('')));
  return context ? {documentId: context.documentId, url: context.documentUrl} : null;
}
async function currentDocument(sender) {
  if (!Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId) || typeof sender.documentId !== "string") return false;
  try {
    const frame = await browserFrame({ tabId: sender.tab.id, frameId: sender.frameId });
    return frame?.documentId === sender.documentId;
  } catch { return false; }
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
    reasons: details.reasons || [],
    ...(details.connectionScore ? { connectionScore: details.connectionScore } : {}),
    entries: (details.entries || []).map(({ address, role }) => ({ address, role })),
    approvals: (details.approvals || []).map(({ token, spender }) => ({ token, spender }))
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
  return Boolean(state && typeof state.chainId === "string" && state.chainId.length <= 66 && /^0x[0-9a-f]+$/i.test(state.chainId) &&
    Array.isArray(state.accounts) && state.accounts.length <= 32 && state.accounts.every((account) => typeof account === "string" && /^0x[0-9a-f]{40}$/i.test(account)));
}
function siteFrom(value) {
  return canonicalSite(value) || "unknown";
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

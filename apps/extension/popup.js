const siteNode = document.querySelector("#site");
const coverageNode = document.querySelector("#coverage");
const framesNode = document.querySelector("#frames");
const historyNode = document.querySelector("#history");
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#diagnose-data").addEventListener("click", async () => {
  const button = document.querySelector("#diagnose-data"), result = document.querySelector("#diagnose-result");
  button.disabled = true;
  result.textContent = "Checking anonymous ENS and Arkiv connections. This can take up to a minute…";
  try {
    const data = await chrome.runtime.sendMessage({ type: "BOUND_DATA_DIAGNOSTIC_V1" });
    if (!data?.configured) result.textContent = data?.error ? "Data check failed. Try again." : "Settings are incomplete or not saved. Open Settings and save them.";
    else {
      const parts = [`Anonymous ENS: ${data.anonymousEns}`, `Anonymous Arkiv: ${data.anonymousArkiv}`];
      if (data.snapshot) parts.push(`Verified snapshot: ${data.snapshot}`);
      if (data.siteStatus) parts.push(`Current site status: ${data.siteStatus}`);
      result.textContent = parts.join(" · ");
    }
  } catch { result.textContent = "Data check failed. Try again."; }
  finally { button.disabled = false; }
});
const monitoringButton = document.querySelector("#monitoring"), monitoringState = document.querySelector("#monitoring-state");
function renderMonitoring(on) {
  monitoringState.textContent = on ? "Monitoring is on." : "Monitoring is off.";
  monitoringButton.textContent = on ? "Stop monitoring" : "Start monitoring";
}
monitoringButton.addEventListener("click", async () => {
  monitoringButton.disabled = true;
  try {
    const { boundMonitoring } = await chrome.storage.local.get("boundMonitoring");
    const current = boundMonitoring === true;
    await chrome.storage.local.set({ boundMonitoring: !current });
    renderMonitoring(!current);
    monitoringState.textContent += " Reload open tabs to apply.";
  } finally { monitoringButton.disabled = false; }
});
chrome.storage.local.get("boundMonitoring").then(({ boundMonitoring }) => renderMonitoring(boundMonitoring === true)).catch(() => {});

const captureButton = document.querySelector("#capture"), captureStatus = document.querySelector("#capture-status");
let capturing = false;
async function updateCapture(action) {
  const result = await chrome.runtime.sendMessage({ type: "BOUND_CAPTURE_V1", action }).catch(() => null);
  if (!result?.ok) { captureStatus.textContent = result?.error || "Capture unavailable."; return; }
  capturing = result.capture.active;
  captureButton.textContent = capturing ? "Stop capture" : "Start capture";
  captureStatus.textContent = capturing ? `Capturing this tab. Reload the page; ${result.capture.rows.length} responses recorded.` : "Capture is off.";
}
captureButton.addEventListener("click", () => updateCapture(capturing ? "stop" : "start"));
updateCapture("status");

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) {
    siteNode.textContent = "No active tab";
    coverageNode.textContent = "No coverage state available.";
    historyNode.textContent = "No warning history available.";
    return;
  }
  let currentOrigin = "";
  try { currentOrigin = new URL(tab.url).origin; } catch { /* browser pages have no site origin */ }
  siteNode.textContent = currentOrigin || "No supported site in this tab";
  const [{ boundCoverage = {}, boundSiteStatuses = {} }, { boundWarningHistory = [], boundObservationQueueError = false }, status] = await Promise.all([
    chrome.storage.session.get(["boundCoverage", "boundSiteStatuses"]),
    chrome.storage.local.get(["boundWarningHistory", "boundObservationQueueError"]),
    chrome.runtime.sendMessage({ type: "BOUND_STATUS_V1" }).catch(() => null)
  ]);
  const { boundMonitoring } = await chrome.storage.local.get("boundMonitoring");
  const monitoringOn = boundMonitoring === true;
  renderMonitoring(monitoringOn);
  if (status?.observationReporting) document.querySelector("#privacy").textContent = "Warning history stays in this browser. Site observations are public, and the watcher may see your network address.";
  else if (!monitoringOn) document.querySelector("#privacy").textContent = "Monitoring is off: nothing is checked, recorded or reported.";
  document.querySelector("#queue-error").hidden = !boundObservationQueueError;
  const siteStatus = boundSiteStatuses[tab.id];
  if (siteStatus) {
    const incident = document.querySelector("#incident");
    incident.hidden = false;
    const current = Number.isFinite(Date.parse(siteStatus.expiresAt)) && Date.parse(siteStatus.expiresAt) > Date.now() ? siteStatus.status : "unknown";
    incident.textContent = current === "active" ? "The watcher reports an active incident for this site." : current === "drift" ? "The watcher reports an infrastructure change for this site." : current === "normal" ? "No active incident is reported for this site." : "Current incident status is unavailable.";
  }
  const statuses = Object.values(boundCoverage).filter((item) => item.tabId === tab.id);
  const worst = statuses.some((item) => item.bypassPossible) ? "Bypass possible: a provider path may avoid BOUND."
    : statuses.some((item) => item.value === "unsupported") ? "Unsupported wallet method: no policy score was produced."
      : statuses.some((item) => item.value === "mediated") ? "Mediated request observed. This does not mean every wallet path is covered."
        : "No wallet provider path observed yet.";
  coverageNode.textContent = worst;
  framesNode.textContent = statuses.map((item) => `Frame ${item.frameId}: ${(item.bypassPossible ? "bypass possible" : item.value).replaceAll("_", " ")}`).join(" · ");

  const rows = boundWarningHistory.filter((item) => item.site === currentOrigin).slice(-10).reverse();
  historyNode.replaceChildren();
  if (!rows.length) historyNode.textContent = "No local checks recorded for this site. An existing session or an unobserved provider path may show a wallet as connected without a new connection request.";
  for (const item of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("strong");
    title.textContent = `${item.verdict}${item.score === null ? "" : ` · ${item.score}`} — ${item.method}`;
    const context = document.createElement("div");
    context.className = "muted";
    context.textContent = `${new Date(item.time).toLocaleString()} · chain ${item.chainId || "unknown"}`;
    row.append(title, context);
    if (item.connectionScore) {
      const summary = document.createElement("div");
      summary.textContent = `Connection threshold: ${item.connectionScore.threshold}/100`;
      row.append(summary);
      for (const scope of item.connectionScore.scopes || []) {
        const breakdown = document.createElement("details");
        const heading = document.createElement("summary");
        heading.textContent = `${scope.origin}: ${scope.score}/100`;
        breakdown.append(heading);
        for (const check of scope.checks || []) {
          const line = document.createElement("div");
          line.textContent = `${check.points > 0 ? "+" : ""}${check.points} · ${check.label}: ${check.outcome}`;
          breakdown.append(line);
        }
        row.append(breakdown);
      }
    }
    if (Array.isArray(item.reasons) && item.reasons.length) {
      const reason = document.createElement("div");
      reason.className = "muted";
      reason.textContent = item.reasons.join("; ");
      row.append(reason);
    }
    for (const { token, spender } of uniqueApprovalPairs(item.approvals)) {
      const pair = document.createElement("div");
      pair.className = "approval-pair";
      const details = document.createElement("div");
      details.className = "approval-addresses";
      details.textContent = `Token: ${token} · Spender: ${spender}`;
      pair.append(details);
      const link = document.createElement("a");
      link.className = "approval-link";
      link.href = revokeUrl(item.chainId);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open Revoke.cash for this chain";
      pair.append(link);
      const note = document.createElement("div");
    }
    historyNode.append(row);
  }
})();

function uniqueApprovalPairs(approvals) {
  if (!Array.isArray(approvals)) return [];
  const seen = new Set();
  return approvals.filter((pair) => {
    if (!pair || typeof pair !== "object") return false;
    const { token, spender } = pair;
    if (typeof token !== "string" || typeof spender !== "string" || !/^0x[\da-f]{40}$/i.test(token) || !/^0x[\da-f]{40}$/i.test(spender)) return false;
    const key = `${token.toLowerCase()}:${spender.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function revokeUrl(chainId) {
  const query = new URLSearchParams();
  try { if (chainId) query.set("chainId", BigInt(chainId).toString(10)); } catch { /* chain is unavailable */ }
  const params = query.toString();
  return `https://revoke.cash/${params ? `?${params}` : ""}`;
}

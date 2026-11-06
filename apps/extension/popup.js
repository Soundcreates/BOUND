const siteNode = document.querySelector("#site");
const coverageNode = document.querySelector("#coverage");
const framesNode = document.querySelector("#frames");
const historyNode = document.querySelector("#history");
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
const windowButton = document.querySelector("#open-window");
const tabParameter = new URLSearchParams(location.search).get("tabId");
const detachedTabId = tabParameter !== null && /^(0|[1-9]\d*)$/.test(tabParameter) && Number.isSafeInteger(Number(tabParameter)) ? Number(tabParameter) : null;
let sourceTabId = null;
if (detachedTabId !== null) {
  document.documentElement.classList.add("detached");
  windowButton.hidden = true;
  chrome.tabs.onUpdated.addListener((id, change) => { if (id === detachedTabId && change.url) location.reload(); });
  chrome.tabs.onRemoved.addListener((id) => { if (id === detachedTabId) location.reload(); });
}
windowButton.addEventListener("click", async () => {
  if (sourceTabId === null) return;
  try {
    const url = new URL(chrome.runtime.getURL("popup.html"));
    url.searchParams.set("tabId", String(sourceTabId));
    await chrome.windows.create({ url: url.href, type: "popup", width: 560, height: 760 });
  } catch {
    const error = document.querySelector("#window-error");
    error.textContent = "Could not open a separate window. Please try again.";
    error.hidden = false;
  }
});

(async () => {
  const tab = detachedTabId !== null
    ? await chrome.tabs.get(detachedTabId).catch(() => null)
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) {
    siteNode.textContent = detachedTabId !== null ? "The selected tab is no longer available." : "No active tab";
    coverageNode.textContent = "No coverage state available.";
    historyNode.textContent = "No warning history available.";
    return;
  }
  sourceTabId = tab.id;
  let currentOrigin = "";
  try { currentOrigin = new URL(tab.url).origin; } catch { /* browser pages have no site origin */ }
  siteNode.textContent = currentOrigin || "No supported site in this tab";
  const [{ boundCoverage = {}, boundSiteStatuses = {} }, { boundWarningHistory = [], boundObservationQueueError = false }, status] = await Promise.all([
    chrome.storage.session.get(["boundCoverage", "boundSiteStatuses"]),
    chrome.storage.local.get(["boundWarningHistory", "boundObservationQueueError"]),
    chrome.runtime.sendMessage({ type: "BOUND_STATUS_V1" }).catch(() => null)
  ]);
  if (status?.observationReporting) document.querySelector("#privacy").textContent = "Warning history stays in this browser. Site observations are public, and the watcher may see your network address.";
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
  if (!rows.length) historyNode.textContent = "No local warning history for this site.";
  for (const item of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("strong");
    title.textContent = `${item.verdict}${item.score === null ? "" : ` · ${item.score}`} — ${item.method}`;
    const context = document.createElement("div");
    context.className = "muted";
    context.textContent = `${new Date(item.time).toLocaleString()} · chain ${item.chainId || "unknown"}`;
    row.append(title, context);
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
      note.className = "muted approval-note";
      note.textContent = "The link selects the chain when available, but does not preselect this token or spender. Find the same pair there manually.";
      pair.append(note);
      row.append(pair);
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

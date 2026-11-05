const siteNode = document.querySelector("#site");
const coverageNode = document.querySelector("#coverage");
const framesNode = document.querySelector("#frames");
const historyNode = document.querySelector("#history");

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
  const [{ boundCoverage = {} }, { boundWarningHistory = [] }] = await Promise.all([
    chrome.storage.session.get("boundCoverage"),
    chrome.storage.local.get("boundWarningHistory")
  ]);
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
    const token = item.entries.find((entry) => entry.role === "token");
    const spender = item.entries.find((entry) => entry.role === "rights");
    if (token && spender) {
      const details = document.createElement("div");
      details.textContent = `Token ${token.address} · spender ${spender.address}`;
      row.append(details);
      const link = document.createElement("a");
      let chainId = "";
      try { chainId = BigInt(item.chainId).toString(10); } catch { /* chain is unavailable */ }
      link.href = `https://revoke.cash/${chainId ? `?chainId=${encodeURIComponent(chainId)}` : ""}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open Revoke.cash on this chain";
      row.append(link);
    }
    historyNode.append(row);
  }
})();

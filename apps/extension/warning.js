const id = new URLSearchParams(location.search).get("request");
const main = document.querySelector("main");
const typed = document.querySelector("#confirmation");
const typedLabel = document.querySelector("#confirmation-label");
const continueButton = document.querySelector("#continue");
const cancelButton = document.querySelector("#cancel");
const details = awaitDetails();

async function awaitDetails() {
  const data = await chrome.runtime.sendMessage({ type: "BOUND_GET_V1", id });
  if (!data) {
    main.textContent = "This request expired or was invalidated. Return to the site and try again.";
    return null;
  }
  document.querySelector("#report-domain").textContent = data.topOrigin || "unknown site";
  document.querySelector("#request-time").textContent = new Date().toLocaleString();
  document.querySelector("#top").textContent = data.topOrigin;
  document.querySelector("#frame").textContent = data.frameOrigin;
  document.querySelector("#method").textContent = data.method;
  document.querySelector("#chain").textContent = data.chainId || "Unknown";
  document.querySelector("#target").textContent = data.target || "Not decoded";
  document.querySelector("#coverage").textContent = `${data.coverage} · ${data.kind}`;
  document.querySelector("#verdict").textContent = data.coverage === "unsupported" ? "unsupported · no score" : data.score === null ? `${data.verdict} · no baseline` : `${data.verdict} · score ${data.score}`;
  document.querySelector("#reasons").textContent = data.reasons.join("; ") || "No policy snapshot is configured in this prototype.";
  if (data.incidentStatus === "active") {
    document.querySelector("#incident").hidden = false;
    document.querySelector("#incident").textContent = "The watcher reports an active incident for this site.";
  }
  if (data.coverage === "unsupported") document.querySelector("#notice").textContent = "BOUND cannot assess this wallet method. Review the request carefully before continuing.";
  else if (data.kind === "malformed") document.querySelector("#notice").textContent = "BOUND could not decode this request reliably. Review the request carefully before continuing.";
  else if (data.verdict === "escalated") document.querySelector("#notice").textContent = data.method === "eth_sign" ? "This request requires extra caution. Blind signatures can grant permissions that are not visible here." : "This request has elevated risk. Review the site, addresses, and reasons before continuing.";
  else if (data.score !== null) document.querySelector("#notice").textContent = "BOUND compared the request with available information. A score cannot guarantee that a request is safe.";
  if (data.locked) document.querySelector("#notice").textContent = "Wallet chain or account state could not be verified, so BOUND could not score this request. Review it carefully before continuing.";
  if (data.malformed) {
    document.querySelector("#request-status").textContent = "This request could not be frozen safely and has been cancelled.";
    document.querySelector("#request-status").hidden = false;
    continueButton.hidden = true;
    cancelButton.textContent = "Close";
  }
  const ensText = {
    live: "Read live from ENS just now.",
    memory: "From this browser's cache of an earlier live ENS read.",
    arkiv_unconfirmed: "Live ENS read did not finish. A watcher-cached copy exists on Arkiv but is unconfirmed, so it did not count toward trust.",
    timeout: "Live ENS read timed out; not counted.",
    unavailable: "Could not be read; not counted."
  }[data.ensLookup];
  if (ensText) {
    document.querySelector("#ens-field").hidden = false;
    document.querySelector("#ens").textContent = ensText + (data.ensInconsistent ? " The watcher's cached copy differs from the live record." : "");
  }
  if (data.kind === "connection") renderConnection(data);
  const addresses = document.querySelector("#entries");
  addresses.textContent = data.entries.length ? data.entries.map((entry) => `${entry.role}: ${entry.address}${entry.verified === false ? " (unverified)" : ""}`).join(" · ") : "No counterparty decoded";
  if (data.frontend) {
    const node = document.querySelector("#frontend");
    node.replaceChildren();
    for (const item of data.frontend.scripts) {
      const line = document.createElement("div");
      line.textContent = `${item.label} (${item.source}): ${item.hash}`;
      node.append(line);
    }
    const note = document.createElement("div");
    note.textContent = `${data.frontend.unavailable} scripts unavailable or not inspected. Cached bytes may differ from what executed.`;
    node.append(note);
  }
  if (data.networkCapture?.active) {
    const node = document.querySelector("#network-capture"); node.replaceChildren();
    for (const row of data.networkCapture.rows) {
      const line = document.createElement("div");
      line.textContent = `${row.type} ${row.method} ${row.origin} · Network: ${row.metadataHash || "hash unavailable"}${row.hash ? ` · Source: ${row.hash} (${row.hashEncoding})` : ""}`;
      node.append(line);
    }
    const note = document.createElement("div"); note.textContent = `${data.networkCapture.missing} source bodies or responses unavailable or omitted.`; node.append(note);
  }
  if (Array.isArray(data.observedAddresses) && data.observedAddresses.length) {
    document.querySelector("#observed-field").hidden = false;
    document.querySelector("#observed").textContent = data.observedAddresses.join(" · ");
  }
  const approvals = uniqueApprovalPairs(data.approvals);
  const approvalPairs = document.querySelector("#approval-pairs");
  for (const { token, spender } of approvals) {
    const pair = document.createElement("div");
    pair.className = "approval-pair";
    const addresses = document.createElement("div");
    addresses.className = "approval-addresses";
    addresses.textContent = `Token: ${token} · Spender: ${spender}`;
    const link = document.createElement("a");
    link.className = "approval-link";
    link.href = revokeUrl(data.chainId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Revoke.cash for this chain";
    pair.append(addresses, link);
    approvalPairs.append(pair);
  }
  document.querySelector("#approval-links").hidden = !approvals.length;
  if (data.verdict === "escalated") {
    typed.hidden = false;
    typedLabel.hidden = false;
    continueButton.disabled = true;
    typed.addEventListener("input", () => { continueButton.disabled = typed.value !== "I UNDERSTAND"; });
  } else continueButton.disabled = false;
  return data;
}

function renderConnection(data) {
  const tier = data.tier || "warning";
  document.body.classList.add(`tier-${tier}`);
  document.querySelector(".warning-data h1").textContent = { pass: "Connection request: site checks passed", warning: "Connection request: some checks unavailable", huge: "Warning: low confidence in this site", firewall: "Stop: BOUND found a serious problem" }[tier];
  const score = data.connectionScore || {};
  document.querySelector("#verdict").textContent = `Policy confidence ${data.score}% (${data.score} of 100 heuristic points). This is BOUND's configured check score, not a measured probability that the site is safe.`;
  document.querySelector("#notice").textContent = {
    pass: "This site is asking to see your wallet address. BOUND verified it against the signed site list and current watcher status. Continue to let your wallet ask you.",
    warning: "This site is asking to see your wallet address. Some evidence was unavailable, so BOUND could not fully verify it. Nothing bad was detected. You decide.",
    huge: "This site is asking to see your wallet address, and BOUND has low confidence in it. Check the address bar and the calculation below before continuing.",
    firewall: data.connectionStatus === "active" ? "The watcher reports an ACTIVE INCIDENT for this site. Connecting may expose you to a compromised frontend. Type I UNDERSTAND only if you are sure."
      : data.connectionStatus === "drift" ? "The watcher reports a change to this site's DNS or certificate. The site may be hijacked. Type I UNDERSTAND only if you are sure."
      : "BOUND's confidence in this site is very low. Type I UNDERSTAND only if you are sure."
  }[tier];
  document.querySelector("#target").textContent = "Not applicable: account access request";
  const field = document.querySelector("#connection-field");
  const calc = document.querySelector("#connection-calc");
  calc.replaceChildren();
  for (const scope of score.scopes || []) {
    const title = document.createElement("div");
    title.textContent = `${scope.origin}: ${scope.score}/100`;
    calc.append(title);
    const table = document.createElement("table");
    table.className = "calc";
    const head = table.insertRow();
    for (const [text, num] of [["Check", false], ["Weight", true], ["Outcome", false], ["Points", true], ["Running total", true]]) { const th = document.createElement("th"); th.textContent = text; if (num) th.className = "num"; head.append(th); }
    let running = 0;
    for (const check of scope.checks || []) {
      running += check.points;
      const row = table.insertRow();
      const cells = [check.label, String(check.weight), check.outcome, `${check.points > 0 ? "+" : ""}${check.points}`, String(running)];
      cells.forEach((text, index) => { const td = row.insertCell(); td.textContent = text; if ([1, 3, 4].includes(index)) td.className = "num"; if (index === 2) td.className = `outcome-${check.outcome}`; });
    }
    calc.append(table);
    if (scope.blockers?.length) { const note = document.createElement("div"); note.textContent = `Detected: ${scope.blockers.join("; ")}`; calc.append(note); }
  }
  document.querySelector("#connection-formula").textContent = `Passed checks add their weight, failed checks subtract it, unavailable checks add 0. The total is clamped to 0–100; with several origins the lowest score counts. No review needed at ${score.threshold}+.`;
  field.hidden = false;
}

async function decide(action) {
  const data = await details;
  if (!data) return;
  const response = await chrome.runtime.sendMessage({ type: "BOUND_DECISION_V1", id, action, confirmation: typed.value });
  if (!response?.ok) return;
  window.close();
}

continueButton.addEventListener("click", () => decide("continue"));
cancelButton.addEventListener("click", () => decide("cancel"));

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

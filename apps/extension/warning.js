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
  document.querySelector("#top").textContent = data.topOrigin;
  document.querySelector("#frame").textContent = data.frameOrigin;
  document.querySelector("#method").textContent = data.method;
  document.querySelector("#chain").textContent = data.chainId || "Unknown";
  document.querySelector("#target").textContent = data.target || "Not decoded";
  document.querySelector("#coverage").textContent = `${data.coverage} · ${data.kind}`;
  document.querySelector("#verdict").textContent = data.coverage === "unsupported" ? "unsupported · no score" : data.score === null ? `${data.verdict} · no baseline` : `${data.verdict} · score ${data.score}`;
  document.querySelector("#verdict").dataset.verdict = data.coverage === "unsupported" ? "grey" : data.verdict;
  document.querySelector("#reasons").textContent = data.reasons.join("; ") || "No policy snapshot is configured in this prototype.";
  if (data.incidentStatus === "active") {
    document.querySelector("#incident").hidden = false;
    document.querySelector("#incident").textContent = "The watcher reports an active incident for this site.";
  }
  if (data.coverage === "unsupported") document.querySelector("#notice").textContent = "BOUND cannot assess this wallet method. Review the request carefully before continuing.";
  else if (data.kind === "malformed") document.querySelector("#notice").textContent = "BOUND could not decode this request reliably. Review the request carefully before continuing.";
  else if (data.verdict === "escalated") document.querySelector("#notice").textContent = data.method === "eth_sign" ? "This request requires extra caution. Blind signatures can grant permissions that are not visible here." : "This request has elevated risk. Review the site, addresses, and reasons before continuing.";
  else if (data.score !== null) document.querySelector("#notice").textContent = "BOUND compared the request with available information. A score cannot guarantee that a request is safe.";
  if (data.malformed || data.locked) {
    document.querySelector("#notice").textContent = data.malformed
      ? "This request could not be frozen safely and has been cancelled. BOUND did not forward it."
      : "Wallet chain or account state could not be verified. This request was cancelled and not forwarded.";
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
    for (const [label, value] of [["Token", token], ["Spender", spender]]) {
      const line = document.createElement("div");
      const name = document.createElement("span");
      name.className = "address-label";
      name.textContent = `${label}: `;
      const address = document.createElement("code");
      address.textContent = value;
      line.append(name, address);
      addresses.append(line);
    }
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

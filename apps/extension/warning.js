import { frontendIntegrityText } from "./warning-integrity.mjs";
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
  if (data.connectionScore) renderConnectionChecks(data.connectionScore);
  document.querySelector("#top").textContent = data.topOrigin;
  document.querySelector("#frame").textContent = data.frameOrigin;
  document.querySelector("#method").textContent = data.method;
  document.querySelector("#chain").textContent = data.chainId || "Unknown";
  document.querySelector("#target").textContent = data.target || "Not decoded";
  document.querySelector("#coverage").textContent = `${data.coverage} · ${data.kind}`;
  document.querySelector("#verdict").textContent = data.coverage === "unsupported" ? "unsupported · no score" : data.score === null ? `${data.verdict} · no baseline` : `${data.verdict} · score ${data.score}`;
  document.querySelector("#verdict-field").classList.toggle("verdict-green", data.verdict === "green");
  document.querySelector("#reasons").textContent = data.reasons.join("; ") || "No policy snapshot is configured in this prototype.";
  if (data.incidentStatus === "active") {
    document.querySelector("#incident").hidden = false;
    document.querySelector("#incident").textContent = "The watcher reports an active incident for this site.";
  }
  if (data.coverage === "unsupported") document.querySelector("#notice").textContent = "BOUND cannot assess this wallet method. Review the request carefully before continuing.";
  else if (data.kind === "malformed") document.querySelector("#notice").textContent = "BOUND could not decode this request reliably. Review the request carefully before continuing.";
  else if (data.verdict === "escalated") document.querySelector("#notice").textContent = data.method === "eth_sign" ? "This request requires extra caution. Blind signatures can grant permissions that are not visible here." : "This request has elevated risk. Review the site, addresses, and reasons before continuing.";
  else if (data.score !== null) document.querySelector("#notice").textContent = "Proceed at your own risk";
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
  const addresses = document.querySelector("#entries");
  addresses.textContent = data.entries.length ? data.entries.map((entry) => `${entry.role}: ${entry.address}${entry.verified === false ? " (unverified)" : ""}`).join(" · ") : "No counterparty decoded";
  document.querySelector("#frontend").textContent = frontendIntegrityText(data.frontendIntegrity);
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
  if (data.requireTypedConfirmation || data.verdict === "escalated") {
    typed.hidden = false;
    typedLabel.hidden = false;
    continueButton.disabled = true;
    typed.addEventListener("input", () => { continueButton.disabled = typed.value !== "I UNDERSTAND"; });
  } else continueButton.disabled = false;
  return data;
}

function renderConnectionChecks(score) {
  const labels = [
    ["origin", "HTTPS origin"],
    ["snapshot", "ENS/Arkiv snapshot"],
    ["domain", "Domain and port match"],
    ["arkiv", "Arkiv watcher lookup"],
    ["watcher", "Watcher status"],
    ["wallet", "Wallet chain/account available"]
  ];
  const scopes = score.scopes || [];
  const list = document.querySelector("#connection-checks");
  for (const [id, label] of labels) {
    const passed = scopes.length > 0 && scopes.every(scope => scope.checks?.find(check => check.id === id)?.outcome === "passed");
    const item = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = passed ? "check-mark check-pass" : "check-mark check-fail";
    mark.setAttribute("aria-label", passed ? "Passed" : "Failed or unavailable");
    mark.textContent = passed ? "✓" : "×";
    const text = document.createElement("span");
    text.textContent = label;
    item.append(mark, text);
    list.append(item);
  }
  const passed = list.querySelectorAll(".check-pass").length;
  const total = labels.length;
  const percent = Math.round((passed / total) * 100);
  const pie = document.querySelector("#pie-chart");
  pie.style.setProperty("--pass-share", `${percent}%`);
  pie.setAttribute("aria-label", `${passed} of ${total} connection checks passed; ${total - passed} failed or unavailable`);
  document.querySelector("#pie-chart-label").textContent = `${percent}% passed`;
  document.querySelector("#passed-count").textContent = `${passed} passed`;
  document.querySelector("#not-passed-count").textContent = `${total - passed} failed or unavailable`;
  document.querySelector("#pie-summary").hidden = false;
  document.querySelector("#verdict-field").classList.add("score-after-pie");
}

const moreDetails = document.querySelector(".more-details");
let pieAnimated = false;
let pieObserver;
function observePieUntilVisible() {
  if (pieAnimated || !moreDetails.open || document.querySelector("#pie-summary").hidden) return;
  const pie = document.querySelector("#pie-chart");
  const play = () => {
    if (pieAnimated) return;
    pieAnimated = true;
    pieObserver?.disconnect();
    pie.classList.add("pie-animate");
    document.querySelector("#verdict-field").classList.add("reveal-score");
  };
  if (!("IntersectionObserver" in window)) return play();
  pieObserver ||= new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) play();
  }, { threshold: 0.5 });
  pieObserver.observe(pie);
}
moreDetails.addEventListener("toggle", () => {
  observePieUntilVisible();
});

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

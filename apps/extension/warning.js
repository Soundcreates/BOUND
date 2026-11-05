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
  document.querySelector("#verdict").textContent = data.score === null ? `${data.verdict} · no baseline` : `${data.verdict} · score ${data.score}`;
  document.querySelector("#reasons").textContent = data.reasons.join("; ") || "No policy snapshot is configured in this prototype.";
  if (data.malformed || data.locked) {
    document.querySelector("#notice").textContent = data.malformed
      ? "This request could not be frozen safely and has been cancelled. BOUND did not forward it."
      : "Wallet chain or account state could not be verified. This request was cancelled and not forwarded.";
    continueButton.hidden = true;
    cancelButton.textContent = "Close";
  }
  const addresses = document.querySelector("#entries");
  addresses.textContent = data.entries.length ? data.entries.map((entry) => `${entry.role}: ${entry.address}${entry.verified === false ? " (unverified)" : ""}`).join(" · ") : "No counterparty decoded";
  const token = data.entries.find((entry) => entry.role === "token");
  const spender = data.entries.find((entry) => entry.role === "rights");
  if (token && spender) {
    let chainId = "";
    try { chainId = BigInt(data.chainId).toString(10); } catch { /* chain is unavailable */ }
    document.querySelector("#revoke").href = `https://revoke.cash/${chainId ? `?chainId=${encodeURIComponent(chainId)}` : ""}`;
    document.querySelector("#revoke-row").hidden = false;
  }
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

const channel = crypto.randomUUID();

window.dispatchEvent(new CustomEvent("BOUND_INIT_V1", { detail: channel }));

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (message?.type === "BOUND_MALFORMED_V1" && typeof message.id === "string") {
    chrome.runtime.sendMessage({ type: "BOUND_MALFORMED_V1", id: message.id, method: String(message.method || "unknown").slice(0, 100) }).catch(() => {});
    return;
  }
  if (message?.type === "BOUND_REQUEST_V1") {
    if (typeof message.id !== "string" || !/^[0-9]+:[0-9a-f-]{36}$/i.test(message.id) || typeof message.digest !== "string" || !/^[0-9a-f]{64}$/.test(message.digest)) return;
    let encoded;
    try { encoded = JSON.stringify(message.request); } catch { return; }
    if (new TextEncoder().encode(encoded).length > 262144) return;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "BOUND_REQUEST_V1",
        id: message.id,
        channel,
        digest: message.digest,
        stateDigest: message.stateDigest,
        state: message.state,
        request: message.request
      });
      window.postMessage({ type: "BOUND_DECISION_V1", channel, id: message.id, digest: result?.digest || message.digest, stateDigest: result?.stateDigest || message.stateDigest, readOnly: result?.readOnly === true, action: result?.action === "continue" ? "continue" : "cancel" }, location.origin);
    } catch {
      window.postMessage({ type: "BOUND_DECISION_V1", channel, id: message.id, digest: message.digest, stateDigest: message.stateDigest, action: "cancel" }, location.origin);
    }
  } else if (message?.type === "BOUND_STATE_CHANGE_V1") {
    chrome.runtime.sendMessage({ type: "BOUND_STATE_CHANGE_V1", event: message.event }).catch(() => {});
  } else if (message?.type === "BOUND_COVERAGE_V1" && message.coverage === "bypass_possible") {
    chrome.runtime.sendMessage({ type: "BOUND_COVERAGE_V1", coverage: message.coverage }).catch(() => {});
  }
});

const channel = crypto.randomUUID();
const requests = new Map();
const cancellations = new Map();
const guards = new Map();
const idValid = (value) => typeof value === "string" && /^[0-9]+:[0-9a-f-]{36}$/i.test(value);
const digestValid = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const tokenValid = (value) => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
const exact = (value, names) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const matches = (message, pending, names) => pending && names.every((name) => message[name] === pending[name]);
const send = (message) => { try { Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => {}); } catch { /* worker unavailable */ } };

window.dispatchEvent(new CustomEvent("BOUND_INIT_V1", { detail: channel }));

// A worker command and its page acknowledgement are separate messages.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender?.id !== chrome.runtime.id || !exact(message, ["type", "id", "digest", "stateDigest", "nonce"]) ||
      message.type !== "BOUND_RETRY_GUARD_V1" || !idValid(message.id) || !digestValid(message.digest) ||
      !digestValid(message.stateDigest) || !tokenValid(message.nonce)) return;
  const request = requests.get(message.id);
  if (!matches(message, request, ["id", "digest", "stateDigest"]) || guards.has(message.id)) return;
  guards.set(message.id, message);
  window.postMessage({ ...message, channel }, location.origin);
});

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  // Safe-page messages intentionally do not use the hook channel. The worker
  // authenticates the actual sender document and ticket.
  if (message?.type === "BOUND_SAFE_READY_V1" || message?.type === "BOUND_SAFE_CONFIRM_V1") {
    if (exact(message, ["type", "ticket"]) && tokenValid(message.ticket)) send({ type: message.type, ticket: message.ticket });
    return;
  }
  if (message?.type === "BOUND_CANCEL_DELIVERED_V1") {
    const fields = ["id", "digest", "stateDigest", "ticket", "cancelNonce"];
    if (!exact(message, ["type", "channel", ...fields]) || message.channel !== channel || !matches(message, cancellations.get(message.id), fields)) return;
    cancellations.delete(message.id);
    event.stopImmediatePropagation();
    send({ type: message.type, id: message.id, digest: message.digest, stateDigest: message.stateDigest, ticket: message.ticket, cancelNonce: message.cancelNonce });
    return;
  }
  if (message?.type === "BOUND_RETRY_GUARDED_V1") {
    const fields = ["id", "digest", "stateDigest", "nonce"];
    if (!exact(message, ["type", "channel", ...fields]) || message.channel !== channel || !matches(message, guards.get(message.id), fields)) return;
    guards.delete(message.id);
    event.stopImmediatePropagation();
    send({ type: message.type, id: message.id, digest: message.digest, stateDigest: message.stateDigest, nonce: message.nonce });
    return;
  }
  if (message?.type === "BOUND_FORWARDED_V1" && message.channel === channel && typeof message.receiptToken === "string" && /^[0-9a-f-]{36}$/i.test(message.receiptToken)) {
    event.stopImmediatePropagation();
    send({ type: "BOUND_FORWARDED_V1", receiptToken: message.receiptToken, digest: message.digest, stateDigest: message.stateDigest });
    return;
  }
  if (message?.type === "BOUND_MALFORMED_V1" && typeof message.id === "string") {
    send({ type: "BOUND_MALFORMED_V1", id: message.id, method: String(message.method || "unknown").slice(0, 100) });
    return;
  }
  if (message?.type === "BOUND_REQUEST_V1") {
    if (!idValid(message.id) || !digestValid(message.digest) || !digestValid(message.stateDigest) || requests.has(message.id)) return;
    let encoded;
    try { encoded = JSON.stringify(message.request); } catch { return; }
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).length > 262144) return;
    const binding = { id: message.id, digest: message.digest, stateDigest: message.stateDigest };
    requests.set(message.id, binding);
    try {
      const result = await chrome.runtime.sendMessage({ type: "BOUND_REQUEST_V1", ...binding, channel, state: message.state, request: message.request });
      const validResult = result?.digest === binding.digest && result?.stateDigest === binding.stateDigest;
      const safe = validResult && result.action === "cancel" && result.safePage === true && tokenValid(result.ticket) && tokenValid(result.cancelNonce);
      const decision = { type: "BOUND_DECISION_V1", channel, ...binding, action: validResult && result.action === "continue" ? "continue" : "cancel" };
      if (validResult && result.safePage === true && !safe) return window.postMessage(decision, location.origin);
      if (safe) {
        Object.assign(decision, { safePage: true, ticket: result.ticket, cancelNonce: result.cancelNonce });
        cancellations.set(message.id, { ...binding, ticket: result.ticket, cancelNonce: result.cancelNonce });
        setTimeout(() => cancellations.delete(message.id), 500);
      } else if (validResult) {
        Object.assign(decision, { receiptToken: result.receiptToken, connectionStatus: result.connectionStatus, connectionScore: result.connectionScore, readOnly: result.readOnly === true, typedApproved: result.typedApproved === true });
      }
      window.postMessage(decision, location.origin);
    } catch {
      window.postMessage({ type: "BOUND_DECISION_V1", channel, ...binding, action: "cancel" }, location.origin);
    } finally {
      requests.delete(message.id);
      guards.delete(message.id);
    }
  } else if (message?.type === "BOUND_STATE_CHANGE_V1") {
    send({ type: "BOUND_STATE_CHANGE_V1", event: message.event });
  } else if (message?.type === "BOUND_COVERAGE_V1" && message.coverage === "bypass_possible") {
    send({ type: "BOUND_COVERAGE_V1", coverage: message.coverage });
  }
});

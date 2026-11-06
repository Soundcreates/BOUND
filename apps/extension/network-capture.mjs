import { hashScript } from "./frontend-integrity.mjs";

export function isCapturePage(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch { return false; }
}

// CDP gives the actual response body retained by Chrome, not a second fetch.
// Captures are tab-scoped, in memory, and never include query strings, cookies,
// authorization headers, request bodies or non-source response bodies.
export function createNetworkCapture({ api, now = Date.now }) {
  const tabs = new Map(), MAX_ROWS = 200, MAX_BYTES = 2 * 1024 * 1024;
  const safeHeaders = new Set(["content-type", "content-length", "cache-control", "content-security-policy", "x-content-type-options"]);
  const send = (tabId, method, params = {}) => api.sendCommand({ tabId }, method, params);
  const origin = value => { try { return new URL(value).origin; } catch { return "unknown"; } };
  async function start(tabId) {
    if (tabs.has(tabId)) return;
    await api.attach({ tabId }, "1.3");
    const state = { rows: [], requests: new Map(), methods: new Map(), startedAt: now(), missing: 0 };
    tabs.set(tabId, state);
    try { await send(tabId, "Network.enable", { maxTotalBufferSize: 5 * 1024 * 1024, maxResourceBufferSize: MAX_BYTES }); }
    catch (error) { tabs.delete(tabId); await api.detach({ tabId }).catch(() => {}); throw error; }
  }
  async function stop(tabId) { tabs.delete(tabId); await api.detach({ tabId }).catch(() => {}); }
  async function stopAll() { for (const tabId of [...tabs.keys()]) await stop(tabId); }
  function snapshot(tabId) {
    const state = tabs.get(tabId);
    return state ? { active: true, startedAt: state.startedAt, missing: state.missing, rows: structuredClone(state.rows) } : { active: false, rows: [], missing: 0 };
  }
  function reset(tabId) { const state = tabs.get(tabId); if (state) { state.rows = []; state.requests.clear(); state.methods.clear(); state.missing = 0; } }
  async function onEvent(source, method, params) {
    const state = tabs.get(source.tabId); if (!state) return;
    if (method === "Network.requestWillBeSent") {
      if (state.methods.size < MAX_ROWS) state.methods.set(params.requestId, /^[A-Z]{1,12}$/.test(params.request?.method) ? params.request.method : "unknown");
    } else if (method === "Network.responseReceived") {
      const response = params.response || {}, type = params.type || "Other";
      const headers = Object.create(null);
      for (const [key, value] of Object.entries(response.headers || {})) if (safeHeaders.has(key.toLowerCase()) && typeof value === "string" && value.length <= 1024) headers[key.toLowerCase()] = value;
      const row = { origin: origin(response.url), type, method: state.methods.get(params.requestId) || "unknown", status: Number(response.status) || 0, headers, hash: null, metadataHash: null };
      state.methods.delete(params.requestId);
      if (state.rows.length >= MAX_ROWS) { state.missing++; return; }
      state.rows.push(row);
      if (["Document", "Script"].includes(type)) state.requests.set(params.requestId, row);
      // Versioned and deterministic: header name ordering does not change the digest.
      const canonical = JSON.stringify(["bound-network-v1", row.method, row.origin, row.type, row.status, Object.entries(headers).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
      try { row.metadataHash = await hashScript(new TextEncoder().encode(canonical)); } catch { state.missing++; }
    } else if (method === "Network.loadingFinished") {
      const row = state.requests.get(params.requestId); if (!row) return;
      state.requests.delete(params.requestId);
      if (params.encodedDataLength > MAX_BYTES) { state.missing++; return; }
      try {
        const body = await send(source.tabId, "Network.getResponseBody", { requestId: params.requestId });
        if (tabs.get(source.tabId) !== state || !state.rows.includes(row) || typeof body?.body !== "string" || body.body.length > MAX_BYTES * 2) return;
        const bytes = body.base64Encoded ? Uint8Array.from(atob(body.body), c => c.charCodeAt(0)) : new TextEncoder().encode(body.body);
        if (bytes.length > MAX_BYTES) { state.missing++; return; }
        row.hash = await hashScript(bytes);
        row.hashEncoding = body.base64Encoded ? "response bytes" : "Chrome-decoded text encoded as UTF-8";
      } catch { state.missing++; }
    } else if (method === "Network.loadingFailed") state.requests.delete(params.requestId);
  }
  api.onEvent.addListener((source, method, params) => { onEvent(source, method, params).catch(() => {}); });
  api.onDetach.addListener(source => tabs.delete(source.tabId));
  return { start, stop, stopAll, reset, snapshot };
}

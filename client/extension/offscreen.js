const worker = new Worker(chrome.runtime.getURL("anon-rpc-worker.js"), { type: "module" });
const pending = new Map();

worker.addEventListener("message", (event) => {
  const entry = pending.get(event.data?.requestId);
  if (!entry) return;
  pending.delete(event.data.requestId);
  clearTimeout(entry.timer);
  entry.respond(event.data);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "bound-anon-rpc-offscreen" || sender.id !== chrome.runtime.id || sender.tab) return;
  if (typeof message.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(message.requestId)) {
    sendResponse({ error: "invalid_request" });
    return;
  }
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(message.request)); } catch {
    sendResponse({ requestId: message.requestId, error: "invalid_request" });
    return;
  }
  if (bytes.length > 262144) {
    sendResponse({ requestId: message.requestId, error: "request_too_large" });
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(message.requestId);
    sendResponse({ requestId: message.requestId, error: "anon_rpc_timeout" });
  }, 1500);
  pending.set(message.requestId, { respond: sendResponse, timer });
  worker.postMessage({ requestId: message.requestId, request: message.request });
  return true;
});

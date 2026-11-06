import { hashInlineScript, hashScript } from "./frontend-integrity.mjs";

// Observational only: a cached re-fetch can differ from the executed response.
// Never send script bytes, hashes, or page URLs outside the extension.
export async function collectFrontendScripts(doc, { fetchImpl = fetch } = {}) {
  const scripts = [...doc.querySelectorAll("script")];
  const results = [], limit = 32;
  let unavailable = Math.max(0, scripts.length - limit);
  for (const script of scripts.slice(0, limit)) {
    try {
      if (!script.src) {
        const text = script.textContent || "";
        if (text.length > 2 * 1024 * 1024) throw new Error("large script");
        results.push({ label: "Inline script", hash: await hashInlineScript(text), source: "inline DOM" });
        continue;
      }
      const url = new URL(script.src, doc.URL);
      if (url.origin !== new URL(doc.URL).origin || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("unavailable script");
      const response = await fetchImpl(url.href, { method: "GET", mode: "same-origin", cache: "only-if-cached", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(750) });
      if (!response.ok) throw new Error("cache miss");
      const declared = response.headers.get("content-length");
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 2 * 1024 * 1024)) throw new Error("large script");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("stream unavailable");
      const chunks = []; let length = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("large script"); } chunks.push(value); } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      results.push({ label: url.pathname.slice(0, 256), hash: await hashScript(bytes), source: "browser cache" });
    } catch { unavailable++; }
  }
  return { scripts: results, unavailable };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage && typeof document !== "undefined") {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "BOUND_COLLECT_FRONTEND_V1") return;
    collectFrontendScripts(document).then(respond, () => respond({ scripts: [], unavailable: 1 }));
    return true;
  });
}

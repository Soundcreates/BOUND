import { hashScript } from "./frontend-integrity.mjs";
import { isFrontendPath } from "../../packages/contracts/frontend.js";

// Cache-only refetches are observational and may differ from executed bytes.
export async function collectFrontendScripts(doc, { fetchImpl = fetch } = {}) {
  const elements = [...doc.querySelectorAll('script')];
  const coverage = { total: elements.length, compared: 0, inlineExcluded: 0, queryExcluded: 0, crossOriginExcluded: 0, privatePathExcluded: 0, unavailable: 0, overCap: Math.max(0, elements.length - 32) };
  const results = Array(Math.min(elements.length, 32));
  const controller = new AbortController();
  let deadline;
  const end = new Promise(resolve => { deadline = setTimeout(() => { controller.abort(); resolve(); }, 1100); });
  let index = 0;
  async function worker() {
    while (index < results.length && !controller.signal.aborted) {
      const i = index++, script = elements[i];
      try {
        if (!script.src) { coverage.inlineExcluded++; continue; }
        const url = new URL(script.src, doc.URL);
        if (url.search || url.hash) { coverage.queryExcluded++; continue; }
        if (url.origin !== new URL(doc.URL).origin || !['http:', 'https:'].includes(url.protocol)) { coverage.crossOriginExcluded++; continue; }
        if (!isFrontendPath(url.pathname)) { coverage.privatePathExcluded++; continue; }
        const local = new AbortController();
        const abort = () => local.abort(); controller.signal.addEventListener('abort', abort, { once: true });
        let timer;
        try {
          const task = (async () => {
            const response = await fetchImpl(url.href, { method: 'GET', mode: 'same-origin', cache: 'only-if-cached', credentials: 'omit', redirect: 'error', signal: local.signal });
            if (!response.ok) throw Error('cache miss');
            const size = response.headers.get('content-length');
            if (size && (!/^\d+$/.test(size) || Number(size) > 2097152)) throw Error('oversize');
            const reader = response.body?.getReader(); if (!reader) throw Error('no stream');
            const chunks = []; let length = 0;
            try { for (;;) { const {done, value} = await reader.read(); if (done) break; length += value.length; if (length > 2097152) { reader.cancel(); throw Error('oversize'); } chunks.push(value); } } finally { reader.releaseLock(); }
            const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            return {path: url.pathname, hash: await hashScript(bytes)};
          })();
          results[i] = await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => { local.abort(); reject(Error('timeout')); }, 750); }), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('deadline')), {once:true}))]);
          coverage.compared++;
        } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
      } catch { coverage.unavailable++; }
    }
  }
  await Promise.race([Promise.all(Array.from({length:4}, worker)), end]);
  clearTimeout(deadline); controller.abort();
  // Workers settle on abort before finalizing the partition.
  await Promise.resolve(); await Promise.resolve();
  coverage.unavailable = coverage.total - coverage.overCap - coverage.compared - coverage.inlineExcluded - coverage.queryExcluded - coverage.crossOriginExcluded - coverage.privatePathExcluded;
  const evidence = {version:1, documentUrl:doc.URL, scripts:results.filter(Boolean), coverage};
  if (coverage.total > 100000 || new TextEncoder().encode(JSON.stringify(evidence)).length > 32768) return null;
  return evidence;
}
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && typeof document !== 'undefined') {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'BOUND_COLLECT_FRONTEND_V1' || Object.keys(message).length !== 1) return;
    collectFrontendScripts(document).then(respond, () => respond(null)); return true;
  });
}

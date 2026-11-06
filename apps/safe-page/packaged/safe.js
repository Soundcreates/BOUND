(() => {
  // <define:__SAFE_CONFIG__>
  var define_SAFE_CONFIG_default = { rpcUrl: "https://rpc.rabdi.db-chain.testnet.arkiv.network", arkivChainId: 7794095, watchers: ["0xe63393558e36df643347326e7e03ad5fb0e6c867"] };

  // packages/contracts/frontend.js
  var FRONTEND_K = 3;
  var FRONTEND_MATURITY_MS = 36e5;
  var FRONTEND_REPORT_WINDOW_MS = 1728e5;
  var FRONTEND_MAX_ROWS = 128;
  var exact = (v, keys2) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys2.length && keys2.every((k) => Object.hasOwn(v, k));
  var timestamp = (s) => {
    if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return false;
    const n = Date.parse(s);
    if (!Number.isFinite(n)) return false;
    const canonical = new Date(n).toISOString();
    return s === canonical || s === canonical.replace(".000Z", "Z");
  };
  function isFrontendPath(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.length > 256 || /[^\x20-\x7e]|[?#\\]|%(?:2f|5c)/i.test(value)) return false;
    try {
      if (new URL(value, "https://example.invalid").pathname !== value || value.startsWith("//")) return false;
      return value.split("/").every((segment) => {
        const decoded = decodeURIComponent(segment);
        return decoded.length <= 64 && !/[\x00-\x1f\x7f]/.test(decoded) && !/(?:0x)?[0-9a-f]{40}/i.test(decoded);
      });
    } catch {
      return false;
    }
  }
  function isFrontendHash(value) {
    if (typeof value !== "string" || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(value)) return false;
    try {
      const raw = atob(value.slice(7));
      return raw.length === 32 && btoa(raw) === value.slice(7);
    } catch {
      return false;
    }
  }
  function validateFrontendRecord(v) {
    try {
      if (!exact(v, ["schemaVersion", "kind", "site", "chainId", "scripts", "updatedAt"]) || v.schemaVersion !== 1 || v.kind !== "frontend" || typeof v.site !== "string" || !v.site || v.site.length > 253 || !Number.isSafeInteger(v.chainId) || v.chainId <= 0 || !timestamp(v.updatedAt) || !Array.isArray(v.scripts) || v.scripts.length > FRONTEND_MAX_ROWS || new TextEncoder().encode(JSON.stringify(v)).length > 61440) return false;
      const url = new URL("https://" + v.site);
      if (url.host !== v.site || url.pathname !== "/" || url.username || url.password || url.search || url.hash) return false;
      const updated = Date.parse(v.updatedAt);
      return v.scripts.every((row, i) => {
        if (!exact(row, ["path", "hash", "reporters", "firstSeen", "lastSeen", "established"]) || !isFrontendPath(row.path) || !isFrontendHash(row.hash) || !Number.isSafeInteger(row.reporters) || row.reporters < 2 || !timestamp(row.firstSeen) || !timestamp(row.lastSeen) || typeof row.established !== "boolean") return false;
        const first = Date.parse(row.firstSeen), last = Date.parse(row.lastSeen);
        const prev = v.scripts[i - 1];
        return first <= last && last <= updated && updated - last < FRONTEND_REPORT_WINDOW_MS && row.established === (row.reporters >= FRONTEND_K && updated - first >= FRONTEND_MATURITY_MS) && (!prev || prev.path < row.path || prev.path === row.path && prev.hash < row.hash);
      });
    } catch {
      return false;
    }
  }

  // packages/contracts/index.js
  var ADDRESS_RE = /^0x[0-9a-f]{40}$/;
  var DIGEST_RE = /^0x[0-9a-f]{64}$/;
  var ARKIV_ENTITY_REFERENCE_RE = /^[0-9a-f]{64}$/;
  var integer = (n) => Number.isSafeInteger(n) && n >= 0;
  var wellFormed = (s) => {
    for (let i = 0; i < s.length; i++) {
      const unit = s.charCodeAt(i);
      if (unit >= 55296 && unit <= 56319) {
        const next = s.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) return false;
      } else if (unit >= 56320 && unit <= 57343) return false;
    }
    return true;
  };
  var nonempty = (s) => typeof s === "string" && s.length > 0 && wellFormed(s);
  var isAddress = (v) => typeof v === "string" && ADDRESS_RE.test(v);
  var isDigest = (v) => typeof v === "string" && DIGEST_RE.test(v);
  var isArkivEntityReference = (v) => typeof v === "string" && ARKIV_ENTITY_REFERENCE_RE.test(v);
  var exact2 = (v, keys2) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys2.length && keys2.every((k) => Object.hasOwn(v, k));
  var host = (s) => {
    if (!nonempty(s)) return false;
    try {
      const u = new URL("https://" + s);
      return u.host === s && u.pathname === "/" && !u.username && !u.password && !u.search && !u.hash;
    } catch {
      return false;
    }
  };
  var network = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
  var timestamp2 = (s) => {
    if (typeof s !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return false;
    const date = new Date(s);
    if (Number.isNaN(date.getTime())) return false;
    const canonical = date.toISOString();
    return s === canonical || s === canonical.replace(".000Z", "Z");
  };
  var sortedUnique = (xs, predicate) => Array.isArray(xs) && xs.every((x, i) => predicate(x) && (i === 0 || xs[i - 1] < x));
  var addresses = (xs) => sortedUnique(xs, isAddress);
  var READ_ONLY_METHODS = Object.freeze(["eth_accounts", "eth_chainId", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "net_version"]);
  var ALREADY_SIGNED_METHODS = Object.freeze(["eth_sendRawTransaction"]);
  var ENS_CACHE_KEYS = Object.freeze(["bound.attest.v1", "bound.frontend.v1"]);
  var ENS_CACHE_VALUE_MAX = 16384;
  var ensName = (s) => nonempty(s) && s.length <= 255 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
  var baseRecord = (v, keys2) => exact2(v, ["schemaVersion", "kind", "site", "chainId", ...keys2]) && v.schemaVersion === 1 && host(v.site) && integer(v.chainId) && v.chainId > 0;
  var change = (v) => exact2(v, ["kind", "before", "after"]) && ["ns", "cert", "a-record"].includes(v.kind) && sortedUnique(v.before, nonempty) && v.before.length > 0 && sortedUnique(v.after, nonempty) && v.after.length > 0 && JSON.stringify(v.before) !== JSON.stringify(v.after);
  function validateRecord(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    switch (v.kind) {
      case "frontend":
        return validateFrontendRecord(v);
      case "observation":
        return baseRecord(v, ["value", "reporterKey", "event"]) && isAddress(v.value) && nonempty(v.reporterKey) && ["counterparty", "called-contract", "warned"].includes(v.event);
      case "baseline":
        return baseRecord(v, ["counterparties", "calledContracts", "updatedAt"]) && addresses(v.counterparties) && addresses(v.calledContracts) && timestamp2(v.updatedAt);
      case "drift":
        return baseRecord(v, ["changes", "corroborated", "evidenceReference", "detectedAt"]) && Array.isArray(v.changes) && v.changes.length > 0 && v.changes.every((item, i) => change(item) && (!i || v.changes[i - 1].kind < item.kind)) && typeof v.corroborated === "boolean" && isArkivEntityReference(v.evidenceReference) && timestamp2(v.detectedAt);
      case "incident": {
        const isReportRef = baseRecord(v, ["trigger", "severity", "counterparty", "reportDigest", "reportReference", "createdAt"]) && typeof v.reportReference === "string" && /^[0-9a-f]{64}$/.test(v.reportReference);
        const isSwarmRef = baseRecord(v, ["trigger", "severity", "counterparty", "reportDigest", "swarmReference", "createdAt"]) && typeof v.swarmReference === "string" && /^[0-9a-f]{64}$/.test(v.swarmReference);
        return (isReportRef || isSwarmRef) && ["drift+warned", "K-same-counterparty-warned"].includes(v.trigger) && v.severity === "high" && isAddress(v.counterparty) && isDigest(v.reportDigest) && timestamp2(v.createdAt);
      }
      case "evidence":
        return baseRecord(v, ["digest", "payload", "createdAt"]) && isDigest(v.digest) && typeof v.payload === "string" && v.payload.length > 0 && new TextEncoder().encode(v.payload).length <= 61440 && timestamp2(v.createdAt);
      case "trust_snapshot":
        return exact2(v, ["schemaVersion", "kind", "network", "epoch", "digest", "canonical"]) && v.schemaVersion === 1 && network(v.network) && integer(v.epoch) && v.epoch > 0 && isDigest(v.digest) && typeof v.canonical === "string" && v.canonical.length > 0 && new TextEncoder().encode(v.canonical).length <= 61440;
      case "status":
        return baseRecord(v, ["state", "feedReference", "incidentReference", "updatedAt"]) && ["normal", "drift", "incident"].includes(v.state) && isDigest(v.feedReference) && (v.state === "incident" ? v.incidentReference === null || isDigest(v.incidentReference) : v.incidentReference === null) && timestamp2(v.updatedAt);
      // Watcher-asserted copy of ENS text records for one curated site. It is a
      // cache for availability and display only; it never establishes trust.
      case "ens_record":
        return baseRecord(v, ["name", "resolver", "records", "resolvedAt"]) && ensName(v.name) && isAddress(v.resolver) && timestamp2(v.resolvedAt) && v.records !== null && typeof v.records === "object" && !Array.isArray(v.records) && Object.keys(v.records).length > 0 && Object.entries(v.records).every(([k, text]) => ENS_CACHE_KEYS.includes(k) && typeof text === "string" && text.length <= ENS_CACHE_VALUE_MAX && wellFormed(text));
      default:
        return false;
    }
  }
  function parseUniqueJSON(text) {
    if (typeof text !== "string" || text.length > 1e6) throw new Error("invalid JSON size");
    const value = JSON.parse(text);
    let i = 0;
    const ws = () => {
      while (i < text.length && /\s/.test(text[i])) i++;
    };
    const str = () => {
      const start = i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i++] === '"') {
          const value2 = JSON.parse(text.slice(start, i));
          if (!wellFormed(value2)) throw new Error("invalid Unicode string");
          return value2;
        }
      }
      throw new Error("unterminated string");
    };
    const scan = (depth) => {
      if (depth > 100) throw new Error("JSON nesting limit");
      ws();
      if (text[i] === '"') {
        str();
        return;
      }
      if (text[i] === "{") {
        i++;
        ws();
        const keys2 = /* @__PURE__ */ new Set();
        if (text[i] === "}") {
          i++;
          return;
        }
        for (; ; ) {
          ws();
          const key = str();
          if (keys2.has(key)) throw new Error("duplicate JSON key");
          keys2.add(key);
          ws();
          i++;
          scan(depth + 1);
          ws();
          if (text[i++] === "}") return;
        }
      }
      if (text[i] === "[") {
        i++;
        ws();
        if (text[i] === "]") {
          i++;
          return;
        }
        for (; ; ) {
          scan(depth + 1);
          ws();
          if (text[i++] === "]") return;
        }
      }
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    };
    scan(0);
    return value;
  }

  // apps/safe-page/src/fragment.mjs
  var keys = (v, k) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === k.length && k.every((x) => Object.hasOwn(v, x));
  var coverage = ["total", "compared", "inlineExcluded", "queryExcluded", "crossOriginExcluded", "privatePathExcluded", "unavailable", "overCap"];
  function validSite(s) {
    try {
      const u = new URL("https://" + s);
      return typeof s === "string" && s.length <= 253 && u.host === s && u.pathname === "/" && !u.username && !u.password && !u.search && !u.hash;
    } catch {
      return false;
    }
  }
  var chain = (s) => typeof s === "string" && /^[1-9][0-9]*$/.test(s) && Number.isSafeInteger(Number(s));
  function valid(v) {
    return keys(v, ["v", "site", "chain", "score", "sev", "reason", "conflicts", "unfamiliar", "cov", "ticket", "watcher"]) && v.v === 1 && validSite(v.site) && chain(v.chain) && (v.score === null || Number.isInteger(v.score) && v.score >= 0 && v.score <= 100) && ["pass", "warning", "huge", "firewall"].includes(v.sev) && Array.isArray(v.reason) && v.reason.length <= 3 && new Set(v.reason).size === v.reason.length && v.reason.every((x) => ["drift", "incident", "counterparty"].includes(x)) && Array.isArray(v.conflicts) && v.conflicts.length <= 16 && v.conflicts.every((x) => keys(x, ["path", "observed", "expected"]) && isFrontendPath(x.path) && isFrontendHash(x.observed) && Array.isArray(x.expected) && x.expected.length <= 4 && x.expected.every(isFrontendHash)) && Array.isArray(v.unfamiliar) && v.unfamiliar.length <= 16 && v.unfamiliar.every((x) => keys(x, ["path", "hash"]) && isFrontendPath(x.path) && isFrontendHash(x.hash)) && keys(v.cov, coverage) && coverage.every((k) => Number.isSafeInteger(v.cov[k]) && v.cov[k] >= 0) && coverage.slice(1).reduce((n, k) => n + v.cov[k], 0) === v.cov.total && typeof v.ticket === "string" && /^[0-9a-f]{32}$/.test(v.ticket) && typeof v.watcher === "string" && /^0x[0-9a-f]{40}$/.test(v.watcher);
  }
  function parseSafeFragment(hash) {
    try {
      if (typeof hash !== "string" || !hash.startsWith("#") || hash.length > 65536) return null;
      const raw = decodeURIComponent(hash.slice(1));
      if (new TextEncoder().encode(raw).length > 16384) return null;
      const v = parseUniqueJSON(raw);
      return valid(v) ? v : null;
    } catch {
      return null;
    }
  }

  // apps/safe-page/src/community.mjs
  var DEFAULT_CONFIG = Object.freeze({ rpcUrl: "https://rpc.rabdi.db-chain.testnet.arkiv.network", arkivChainId: 7794095, watchers: ["0xe63393558e36df643347326e7e03ad5fb0e6c867"] });
  var config = typeof define_SAFE_CONFIG_default === "undefined" ? DEFAULT_CONFIG : define_SAFE_CONFIG_default;
  var unavailable = () => ({ state: "unavailable", fetchedAt: null, ageMs: null, verifiedAt: null, block: null, frontend: null, rawDrift: false, corroboratedDrift: false, activeIncident: false, ambiguous: false });
  var qty = (s) => {
    if (typeof s !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(s)) throw Error("quantity");
    const n = Number(BigInt(s));
    if (!Number.isSafeInteger(n)) throw Error("quantity");
    return n;
  };
  function decode(attributes) {
    if (!Array.isArray(attributes)) throw Error("attributes");
    const s = attributes.filter((x) => x?.name === "arkiv.schema"), p = attributes.filter((x) => x?.name === "payload");
    if (s.length !== 1 || s[0].type !== "str" || s[0].value !== "bound.record.v1" || p.length !== 1 || p[0].type !== "bytes" || typeof p[0].value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(p[0].value) || p[0].value.length > 262146) throw Error("payload");
    const bytes = Uint8Array.from(p[0].value.slice(2).match(/../g) || [], (x) => parseInt(x, 16));
    const v = parseUniqueJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validateRecord(v) || !["frontend", "status", "drift", "incident"].includes(v.kind)) throw Error("record");
    return v;
  }
  async function textBound(response, budget) {
    if (!response.ok || !/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw Error("response");
    const len = response.headers.get("content-length");
    if (len !== null && (!/^\d+$/.test(len) || Number(len) > 1e6)) throw Error("size");
    if (!response.body?.getReader) throw Error("stream required");
    const reader = response.body.getReader(), parts = [];
    let size = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || (size += value.length) > 1e6 || (budget.bytes += value.length) > 4e6) throw Error("size");
        parts.push(value);
      }
    } finally {
      reader.cancel().catch(() => {
      });
      reader.releaseLock();
    }
    const out = new Uint8Array(size);
    let i = 0;
    for (const p of parts) {
      out.set(p, i);
      i += p.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(out);
  }
  async function querySafeCommunity({ rpcUrl, watcher, chainId, site, fetchImpl = fetch, now = Date.now }) {
    const controller = new AbortController();
    let timer;
    try {
      if (rpcUrl !== config.rpcUrl || !config.watchers.includes(watcher) || !validSite(site) || typeof chainId !== "string" || !/^[1-9][0-9]*$/.test(chainId) || !Number.isSafeInteger(Number(chainId)) || typeof fetchImpl !== "function") throw Error("input");
      let id = 0;
      const budget = { bytes: 0 };
      const request = async (method, params) => {
        if (controller.signal.aborted) throw Error("aborted");
        const current = ++id;
        const r = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: current, method, params }), credentials: "omit", redirect: "error", signal: controller.signal });
        if (controller.signal.aborted) throw Error("aborted");
        const v = parseUniqueJSON(await textBound(r, budget));
        if (controller.signal.aborted) throw Error("aborted");
        if (!v || v.jsonrpc !== "2.0" || v.id !== current || Object.hasOwn(v, "error") || !Object.hasOwn(v, "result")) throw Error("rpc");
        return v.result;
      };
      const work = (async () => {
        if (qty(await request("eth_chainId", [])) !== config.arkivChainId) throw Error("chain");
        let pages = 0, rows = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          let cursor = null, block = null, entries = [], changed = false;
          while (pages++ < 64) {
            const expr = `$owner = addr(${watcher}) AND arkiv.schema = str('bound.record.v1') AND (kind = str('frontend') OR kind = str('status') OR kind = str('drift') OR kind = str('incident'))${cursor ? ` AND $key > key(${cursor})` : ""} ORDER BY $key ASC`;
            const r = await request("arkiv_query", [expr, { select: { key: true, owner: true, expiresAt: true, attributes: true }, limit: "0x4" }]);
            if (!r || !Array.isArray(r.data) || r.data.length > 4 || (rows += r.data.length) > 256) throw Error("rows");
            const b = qty(r.blockNumber);
            if (block !== null && block !== b) {
              changed = true;
              break;
            }
            block = b;
            for (const row of r.data) {
              if (!row || !/^0x[0-9a-f]{64}$/.test(row.key) || cursor && row.key <= cursor || row.owner !== watcher || qty(row.expiresAt) <= block) throw Error("row");
              cursor = row.key;
              const record = decode(row.attributes);
              entries.push({ key: row.key, record });
            }
            if (r.data.length < 4) {
              const time = now();
              if (!Number.isSafeInteger(time) || time < 0) throw Error("clock");
              for (const { record } of entries) for (const k of ["updatedAt", "detectedAt", "createdAt"]) if (record[k] && Date.parse(record[k]) > time) throw Error("future");
              entries = entries.filter((x) => x.record.site === site && String(x.record.chainId) === chainId);
              const by = (k) => entries.filter((x) => x.record.kind === k), f = by("frontend"), s = by("status"), d = by("drift"), inc = by("incident"), status = s.length === 1 ? s[0].record : null;
              return { state: "fresh", fetchedAt: time, ageMs: 0, verifiedAt: time, block, frontend: f.length === 1 ? { ...f[0].record, scripts: f[0].record.scripts.filter((x) => time - Date.parse(x.lastSeen) < 1728e5) } : null, rawDrift: s.some((x) => x.record.state === "drift"), corroboratedDrift: status?.state === "drift" && d.length === 1 && d[0].record.detectedAt === status.updatedAt && d[0].record.corroborated === true, activeIncident: status?.state === "incident" && inc.length === 1 && status.incidentReference === inc[0].key, ambiguous: f.length !== 1 || s.length !== 1 };
            }
          }
          if (!changed || attempt) throw Error("pagination");
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw Error("pagination");
      })();
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("timeout"));
        }, 8e3);
      });
      return await Promise.race([work, deadline]);
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  // apps/safe-page/src/app.mjs
  var config2 = typeof define_SAFE_CONFIG_default === "undefined" ? DEFAULT_CONFIG : define_SAFE_CONFIG_default;
  function liveEvidenceDisagrees(evidence, result) {
    if (evidence.reason.includes("incident") !== result.activeIncident || evidence.reason.includes("drift") !== result.corroboratedDrift) return true;
    if (!result.frontend || result.ambiguous) return evidence.conflicts.length > 0 || evidence.unfamiliar.length > 0;
    const hashes = (path) => result.frontend.scripts.filter((row) => row.established === true && row.path === path).map((row) => row.hash).sort();
    return evidence.conflicts.some((row) => {
      const expected = hashes(row.path);
      return expected.includes(row.observed) || JSON.stringify(expected) !== JSON.stringify([...row.expected].sort());
    }) || evidence.unfamiliar.some((row) => hashes(row.path).length > 0);
  }
  function startSafePage({ window: win = window, document: doc = document, query = querySafeCommunity } = {}) {
    let evidence = null;
    try {
      evidence = parseSafeFragment(win.location.hash);
    } finally {
      win.history.replaceState(null, "", win.location.pathname + win.location.search);
    }
    const by = (id) => doc.getElementById(id), set = (id, value) => {
      by(id).textContent = value;
    };
    const confirm = by("confirm");
    confirm.disabled = !evidence;
    by("leave").addEventListener("click", () => win.location.assign("about:blank"));
    if (!evidence) {
      set("summary", "This page could not read the extension evidence.");
      set("live", "Live community data unavailable.");
      return;
    }
    set("summary", `Site: ${evidence.site} \xB7 Chain: ${evidence.chain} \xB7 Severity: ${evidence.sev} \xB7 Score: ${evidence.score ?? "unavailable"}`);
    set("reasons", `Corroboration: ${evidence.reason.join(", ") || "none"}`);
    set("coverage", `Observed scripts: ${evidence.cov.compared} of ${evidence.cov.total}. ${Object.entries(evidence.cov).filter(([key]) => !["total", "compared"].includes(key)).map(([key, value]) => `${key}: ${value}`).join("; ")}. Cached bytes may differ from executed code.`);
    const rows = by("rows");
    for (const row of evidence.conflicts) {
      const li = doc.createElement("li");
      li.textContent = `${row.path}: observed ${row.observed}; expected ${row.expected.join(", ")}`;
      rows.appendChild(li);
    }
    for (const row of evidence.unfamiliar) {
      const li = doc.createElement("li");
      li.textContent = `${row.path}: unfamiliar ${row.hash}`;
      rows.appendChild(li);
    }
    const message = (type) => {
      const payload = { type, ticket: evidence.ticket };
      if (win.location.protocol === "chrome-extension:" && win.chrome?.runtime?.sendMessage) {
        try {
          Promise.resolve(win.chrome.runtime.sendMessage(payload)).catch(() => {
          });
        } catch {
        }
      } else win.postMessage(payload, win.location.origin);
    };
    confirm.addEventListener("click", () => message("BOUND_SAFE_CONFIRM_V1"));
    message("BOUND_SAFE_READY_V1");
    set("live", "Checking live community data\u2026");
    Promise.resolve().then(() => query({ rpcUrl: config2.rpcUrl, watcher: evidence.watcher, chainId: evidence.chain, site: evidence.site })).then((result) => {
      if (result.state !== "fresh") {
        set("live", "From your extension; live community data unavailable.");
        return;
      }
      set("live", `Live community data: ${result.ambiguous ? "ambiguous" : result.activeIncident ? "active incident" : result.corroboratedDrift ? "corroborated drift" : result.rawDrift ? "reported drift" : "no linked incident or corroborated drift"} (block ${result.block}).${liveEvidenceDisagrees(evidence, result) ? " Live data and extension evidence may disagree." : ""}`);
    }).catch(() => set("live", "From your extension; live community data unavailable."));
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") startSafePage();
})();

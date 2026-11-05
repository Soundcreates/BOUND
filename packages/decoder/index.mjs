const READ_ONLY = new Set([
  "eth_chainId", "net_version", "eth_accounts", "eth_coinbase", "eth_blockNumber",
  "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_getBalance", "eth_getStorageAt", "eth_getTransactionCount", "eth_getCode",
  "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getLogs", "eth_feeHistory", "eth_syncing",
  "eth_mining", "eth_hashrate", "eth_protocolVersion", "wallet_getPermissions",
  "eth_sendRawTransaction"
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KNOWN = new Map([
  ["095ea7b3", "approve"], ["39509351", "increaseAllowance"],
  ["a9059cbb", "transfer"], ["23b872dd", "transferFrom"],
  ["a22cb465", "setApprovalForAll"], ["42842e0e", "safeTransferFrom"],
  ["b88d4fde", "safeTransferFrom"]
]);

export function cloneRequest(value, { maxBytes = 262_144, maxDepth = 32 } = {}) {
  const seen = new WeakSet();
  function copy(item, depth) {
    if (depth > maxDepth) throw new TypeError("Request nesting is too deep");
    if (item === null || ["string", "boolean", "number"].includes(typeof item)) {
      if (typeof item === "number" && !Number.isFinite(item)) throw new TypeError("Invalid number");
      return item;
    }
    if (typeof item !== "object" || seen.has(item)) throw new TypeError("Request is not plain data");
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) throw new TypeError("Request is not plain data");
    seen.add(item);
    const out = Array.isArray(item) ? [] : Object.create(null);
    if (Array.isArray(item)) Object.setPrototypeOf(out, null);
    const ownKeys = Reflect.ownKeys(item);
    for (let i = 0; i < ownKeys.length; i++) {
      const key = ownKeys[i];
      if (typeof key !== "string") throw new TypeError("Symbol request keys are not supported");
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) throw new TypeError("Accessors are not supported");
      out[key] = copy(descriptor.value, depth + 1);
    }
    seen.delete(item);
    return Object.freeze(out);
  }
  const cloned = copy(value, 0);
  if (new TextEncoder().encode(JSON.stringify(cloned)).length > maxBytes) throw new TypeError("Request is too large");
  return cloned;
}

export function classifyRequest(request) {
  const method = request?.method;
  if (typeof method !== "string") return { kind: "unsupported", method: "unknown", entries: [], cap: 0 };
  if (READ_ONLY.has(method)) return { kind: "read_only", method, entries: [], cap: 100 };
  if (method === "eth_sign") return { kind: "escalated", method, entries: [], cap: 0, label: "Blind signature" };
  if (method === "personal_sign") return { kind: "decoded", method, entries: [], cap: 65, label: "No counterparty decoded" };
  if (["eth_sendTransaction", "eth_signTransaction"].includes(method)) {
    return decodeTransactions(method, request.params?.[0]);
  }
  if (["eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4"].includes(method)) {
    return decodeTypedData(method, request.params?.[1] ?? request.params?.[0]);
  }
  if (["wallet_signAuthorization", "eth_signAuthorization"].includes(method)) {
    const auth = request.params?.[0] || {};
    const address = auth.address || auth.delegateAddress;
    const zeroChain = isZero(auth.chainId);
    return { kind: "decoded", method, entries: address && ADDRESS.test(address) ? [{ address: normalize(address), role: "rights" }] : [], cap: zeroChain ? 0 : 100, label: zeroChain ? "EIP-7702 chainId zero" : undefined };
  }
  if (method === "wallet_sendCalls") return decodeBatch(request.params?.[0]);
  return { kind: "unsupported", method, entries: [], cap: 0 };
}

function decodeTransactions(method, tx) {
  if (!tx || typeof tx !== "object" || !ADDRESS.test(tx.to || "")) return malformed(method);
  const entries = [{ address: normalize(tx.to), role: "called" }];
  if (tx.value !== undefined) {
    try {
      if (typeof tx.value !== "string" || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(tx.value)) throw new TypeError("Transaction value must be an exact integer string");
      const value = BigInt(tx.value);
      if (value > 0n) entries.push({ address: normalize(tx.to), role: "destination" });
    } catch { return malformed(method, entries); }
  }
  let cap = 100;
  if (tx.authorizationList !== undefined && (!Array.isArray(tx.authorizationList) || tx.authorizationList.length > 16)) return malformed(method, entries);
  const authorizations = tx.authorizationList || [];
  for (let i = 0; i < authorizations.length; i++) {
    const authorization = authorizations[i];
    const delegate = authorization.address || authorization.delegateAddress;
    if (!ADDRESS.test(delegate || "")) return malformed(method, entries);
    entries.push({ address: normalize(delegate), role: "rights" });
    if (isZero(authorization.chainId)) cap = 0;
  }
  const data = tx.data || tx.input || "0x";
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) return malformed(method, entries);
  const hex = data.slice(2).toLowerCase();
  if (hex.length < 8) return { kind: "decoded", method, entries, cap, label: cap === 0 ? "EIP-7702 chainId zero" : undefined };
  const selector = hex.slice(0, 8), name = KNOWN.get(selector);
  if (!name) return opaque(method, entries, data, cap);
  const words = hex.slice(8).match(/.{64}/g) || [];
  const addressAt = (index) => {
    if (!words[index]) throw new TypeError("Truncated known calldata");
    const address = `0x${words[index].slice(24)}`;
    if (!ADDRESS.test(address)) throw new TypeError("Invalid address word");
    return normalize(address);
  };
  try {
    if (name === "approve" || name === "increaseAllowance") entries.push({ address: addressAt(0), role: "rights" });
    if (name === "transfer") entries.push({ address: addressAt(0), role: "destination" });
    if (name === "transferFrom") entries.push({ address: addressAt(1), role: "destination" });
    if (name === "setApprovalForAll") entries.push({ address: addressAt(0), role: "rights" });
    if (name === "safeTransferFrom") entries.push({ address: addressAt(1), role: "destination" });
  } catch { return malformed(method, entries); }
  return { kind: "decoded", method, entries, cap, label: cap === 0 ? "EIP-7702 chainId zero" : undefined };
}

function decodeTypedData(method, payload) {
  let data = payload;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return malformed(method); }
  }
  if (!data || typeof data !== "object") return malformed(method);
  const primary = String(data.primaryType || "");
  const message = data.message || {};
  const entries = [];
  const add = (value, role) => { if (ADDRESS.test(value || "")) entries.push({ address: normalize(value), role }); };
  if (/Permit2.*(Transfer|Witness)|SignatureTransfer|Permit.*TransferFrom|Witness/i.test(primary)) {
    scanAddresses(data, entries);
    return { kind: "opaque", method, entries: unique(entries), cap: 65, label: "Destination not fixed by signature" };
  }
  if (/PermitSingle|PermitBatch/i.test(primary)) {
    const details = message.details || (message.detail ? [message.detail] : []);
    for (let i = 0; i < details.length; i++) add(details[i].token, "token");
    add(message.spender, "rights");
    return { kind: "decoded", method, entries: unique(entries), cap: 100 };
  }
  if (/Permit/i.test(primary)) {
    add(message.spender, "rights");
    add(message.token, "token");
    return { kind: "decoded", method, entries: unique(entries), cap: 100 };
  }
  if (/Order|Parameters/i.test(primary) && Array.isArray(message.consideration)) {
    for (const item of message.consideration) add(item.recipient, "destination");
    scanAddresses(data.domain, entries, "called");
    return { kind: "decoded", method, entries: unique(entries), cap: 100 };
  }
  scanAddresses(data, entries);
  return { kind: "opaque", method, entries: unique(entries).map((entry) => ({ ...entry, verified: false })), cap: 65, label: "Typed-data fields not recognized" };
}

function decodeBatch(batch) {
  if (!batch || !Array.isArray(batch.calls) || batch.calls.length > 64) return malformed("wallet_sendCalls");
  const entries = [];
  let kind = "decoded", cap = 100;
  for (let i = 0; i < batch.calls.length; i++) {
    const call = batch.calls[i];
    const item = decodeTransactions("wallet_sendCalls", call);
    entries.push(...item.entries);
    if (item.kind === "malformed") { kind = "malformed"; cap = Math.min(cap, item.cap); }
    else if (item.kind === "opaque" && kind !== "malformed") { kind = "opaque"; cap = Math.min(cap, item.cap); }
  }
  return { kind, method: "wallet_sendCalls", entries: unique(entries), cap };
}

function opaque(method, entries, data, baseCap = 100) {
  const hits = [];
  const body = String(data).slice(10, 32_778);
  const scan = [];
  for (let offset = 0; offset + 64 <= body.length; offset += 64) {
    const word = body.slice(offset, offset + 64);
    // shortcut: ignore low 64-bit ABI words to avoid common small integers looking like addresses; add selector decoding when a known call needs them.
    if (/^0{24}[0-9a-f]{40}$/.test(word) && BigInt(`0x${word}`) >= 1n << 64n) scan.push(`0x${word.slice(24)}`);
  }
  for (const address of scan) hits.push({ address: normalize(address), role: "unknown", verified: false });
  return { kind: "opaque", method, entries: unique([...entries, ...hits]), cap: baseCap, label: "Unknown calldata" };
}

function scanAddresses(value, out, role = "unknown", depth = 0) {
  if (depth > 16 || out.length >= 128) return;
  if (typeof value === "string") {
    for (const address of value.match(/0x[0-9a-fA-F]{40}/g) || []) out.push({ address: normalize(address), role, verified: false });
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) scanAddresses(value[i], out, role, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) scanAddresses(item, out, role, depth + 1);
  }
}
function malformed(method, entries = []) { return { kind: "malformed", method, entries, cap: 35, label: "Malformed or truncated request" }; }
function normalize(address) { return address.toLowerCase(); }
function isZero(value) {
  try { return value !== undefined && BigInt(value) === 0n; } catch { return false; }
}
function unique(entries) { const seen = new Set(); return entries.filter((e) => { const k = `${e.address}:${e.role}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

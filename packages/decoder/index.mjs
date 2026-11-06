const READ_ONLY = new Set([
  "eth_chainId", "net_version", "eth_accounts", "eth_coinbase", "eth_blockNumber",
  "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_getBalance", "eth_getStorageAt", "eth_getTransactionCount", "eth_getCode",
  "eth_getBlockByHash", "eth_getBlockByNumber", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getLogs", "eth_feeHistory", "eth_syncing",
  "eth_mining", "eth_hashrate", "eth_protocolVersion", "wallet_getPermissions",
  "net_listening", "web3_clientVersion", "eth_getProof", "eth_subscribe", "eth_unsubscribe",
  "eth_getBlockTransactionCountByHash", "eth_getBlockTransactionCountByNumber",
  "eth_getTransactionByBlockHashAndIndex", "eth_getTransactionByBlockNumberAndIndex",
  "eth_getUncleByBlockHashAndIndex", "eth_getUncleByBlockNumberAndIndex",
  "wallet_getCapabilities", "wallet_getCallsStatus", "wallet_revokePermissions",
  // Wallet-prompted network switch: no signature or value; the wallet asks the user
  // itself and BOUND re-checks chain state before any later value-moving request.
  "wallet_switchEthereumChain",
  "eth_sendRawTransaction",
  // Connection requests receive an additional site-status gate in the service worker.
  "eth_requestAccounts", "wallet_requestPermissions", "metamask_getProviderState"
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KNOWN = new Map([
  ["095ea7b3", "approve"], ["39509351", "increaseAllowance"],
  ["a9059cbb", "transfer"], ["23b872dd", "transferFrom"],
  ["a22cb465", "setApprovalForAll"], ["42842e0e", "safeTransferFrom"],
  ["b88d4fde", "safeTransferFrom"], ["87517c45", "permit2Approve"]
]);
const PERMIT_FIELDS = [["owner", "address"], ["spender", "address"], ["value", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]];
const DAI_PERMIT_FIELDS = [["holder", "address"], ["spender", "address"], ["nonce", "uint256"], ["expiry", "uint256"], ["allowed", "bool"]];
const PERMIT_DETAILS_FIELDS = [["token", "address"], ["amount", "uint160"], ["expiration", "uint48"], ["nonce", "uint48"]];
const OFFER_FIELDS = [["itemType", "uint8"], ["token", "address"], ["identifierOrCriteria", "uint256"], ["startAmount", "uint256"], ["endAmount", "uint256"]];
const CONSIDERATION_FIELDS = [...OFFER_FIELDS, ["recipient", "address"]];
const ORDER_FIELDS = [["offerer", "address"], ["zone", "address"], ["offer", "OfferItem[]"], ["consideration", "ConsiderationItem[]"], ["orderType", "uint8"], ["startTime", "uint256"], ["endTime", "uint256"], ["zoneHash", "bytes32"], ["salt", "uint256"], ["conduitKey", "bytes32"], ["counter", "uint256"]];

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
  let method = "unknown";
  try {
    const candidate = request?.method;
    method = typeof candidate === "string" ? candidate : method;
    return classify(request, method);
  } catch { return malformed(method); }
}

function classify(request, method) {
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
    if (!ADDRESS.test(address || "") || !isUintString(auth.chainId)) return malformed(method);
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
    if (!authorization || typeof authorization !== "object") return malformed(method, entries);
    const delegate = authorization.address || authorization.delegateAddress;
    if (!ADDRESS.test(delegate || "") || !isUintString(authorization.chainId)) return malformed(method, entries);
    entries.push({ address: normalize(delegate), role: "rights" });
    if (isZero(authorization.chainId)) cap = 0;
  }
  if (tx.data !== undefined && tx.input !== undefined && tx.data !== tx.input) return malformed(method, entries);
  const data = tx.data ?? tx.input ?? "0x";
  if (typeof data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) return malformed(method, entries);
  const hex = data.slice(2).toLowerCase();
  if (hex.length === 0) return { kind: "decoded", method, entries, cap, label: cap === 0 ? "EIP-7702 chainId zero" : undefined };
  if (hex.length < 8) return opaque(method, entries, data, cap);
  const selector = hex.slice(0, 8), name = KNOWN.get(selector);
  if (!name) return opaque(method, entries, data, cap);
  const words = hex.slice(8).match(/.{64}/g) || [];
  const requiredWords = { approve: 2, increaseAllowance: 2, transfer: 2, transferFrom: 3, setApprovalForAll: 2, safeTransferFrom: selector === "b88d4fde" ? 4 : 3, permit2Approve: 4 };
  if (hex.length !== 8 + words.length * 64 || words.length < requiredWords[name]) return malformed(method, entries);
  if (selector === "b88d4fde") {
    if (words.length < 5 || BigInt(`0x${words[3]}`) !== 128n) return malformed(method, entries);
    const byteLength = BigInt(`0x${words[4]}`);
    const dataWords = (byteLength + 31n) / 32n;
    if (dataWords !== BigInt(words.length - 5) || byteLength > BigInt(Number.MAX_SAFE_INTEGER)) return malformed(method, entries);
    const padding = words.at(-1).slice(Number(byteLength % 32n) * 2);
    if (byteLength % 32n && !/^0*$/.test(padding)) return malformed(method, entries);
  } else if (words.length !== requiredWords[name]) {
    return malformed(method, entries);
  }
  const addressAt = (index) => {
    if (!words[index]) throw new TypeError("Truncated known calldata");
    if (!/^0{24}/.test(words[index])) throw new TypeError("Invalid address padding");
    const address = `0x${words[index].slice(24)}`;
    if (!ADDRESS.test(address)) throw new TypeError("Invalid address word");
    return normalize(address);
  };
  const approvals = [];
  try {
    if (name === "approve" || name === "increaseAllowance") {
      entries.push({ address: normalize(tx.to), role: "token" });
      entries.push({ address: addressAt(0), role: "rights" });
      approvals.push({ token: normalize(tx.to), spender: addressAt(0) });
    }
    if (["transfer", "transferFrom", "setApprovalForAll", "safeTransferFrom"].includes(name)) entries.push({ address: normalize(tx.to), role: "token" });
    if (name === "transfer") entries.push({ address: addressAt(0), role: "destination" });
    if (name === "permit2Approve") {
      if (BigInt(`0x${words[2]}`) >= 1n << 160n || BigInt(`0x${words[3]}`) >= 1n << 48n) throw new TypeError("Invalid Permit2 amount or expiration");
      entries.push({ address: addressAt(0), role: "token" });
      entries.push({ address: addressAt(1), role: "rights" });
      approvals.push({ token: addressAt(0), spender: addressAt(1) });
    }
    if (name === "transferFrom") {
      entries.push({ address: addressAt(1), role: "destination" });
    }
    if (name === "setApprovalForAll") {
      if (BigInt(`0x${words[1]}`) > 1n) throw new TypeError("Invalid approval flag");
      entries.push({ address: addressAt(0), role: "rights" });
      approvals.push({ token: normalize(tx.to), spender: addressAt(0) });
    }
    if (name === "safeTransferFrom") {
      entries.push({ address: addressAt(1), role: "destination" });
    }
  } catch { return malformed(method, entries); }
  return { kind: "decoded", method, entries, cap, ...(approvals.length ? { approvals } : {}), label: cap === 0 ? "EIP-7702 chainId zero" : undefined };
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
    const permissions = Array.isArray(message.permitted) ? message.permitted : message.permitted ? [message.permitted] : [];
    for (const permission of permissions) add(permission?.token, "token");
    add(message.spender, "rights");
    add(data.domain?.verifyingContract, "called");
    scanAddresses(data, entries);
    return { kind: "opaque", method, entries: unique(entries), cap: 65, label: "Destination not fixed by signature" };
  }
  if (primary === "PermitSingle" || primary === "PermitBatch") {
    const details = Array.isArray(message.details) ? message.details : message.details ? [message.details] : [];
    if (!details.length || !ADDRESS.test(message.spender || "") || details.some((item) => !item || !ADDRESS.test(item.token || ""))) return malformed(method);
    for (let i = 0; i < details.length; i++) add(details[i].token, "token");
    add(message.spender, "rights");
    add(data.domain?.verifyingContract, "called");
    const fields = [["details", primary === "PermitSingle" ? "PermitDetails" : "PermitDetails[]"], ["spender", "address"], ["sigDeadline", "uint256"]];
    const extra = !matchesFields(data.types, primary, fields) || !matchesFields(data.types, "PermitDetails", PERMIT_DETAILS_FIELDS) || !hasValues(message, fields) || hasOtherFields(message, ["details", "spender", "sigDeadline"]) || details.some((item) => !hasValues(item, PERMIT_DETAILS_FIELDS) || hasOtherFields(item, ["token", "amount", "expiration", "nonce"]));
    if (extra) scanAddresses(data, entries);
    const approvals = !extra ? details.map(item => ({ token: normalize(item.token), spender: normalize(message.spender) })) : [];
    return { kind: extra ? "opaque" : "decoded", method, entries: unique(extra ? entries.map((entry) => entry.role === "unknown" ? { ...entry, verified: false } : entry) : entries), cap: extra ? 65 : 100, ...(approvals.length ? { approvals } : {}), label: extra ? "Typed-data fields not recognized" : undefined };
  }
  if (primary === "Permit") {
    if (!ADDRESS.test(message.spender || "")) return malformed(method);
    add(message.spender, "rights");
    add(data.domain?.verifyingContract, "token");
    const validPermit = (matchesFields(data.types, primary, PERMIT_FIELDS) && hasValues(message, PERMIT_FIELDS)) || (matchesFields(data.types, primary, DAI_PERMIT_FIELDS) && hasValues(message, DAI_PERMIT_FIELDS));
    const extra = !validPermit || hasOtherFields(message, ["owner", "holder", "spender", "value", "nonce", "deadline", "expiry", "allowed"]);
    if (extra) scanAddresses(data, entries);
    const approvals = !extra && ADDRESS.test(data.domain?.verifyingContract || "") ? [{ token: normalize(data.domain.verifyingContract), spender: normalize(message.spender) }] : [];
    return { kind: extra ? "opaque" : "decoded", method, entries: unique(extra ? entries.map((entry) => entry.role === "unknown" ? { ...entry, verified: false } : entry) : entries), cap: extra ? 65 : 100, ...(approvals.length ? { approvals } : {}), label: extra ? "Typed-data fields not recognized" : undefined };
  }
  if (["OrderComponents", "OrderParameters"].includes(primary) && Array.isArray(message.consideration)) {
    if (message.consideration.some((item) => !item || typeof item !== "object")) return malformed(method);
    for (const item of message.consideration) add(item.recipient, "destination");
    add(data.domain?.verifyingContract, "called");
    if (message.zone !== `0x${"0".repeat(40)}`) add(message.zone, "called");
    for (const item of [...(Array.isArray(message.offer) ? message.offer : []), ...message.consideration]) if (item.token !== `0x${"0".repeat(40)}`) add(item.token, "token");
    const extra = primary !== "OrderComponents" || !matchesFields(data.types, primary, ORDER_FIELDS) || !matchesFields(data.types, "OfferItem", OFFER_FIELDS) || !matchesFields(data.types, "ConsiderationItem", CONSIDERATION_FIELDS) || !hasValues(message, ORDER_FIELDS) || hasOtherFields(message, ORDER_FIELDS.map(([name]) => name)) ||
      !Array.isArray(message.offer) || message.offer.some((item) => !hasValues(item, OFFER_FIELDS) || hasOtherFields(item, OFFER_FIELDS.map(([name]) => name))) || message.consideration.some((item) => !hasValues(item, CONSIDERATION_FIELDS) || hasOtherFields(item, CONSIDERATION_FIELDS.map(([name]) => name)));
    if (extra) scanAddresses(data, entries);
    return { kind: extra ? "opaque" : "decoded", method, entries: unique(extra ? entries.map((entry) => entry.role === "unknown" ? { ...entry, verified: false } : entry) : entries), cap: extra ? 65 : 100, label: extra ? "Typed-data fields not recognized" : undefined };
  }
  scanAddresses(data, entries);
  return { kind: "opaque", method, entries: unique(entries).map((entry) => ({ ...entry, verified: false })), cap: 65, label: "Typed-data fields not recognized" };
}
function hasOtherFields(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}
function matchesFields(types, name, expected) {
  const fields = types?.[name];
  return Array.isArray(fields) && fields.length === expected.length && fields.every((field, index) => field?.name === expected[index][0] && field?.type === expected[index][1] && Object.keys(field).every(key => key === "name" || key === "type"));
}
function hasValues(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return fields.every(([name, type]) => {
    const item = value[name];
    if (type === "address") return typeof item === "string" && ADDRESS.test(item);
    if (type === "bytes32") return typeof item === "string" && /^0x[0-9a-f]{64}$/i.test(item);
    if (/^uint\d+$/.test(type)) {
      const bits = Number(type.slice(4));
      if (typeof item === "number") return bits <= 48 && Number.isSafeInteger(item) && item >= 0 && BigInt(item) < (1n << BigInt(bits));
      return isUintString(item) && BigInt(item) < (1n << BigInt(bits));
    }
    if (type === "bool") return typeof item === "boolean";
    if (type.endsWith("[]")) return Array.isArray(item);
    return item !== null && typeof item === "object" && !Array.isArray(item);
  });
}

function decodeBatch(batch) {
  if (!batch || !Array.isArray(batch.calls) || batch.calls.length > 64) return malformed("wallet_sendCalls");
  const entries = [];
  const approvals = [];
  let kind = "decoded", cap = 100;
  for (let i = 0; i < batch.calls.length; i++) {
    const call = batch.calls[i];
    const item = decodeTransactions("wallet_sendCalls", call);
    entries.push(...item.entries);
    approvals.push(...(item.approvals || []));
    cap = Math.min(cap, item.cap);
    if (item.kind === "malformed") { kind = "malformed"; cap = Math.min(cap, item.cap); }
    else if (item.kind === "opaque" && kind !== "malformed") { kind = "opaque"; cap = Math.min(cap, item.cap); }
  }
  return { kind, method: "wallet_sendCalls", entries: unique(entries), cap, ...(approvals.length ? { approvals: uniqueApprovals(approvals) } : {}) };
}

function uniqueApprovals(approvals) {
  const seen = new Set();
  return approvals.filter(({ token, spender }) => { const key = `${token}:${spender}`; if (seen.has(key)) return false; seen.add(key); return true; });
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
  return { kind: "opaque", method, entries: unique([...entries, ...hits]), cap: hits.length ? Math.min(baseCap, 65) : baseCap, label: "Unknown calldata" };
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
function isUintString(value) {
  if (typeof value !== "string" || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return false;
  if (value.length > (value.slice(0, 2).toLowerCase() === "0x" ? 66 : 78)) return false;
  return BigInt(value) < (1n << 256n);
}
function unique(entries) { const seen = new Set(); return entries.filter((e) => { const k = `${e.address}:${e.role}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

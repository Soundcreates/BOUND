const WEEK = 7 * 24 * 60 * 60 * 1000;

export function mayRecordObservation({ verdict, incidentStatus, action }) {
  return incidentStatus === "normal" && action === "continue" && (verdict === "green" || verdict === "amber");
}

function privateAddressesFor(request, accounts) {
  const privateAddresses = new Set(accounts.filter((value) => typeof value === "string").map((value) => value.toLowerCase()));
  let tooDeep = false;
  const collectPrivate = (value, key = "", depth = 0) => {
    if (depth > 32) { tooDeep = true; return; }
    if (typeof value === "string" && ["from", "owner", "holder", "offerer"].includes(key) && /^0x[0-9a-fA-F]{40}$/.test(value)) privateAddresses.add(value.toLowerCase());
    else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) collectPrivate(value[i], key, depth + 1);
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => collectPrivate(item, name, depth + 1));
  };
  collectPrivate(request);
  if (typeof request?.method === "string" && request.method.startsWith("eth_signTypedData")) {
    const payload = request.params?.[1] ?? request.params?.[0];
    if (typeof payload === "string") {
      if (payload.length > 262144) return null;
      try { collectPrivate(JSON.parse(payload)); } catch { return null; }
    }
  }
  return tooDeep ? null : privateAddresses;
}

export function observationCandidates({ site, chain, classification, request, accounts = [], now = Date.now(), lastSeen = {} }) {
  const privateAddresses = privateAddressesFor(request, accounts);
  if (!privateAddresses) return [];
  const output = [];
  // Undecodable calldata still has a known called contract (the transaction's `to`).
  // Report only that one; addresses scanned out of opaque calldata have no known role.
  const opaque = classification.kind === "opaque";
  if (classification.kind !== "decoded" && !opaque) return output;
  for (const entry of classification.entries || []) {
    if (opaque && entry.role !== "called") continue;
    const value = entry.address?.toLowerCase();
    if (!value || privateAddresses.has(value) || entry.verified === false) continue;
    const key = `${site}:${chain}:${value}`;
    if (lastSeen[key] !== undefined && now - lastSeen[key] < WEEK) continue;
    output.push({ site, kind: "observation", value, chain, ...(entry.role === "called" || entry.role === "token" ? { observationKind: "called-contract" } : {}) });
  }
  return output;
}

export function warnedEvent({ site, chain }) {
  return { site, kind: "warned", chain };
}

export function warningCandidates({ site, chain, addresses = [], request, accounts = [] }) {
  const privateAddresses = privateAddressesFor(request, accounts);
  const eligible = privateAddresses ? [...new Set(addresses.filter(value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)).map(value => value.toLowerCase()).filter(value => !privateAddresses.has(value)))] : [];
  return eligible.length ? eligible.map(value => ({ site, kind: "warned", value, chain })) : [warnedEvent({ site, chain })];
}

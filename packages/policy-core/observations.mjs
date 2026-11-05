const WEEK = 7 * 24 * 60 * 60 * 1000;

export function observationCandidates({ site, chain, classification, request, accounts = [], now = Date.now(), lastSeen = {} }) {
  const privateAddresses = new Set(accounts.filter((value) => typeof value === "string").map((value) => value.toLowerCase()));
  const collectPrivate = (value, key = "", depth = 0) => {
    if (depth > 16) return;
    if (typeof value === "string" && (key === "from" || key === "owner") && /^0x[0-9a-fA-F]{40}$/.test(value)) privateAddresses.add(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach((item) => collectPrivate(item, key, depth + 1));
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => collectPrivate(item, name, depth + 1));
  };
  collectPrivate(request);
  const output = [];
  if (classification.kind !== "decoded") return output;
  for (const entry of classification.entries || []) {
    const value = entry.address?.toLowerCase();
    if (!value || privateAddresses.has(value) || entry.verified === false) continue;
    const key = `${site}:${chain}:${value}`;
    if (lastSeen[key] && now - lastSeen[key] < WEEK) continue;
    output.push({ site, kind: "observation", value, chain });
  }
  return output;
}

export function warnedEvent({ site, chain }) {
  return { site, kind: "warned", chain };
}

const trustedBy = new Set(["snapshot", "ens_attestation", "shared_contract", "deployer_lineage"]);

export function canonicalSite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.host.toLowerCase();
  } catch { return null; }
}

export function evaluate({ classification, policy, baseline, signerAccounts = [], drift = false, witnessed = new Set(), coverage = "mediated", thresholds = { green: 70, amber: 40, red: 16 } }) {
  if (classification.kind === "unsupported") return { verdict: "grey", score: null, coverage: "unsupported", reasons: ["Unsupported wallet method"] };
  if (classification.kind === "escalated") return { verdict: "escalated", score: 0, coverage, reasons: [classification.label || "Sensitive signature"] };
  if (!baseline) return { verdict: "grey", score: null, coverage, reasons: ["No baseline", ...(classification.label ? [classification.label] : [])] };

  let score = 100;
  const reasons = [];
  const warnedAddresses = new Set();
  for (const item of classification.entries || []) {
    const address = item.address?.toLowerCase();
    if (!address) continue;
    const signerOwned = signerAccounts.some((account) => account.toLowerCase() === address);
    const itemPolicy = policy?.[address];
    const applicable = (source) => trustedBy.has(source) && (!itemPolicy?.rolesBySource || itemPolicy.rolesBySource[source]?.includes(item.role) === true);
    const trusted = itemPolicy?.sources?.some((source) => source !== "deployer_lineage" && applicable(source)) === true;
    const lineage = itemPolicy?.sources?.some((source) => source === "deployer_lineage" && applicable(source)) === true;
    if (item.verified === false) {
      score = Math.min(score, 65);
      reasons.push(`Unverified address ${address}`);
      continue;
    }
    if (trusted || (signerOwned && item.role === "destination")) continue;
    if (lineage) {
      score = Math.min(score, 65);
      reasons.push(`Verified deployer lineage for ${address}`);
      continue;
    }
    if (item.role === "rights") {
      const cap = baseline === "seeded" ? (drift ? 15 : 35) : (witnessed.has(address) ? 65 : drift ? 15 : 35);
      score = Math.min(score, cap);
      if (cap < thresholds.amber) warnedAddresses.add(address);
      reasons.push(`Untrusted rights address ${address}`);
    } else if (item.role === "destination" && !signerAccounts.some((account) => account.toLowerCase() === address)) {
      const cap = baseline === "seeded" || witnessed.has(address) ? 65 : drift ? 15 : 35;
      score = Math.min(score, cap);
      if (cap < thresholds.amber) warnedAddresses.add(address);
      reasons.push(`Untrusted destination ${address}`);
    } else if (["called", "token", "unknown"].includes(item.role)) {
      const cap = baseline === "seeded" || witnessed.has(address) ? 65 : drift ? 15 : 35;
      score = Math.min(score, cap);
      if (cap < thresholds.amber) warnedAddresses.add(address);
      reasons.push(`Untrusted ${item.role} address ${address}`);
    }
  }
  score = Math.min(score, classification.cap ?? 100);
  if (classification.label) reasons.push(classification.label);
  const verdict = score >= thresholds.green ? "green" : score >= thresholds.amber ? "amber" : score >= thresholds.red ? "red" : "escalated";
  if (verdict === "green" && coverage !== "mediated") return { verdict: "grey", score: null, coverage, reasons: [...reasons, "A wallet path may bypass BOUND."] };
  return { verdict, score, coverage, reasons, ...(warnedAddresses.size ? { warnedAddresses: [...warnedAddresses] } : {}) };
}

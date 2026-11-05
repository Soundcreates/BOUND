const trustedBy = new Set(["snapshot", "ens_attestation", "shared_contract", "deployer_lineage"]);

export function canonicalSite(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return url.host.toLowerCase();
  } catch { return null; }
}

export function evaluate({ classification, policy, baseline, signerAccounts = [], drift = false, witnessed = new Set() }) {
  if (classification.kind === "unsupported") return { verdict: "grey", score: null, coverage: "unsupported", reasons: ["Unsupported wallet method"] };
  if (classification.kind === "escalated") return { verdict: "escalated", score: 0, coverage: "mediated", reasons: [classification.label || "Sensitive signature"] };
  if (!baseline) return { verdict: "grey", score: null, coverage: "mediated", reasons: ["No baseline"] };

  let score = 100;
  const reasons = [];
  for (const item of classification.entries || []) {
    const address = item.address?.toLowerCase();
    if (!address) continue;
    const signerOwned = signerAccounts.some((account) => account.toLowerCase() === address);
    const itemPolicy = policy?.[address];
    const trusted = itemPolicy?.sources?.some((source) => trustedBy.has(source)) === true;
    if (trusted || signerOwned) continue;
    if (item.verified === false) {
      score = Math.min(score, 65);
      reasons.push(`Unverified address ${address}`);
      continue;
    }
    if (item.role === "rights") {
      score = Math.min(score, baseline === "seeded" ? (drift ? 15 : 35) : (witnessed.has(address) ? 65 : drift ? 15 : 35));
      reasons.push(`Untrusted rights address ${address}`);
    } else if (item.role === "destination" && !signerAccounts.some((account) => account.toLowerCase() === address)) {
      score = Math.min(score, baseline === "seeded" || witnessed.has(address) ? 65 : drift ? 15 : 35);
      reasons.push(`Untrusted destination ${address}`);
    }
  }
  score = Math.min(score, classification.cap ?? 100);
  if (classification.label) reasons.push(classification.label);
  const verdict = score >= 70 ? "green" : score >= 40 ? "amber" : score >= 16 ? "red" : "escalated";
  return { verdict, score, coverage: "mediated", reasons };
}

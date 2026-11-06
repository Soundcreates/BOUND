const order = ['pass', 'warning', 'huge', 'firewall'];
const verdictTiers = { green: 'pass', amber: 'warning', red: 'huge', escalated: 'firewall', grey: 'warning' };
export function applyFrontendWarning({details, assessment, overrideUsed = false}) {
  let tier = order.includes(details.tier) ? details.tier : (verdictTiers[details.verdict] || 'warning');
  if (assessment?.comparison === 'conflict' && order.indexOf(tier) < 2) tier = 'huge';
  return {...details, frontendIntegrity: assessment, tier, requireTypedConfirmation: Boolean(details.requireTypedConfirmation || details.verdict === 'escalated' || overrideUsed)};
}

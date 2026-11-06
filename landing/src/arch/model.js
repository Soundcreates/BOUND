// Architecture diagram data. Names and paths mirror the repository (packages/*, services/*, integrations/*, apps/extension).
// Roles and failure modes are taken from Docs/BOUND_Final_Architecture.md and the code. No node claims more than the repo does.

export const NODES = {
  site:    { kind: 'untrusted', title: 'The website', sub: 'untrusted page', does: 'The dApp in your tab. Assume an attacker can control every script it serves, including its buttons, copy and any dialog it draws.', trust: 'Nothing. It is the thing being checked.', fails: 'It can show you anything. A page cannot be allowed to vouch for itself.' },
  wallet:  { kind: 'user', title: 'Your wallet', sub: 'EIP-1193 provider', does: 'Holds your keys and shows its own prompt. BOUND never signs or approves for you; it only decides whether the request is passed on.', trust: 'Your own key and wallet. Out of scope for BOUND.', fails: 'Some wallets show an opaque hash for typed data, which is part of why a second opinion helps.' },
  hook:    { kind: 'bound', title: 'In-page hook', sub: 'apps/extension', does: 'Patches request, send and sendAsync at document_start, freezes a copy of every value-moving request and takes a digest of it. The request is held, not blocked.', trust: 'Runs before page scripts, in the extension’s own isolated state.', fails: 'A provider reference the page saved before the hook ran bypasses it. BOUND reports that as “bypass possible” and never shows green.' },
  decoder: { kind: 'bound', title: 'Decoder', sub: 'packages/decoder', does: 'Turns calldata and typed data into addresses with roles: rights, destination, called, token. Reads approvals, permits, setApprovalForAll, Permit2 and EIP-7702 authorizations.', trust: 'Pure code. No network, no state.', fails: 'Unknown ABIs and unrecognised typed data (a Safe transaction, for example) become “opaque” and are capped at 65. It does not guess.' },
  policy:  { kind: 'bound', title: 'Policy core', sub: 'packages/policy-core', does: 'evaluate() starts at 100 and caps the score for every address that is not trusted for its role. The result is green, amber, red, escalated, or grey when there is nothing to compare against.', trust: 'The evidence it is given: snapshot, drift, witnessed addresses.', fails: 'It checks who, not how much. A trusted contract with an unlimited allowance still scores green.' },
  review:  { kind: 'ink', title: 'Review window', sub: 'extension UI', does: 'A window owned by the extension, outside the page. It shows the verdict and reasons. Only a click inside this window can continue or cancel the request.', trust: 'MV3 isolation: the page cannot read or write extension state.', fails: 'Unanswered for ten minutes, a request is handed to your wallet (cancelled for the firewall tier).' },
  ens:     { kind: 'evidence', title: 'ENS root', sub: 'integrations/ens', does: 'A name whose record points at the current curator-signed snapshot. The reference lives in ENS, not in the site’s DNS.', trust: 'The curator’s ENS role (assumption A1).', fails: 'If that role is compromised, hostile addresses could be listed as trusted.' },
  swarm:   { kind: 'evidence', title: 'Swarm', sub: 'integrations/swarm', does: 'Content-addressed storage for the snapshot bytes (and a safe-page fallback). Any gateway can serve them; the extension checks the digest.', trust: 'Nothing about the gateway: the bytes are verified.', fails: 'With no reachable gateway BOUND uses the cached snapshot until it expires, then goes grey.' },
  arkiv:   { kind: 'evidence', title: 'Arkiv', sub: 'integrations/arkiv', does: 'Public, owner-filtered records the watcher writes: infrastructure drift and incident summaries for each site.', trust: 'Only entities written by the watcher’s owner are read.', fails: 'Records can go stale; the extension says when it is using a cached bundle.' },
  anon:    { kind: 'evidence', title: 'Anon-RPC', sub: 'integrations/anon-rpc', does: 'A privacy-minded route for eligible chain reads, so checking an address does not tell an RPC provider which site you are on.', trust: 'Chain data, verified where possible.', fails: 'Live integration is still being verified.' },
  curator: { kind: 'producer', title: 'Curator', sub: 'services/curator', does: 'Compiles and signs per-chain snapshots of the addresses each site normally uses, publishes the bytes and writes the ENS root.', trust: 'Key separation and public snapshot diffs. Multi-party signing is future work.', fails: 'A coverage gap: sites the curator never lists have no snapshot, so they score grey.' },
  watcher: { kind: 'producer', title: 'Watcher', sub: 'services/watcher', does: 'Polls DNS over HTTPS, TLS certificates and hosting for each site and writes drift and incident records. Fast signals for registrar and DNS takeovers.', trust: 'Multiple resolvers; corroboration before a drift counts as strong.', fails: 'Coverage and CDN noise. Uncorroborated drift is treated more gently than corroborated drift.' },
};

export const STEPS = [
  { id: 'ask', title: 'A page asks your wallet to act', text: 'Any website can call your wallet’s provider. On a compromised site the request is whatever the attacker wrote: an approval, a permit, a transaction.', nodes: ['site', 'wallet'], edges: ['direct'], labels: { direct: 'request, unchecked' }, proof: ['badger', 'ledger'] },
  { id: 'hold', title: 'BOUND holds the request', text: 'The extension’s hook sits in front of the provider. It freezes a copy of the request and records a digest, so what is reviewed is exactly what would be sent.', nodes: ['site', 'hook'], edges: ['site-hook'], labels: { 'site-hook': 'request' }, proof: [] },
  { id: 'decode', title: 'It reads what the request would do', text: 'The decoder turns raw calldata and signatures into addresses with roles. Shapes it does not recognise are scored low rather than guessed at.', nodes: ['hook', 'decoder'], edges: ['hook-decoder'], labels: { 'hook-decoder': 'bytes' }, proof: ['bybit'] },
  { id: 'evidence', title: 'It asks sources the page cannot edit', text: 'ENS names the current snapshot, Swarm serves its bytes, Arkiv holds the watcher’s drift records, and Anon-RPC reads the chain privately. None of it passes through the site.', nodes: ['ens', 'swarm', 'arkiv', 'anon', 'curator', 'watcher', 'policy'], edges: ['ens-policy', 'swarm-policy', 'arkiv-policy', 'anon-policy', 'curator-ens', 'curator-swarm', 'watcher-arkiv'], labels: { 'ens-policy': 'evidence' }, proof: ['curve', 'squarespace'] },
  { id: 'score', title: 'It scores the request', text: 'Start at 100. Every address that is not trusted for its role lowers the cap. Missing evidence gives grey, which is never shown as safe.', nodes: ['decoder', 'policy'], edges: ['decoder-policy'], labels: { 'decoder-policy': 'roles' }, proof: ['badger'] },
  { id: 'decide', title: 'You decide, outside the page', text: 'The verdict appears in a window the page cannot draw or click. Continue forwards the same request to your wallet; the firewall tier needs a typed confirmation. A page that kept its own provider can still skip all of this.', nodes: ['policy', 'review', 'wallet'], edges: ['policy-review', 'review-wallet', 'direct'], labels: { 'policy-review': 'verdict', 'review-wallet': 'you decide', direct: 'path BOUND cannot see' }, danger: ['direct'], proof: ['bybit'] },
];

const ZONE_LABELS = { page: 'The page · untrusted', bound: 'BOUND · extension, isolated from the page', evidence: 'Evidence · outside the page' };
const mid = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const top = (b) => [b.x + b.w / 2, b.y];
const bottom = (b) => [b.x + b.w / 2, b.y + b.h];
const left = (b) => [b.x, b.y + b.h / 2];
const right = (b) => [b.x + b.w, b.y + b.h / 2];

function wide() {
  const W = 680, colX = [16, 188, 360, 532], w = 132, h = 58, rowY = [44, 176, 336, 484];
  const at = (c, r) => ({ x: colX[c], y: rowY[r], w, h });
  const b = { site: at(0, 0), wallet: at(3, 0), hook: at(0, 1), decoder: at(1, 1), policy: at(2, 1), review: at(3, 1), ens: at(0, 2), swarm: at(1, 2), arkiv: at(2, 2), anon: at(3, 2), curator: at(0, 3), watcher: at(2, 3) };
  const bus = 300, polBottom = bottom(b.policy);
  const viaBus = (n) => [top(b[n]), [top(b[n])[0], bus], [polBottom[0], bus], polBottom];
  const e = {
    direct: [right(b.site), left(b.wallet)],
    'site-hook': [bottom(b.site), top(b.hook)],
    'hook-decoder': [right(b.hook), left(b.decoder)],
    'decoder-policy': [right(b.decoder), left(b.policy)],
    'policy-review': [right(b.policy), left(b.review)],
    'review-wallet': [top(b.review), bottom(b.wallet)],
    'ens-policy': viaBus('ens'), 'swarm-policy': viaBus('swarm'), 'anon-policy': viaBus('anon'),
    'arkiv-policy': [top(b.arkiv), polBottom],
    'curator-ens': [top(b.curator), bottom(b.ens)],
    'curator-swarm': [right(b.curator), [bottom(b.swarm)[0], right(b.curator)[1]], bottom(b.swarm)],
    'watcher-arkiv': [top(b.watcher), bottom(b.arkiv)],
  };
  // Label anchors sit beside or above the line (x, y of the text's top-left).
  const labelAt = { direct: [292, 52], 'site-hook': [mid(b.site)[0] + 8, 118], 'hook-decoder': [150, 160], 'decoder-policy': [322, 160], 'policy-review': [494, 160], 'review-wallet': [mid(b.review)[0] + 8, 118], 'ens-policy': [250, 284] };
  const zones = [
    { id: 'page', x: 0, y: 8, w: W, h: 104, label: ZONE_LABELS.page },
    { id: 'bound', x: 0, y: 128, w: W, h: 124, label: ZONE_LABELS.bound, accent: true },
    { id: 'evidence', x: 0, y: 312, w: W, h: 258, label: ZONE_LABELS.evidence },
  ];
  return { mode: 'wide', width: W, height: 584, boxes: b, edges: e, labelAt, zones, node: { w, h } };
}

function narrow() {
  const W = 340, x = 30, w = 280, h = 50;
  const flowY = { site: 34, hook: 138, decoder: 216, policy: 294, review: 372, wallet: 470 };
  const b = {};
  Object.entries(flowY).forEach(([id, y]) => { b[id] = { x, y, w, h }; });
  const evidence = ['swarm', 'curator', 'ens', 'watcher', 'arkiv', 'anon'];
  evidence.forEach((id, i) => { b[id] = { x, y: 584 + i * 78, w, h }; });
  const R = 324, L = 14;
  const toPolicy = (n) => [right(b[n]), [R, right(b[n])[1]], [R, right(b.policy)[1]], right(b.policy)];
  const e = {
    direct: [left(b.site), [L, left(b.site)[1]], [L, left(b.wallet)[1]], left(b.wallet)],
    'site-hook': [bottom(b.site), top(b.hook)], 'hook-decoder': [bottom(b.hook), top(b.decoder)], 'decoder-policy': [bottom(b.decoder), top(b.policy)],
    'policy-review': [bottom(b.policy), top(b.review)], 'review-wallet': [bottom(b.review), top(b.wallet)],
    'ens-policy': toPolicy('ens'), 'swarm-policy': toPolicy('swarm'), 'arkiv-policy': toPolicy('arkiv'), 'anon-policy': toPolicy('anon'),
    'curator-ens': [bottom(b.curator), top(b.ens)], 'curator-swarm': [top(b.curator), bottom(b.swarm)], 'watcher-arkiv': [bottom(b.watcher), top(b.arkiv)],
  };
  const zones = [
    { id: 'page', x: 4, y: 6, w: 332, h: 90, label: ZONE_LABELS.page },
    { id: 'bound', x: 4, y: 108, w: 332, h: 328, label: ZONE_LABELS.bound, accent: true },
    { id: 'evidence', x: 4, y: 548, w: 332, h: 490, label: ZONE_LABELS.evidence },
  ];
  return { mode: 'narrow', width: W, height: 1052, boxes: b, edges: e, labelAt: {}, zones, node: { w, h } };
}

export const layoutFor = (mode) => (mode === 'narrow' ? narrow() : wide());
export const EDGE_IDS = Object.keys(wide().edges);

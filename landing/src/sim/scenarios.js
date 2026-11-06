// Scenario catalogue for the toy-OS simulation.
// `incident` ids match src/proof/incidents.js. Nothing here claims prevention: each scenario is
// replayed through BOUND's real decoder and scoring code (see engine.js) and shows what it returns.
import { A, approve, setApprovalForAll, transfer, truncatedApprove, unknownSwap, ethSign, personalSign, unsupported, delegation, permit, safeTx } from './requests.js';

// What BOUND's curated snapshot says swap.example normally uses. Everything else is unlisted.
export const SITE_POLICY = Object.fromEntries([A.token, A.router, A.vault, A.nft].map((a) => [a, { sources: ['snapshot'] }]));

const SITE = 'vault.example';
const lose = (what) => ({ kind: 'loss', text: what });
const fine = (what) => ({ kind: 'fine', text: what });

export const scenarios = [
  // ── Documented incidents, replayed ────────────────────────────────────────
  {
    id: 'badger', group: 'incident', incident: 'badger', title: 'Injected script asks for an unlimited approval',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit. Same flow as always.', button: 'Approve & deposit' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'The page, the domain and the contracts are all normal. Only one script was changed, so there is no DNS or certificate signal. BOUND can only compare who is being given spending rights.',
  },
  {
    id: 'curve', group: 'incident', incident: 'curve', title: 'DNS hijack serves a cloned frontend',
    page: { site: SITE, headline: 'Swap TOKEN', body: 'Connect and approve to swap.', button: 'Approve & swap' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded', drift: true },
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'Same request as the injected-script case, but the watcher has seen a nameserver change for the domain (corroborated drift). That is outside-the-page evidence the cloned site cannot edit.',
  },
  {
    id: 'ledger', group: 'incident', incident: 'ledger', title: 'Poisoned library asks for a permit signature',
    page: { site: SITE, headline: 'Connect your wallet', body: 'One signature to verify you own this wallet.', button: 'Verify wallet' },
    request: permit(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    consequence: lose('Toy wallet: an off-chain signature that lets the unknown address pull your TOKEN balance later.'),
    note: 'A permit costs no gas and moves nothing yet, so it feels harmless. The decoder reads the spender out of the typed data and scores it like an approval.',
  },
  {
    id: 'squarespace', group: 'incident', incident: 'squarespace', title: 'Registrar takeover on a site nobody curated',
    page: { site: SITE, headline: 'Claim your rewards', body: 'Sign the approval to claim.', button: 'Claim' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'uncurated', drift: true },
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'The curator never listed this site, so there is no snapshot to compare against. BOUND leans on what the watcher saw change and on whether the site had used this address before.',
  },
  {
    id: 'bybit', group: 'incident', incident: 'bybit', title: 'Multisig signer shown a routine transfer',
    page: { site: 'safe.example', headline: 'Transfer 0 ETH to cold wallet', body: 'Routine wallet maintenance. Review and sign.', button: 'Sign transaction' },
    request: safeTx({ to: A.attackerImpl, operation: 1 }),
    eval: { baseline: 'seeded' },
    consequence: lose('Toy wallet: the signed transaction runs the unknown contract’s code as your multisig.'),
    note: 'The honest result here is partial. BOUND does not decode Safe transactions or their delegatecall flag. It sees typed data it cannot recognise and warns at amber. It does not know what the signature does.',
    limit: true,
  },

  // ── Edge cases ────────────────────────────────────────────────────────────
  {
    id: 'eth-sign', group: 'edge', title: 'Blind signature (eth_sign)',
    page: { site: SITE, headline: 'Verify you are human', body: 'Sign this challenge.', button: 'Verify' },
    request: ethSign(),
    eval: { baseline: 'seeded' },
    consequence: lose('Toy wallet: a blind signature can be turned into any transaction. You cannot tell which.'),
    note: 'Nothing readable is signed, so there is nothing to compare. BOUND treats it as the strongest warning.',
  },
  {
    id: 'delegation', group: 'edge', title: 'EIP-7702 delegation valid on every chain',
    page: { site: SITE, headline: 'Upgrade your account', body: 'Enable batched transactions.', button: 'Enable' },
    request: delegation(A.attacker, '0x0'),
    eval: { baseline: 'seeded' },
    consequence: lose('Toy wallet: the unknown contract’s code now controls your account on every chain.'),
    note: 'A chain id of zero makes the authorization replayable on any network. The decoder caps the score at 0.',
  },
  {
    id: 'malformed', group: 'edge', title: 'Truncated, malformed calldata',
    page: { site: SITE, headline: 'Approve TOKEN', body: 'Allow the vault to use TOKEN.', button: 'Approve' },
    request: truncatedApprove(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    consequence: fine('Toy wallet: malformed calldata would revert. Nothing is spent.'),
    note: 'Requests that do not match their own ABI are scored low instead of being guessed at.',
  },
  {
    id: 'hidden-address', group: 'edge', title: 'Unknown calldata hiding an address',
    page: { site: SITE, headline: 'Swap TOKEN', body: 'Best route found.', button: 'Swap' },
    request: unknownSwap(A.router, A.attacker),
    eval: { baseline: 'seeded', signerAccounts: [A.you] },
    consequence: lose('Toy wallet: the swap output is sent to the unknown address, not to you.'),
    note: 'The router is trusted but the call is not an ABI BOUND knows. It scans the bytes for address-shaped words and refuses to score the call green.',
  },
  {
    id: 'personal-sign', group: 'edge', title: 'Plain-text message signature',
    page: { site: SITE, headline: 'Sign in', body: 'Sign the message to log in.', button: 'Sign in' },
    request: personalSign(),
    eval: { baseline: 'seeded' },
    consequence: fine('Toy wallet: a login message. Nothing moves.'),
    note: 'Text is not decoded into counterparties, so the score is capped at 65 even when the message is harmless. A cautious amber, not a verdict of harm.',
  },
  {
    id: 'unsupported', group: 'edge', title: 'Method BOUND does not decode',
    page: { site: SITE, headline: 'Add a network', body: 'Switch to the recommended chain.', button: 'Add network' },
    request: unsupported(),
    eval: { baseline: 'seeded' },
    consequence: fine('Toy wallet: the wallet asks you about the new network.'),
    note: 'Unsupported requests are forwarded with no opinion and are never shown as green.',
  },

  // ── Limits: where BOUND is not enough ────────────────────────────────────
  {
    id: 'trusted-unlimited', group: 'limit', title: 'Trusted contract, unlimited allowance',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit.', button: 'Approve & deposit' },
    request: approve(A.token, A.vault),
    eval: { baseline: 'seeded' },
    consequence: fine('Toy wallet: the vault can move your TOKEN balance. The vault is the site’s own, trusted contract.'),
    note: 'Green means the counterparty is on the site’s trusted list. It does not mean the amount is wise, or that the trusted contract is bug-free. BOUND checks who, not how much.',
    limit: true,
  },
  {
    id: 'bypass', group: 'limit', title: 'Page uses a provider BOUND never patched',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit.', button: 'Approve & deposit' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    mediated: false,
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'EIP-1193 providers are ordinary JavaScript objects. A page that saved a reference before BOUND ran can call it directly. BOUND cannot see that request, and says so.',
    limit: true,
  },

  // ── Request lifecycle ────────────────────────────────────────────────────
  {
    id: 'deadline', group: 'lifecycle', title: 'You never answer the window',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit.', button: 'Approve & deposit' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    lifecycle: 'deadline',
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'After the deadline an unanswered request is handed to your wallet, which still asks you. Requests that need a typed confirmation are cancelled instead.',
    limit: true,
  },
  {
    id: 'state-change', group: 'lifecycle', title: 'Wallet account changes mid-review',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit.', button: 'Approve & deposit' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    lifecycle: 'stateChange',
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'The review was about one account on one chain. If either changes, the old decision no longer applies, so the request is cancelled and the page must ask again.',
  },
  {
    id: 'spoof', group: 'lifecycle', title: 'Page draws a fake “security check”',
    page: { site: SITE, headline: 'Deposit into the vault', body: 'Approve once, then deposit.', button: 'Approve & deposit' },
    request: approve(A.token, A.attacker),
    eval: { baseline: 'seeded' },
    lifecycle: 'spoof',
    consequence: lose('Toy wallet: the unknown address can now move your whole TOKEN balance.'),
    note: 'A compromised page can draw anything, including a lookalike of a security dialog. Only the extension’s own window can resolve a review, so a click on a drawn dialog does nothing.',
  },
];

export const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));
export const GROUPS = [
  { id: 'incident', label: 'Documented incidents', hint: 'Replays of real frontend compromises' },
  { id: 'edge', label: 'Edge cases', hint: 'Unusual requests the decoder must handle' },
  { id: 'limit', label: 'Known limits', hint: 'Where BOUND is not enough' },
  { id: 'lifecycle', label: 'Request lifecycle', hint: 'What happens to a pending review' },
];

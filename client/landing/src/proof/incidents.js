// Documented frontend / supply-chain compromises that happened before BOUND existed.
// Facts here come from the linked reporting. Where sources disagree, the range or the disagreement is stated.
// `lens` is BOUND's analysis of what it would have compared. It is not a claim that it would have prevented the loss.
// `scenario` links to the replay in the toy-OS simulation (src/sim/scenarios.js).

export const incidents = [
  {
    id: 'badger',
    name: 'BadgerDAO',
    when: 'December 2021',
    year: 2021,
    vector: 'Injected script',
    loss: '≈ $115–120M',
    lossNote: 'Estimates differ by source.',
    headline: 'One injected script turned the deposit flow into an approval drainer.',
    what: 'Attackers got into the site’s Cloudflare account (a compromised API key is the likely route) and injected a script into the front end. It prompted users’ wallets to approve token spending to an attacker-controlled address. The smart contracts were not breached; funds were taken directly from users of the website.',
    seen: 'A normal-looking page and a wallet approval prompt.',
    lens: 'The approval gives spending rights to an address this site had never used. BOUND compares that rights-role address with the site’s own trusted list outside the page and scores it low.',
    limit: 'It warns; the user can still continue. It needs a curated baseline for the site.',
    scenario: 'badger',
    sources: [
      { label: 'Halborn: explained', url: 'https://halborn.com/blog/post/explained-the-badgerdao-hack-december-2021' },
      { label: 'Blockworks', url: 'https://www.blockworks.com/news/hackers-drain-115-million-from-bitcoin-defi-focused-badgerdao' },
    ],
  },
  {
    id: 'curve',
    name: 'Curve Finance',
    when: 'August 2022',
    year: 2022,
    vector: 'DNS hijack',
    loss: '≈ $570–612K',
    lossNote: 'Reports vary; later recovered in part.',
    headline: 'The domain was right. The server behind it was not.',
    what: 'Attackers compromised the domain registrar’s nameserver and pointed the site at a cloned front end that asked users to approve a malicious contract. Curve’s own contracts were untouched, and the team moved users to another domain while the DNS fix propagated.',
    seen: 'The correct address in the browser bar and an identical-looking site.',
    lens: 'A nameserver change is a signal the page cannot forge. BOUND’s watcher records DNS and certificate drift, and drift lowers the score for any untrusted address on that site.',
    limit: 'Drift detection depends on the watcher’s coverage and is still being verified end to end.',
    scenario: 'curve',
    sources: [
      { label: 'rekt.news', url: 'https://rekt.news/curve-finance-rekt' },
      { label: 'Kitco', url: 'https://www.kitco.com/news/article/2022-08-10/hackers-steal-611500-worth-users-funds-hijacking-curve-finance-homepage' },
      { label: 'Web3 is Going Great', url: 'https://www.web3isgoinggreat.com/embed/curve-finance-frontend-compromised' },
    ],
  },
  {
    id: 'ledger',
    name: 'Ledger Connect Kit',
    when: '14 December 2023',
    year: 2023,
    vector: 'Poisoned library',
    loss: '≈ $600–680K',
    lossNote: 'Reports vary. The malicious code was live for about five hours.',
    headline: 'A trusted wallet library shipped a drainer to every site that loaded it.',
    what: 'Malicious versions 1.1.5–1.1.7 of Ledger’s Connect Kit were published after an npm account was compromised, and dApps that loaded the kit at runtime served wallet-drainer prompts to their users. Ledger hardware and Ledger Live were not affected, and the bad versions were replaced by 1.1.8. Sources differ on the exact access route.',
    seen: 'A legitimate dApp, from a legitimate team, with a familiar connect dialog.',
    lens: 'Every site that loaded the library looked fine. The drainer still had to ask the wallet for an approval or signature, which is the request BOUND reads.',
    limit: 'BOUND does not inspect the library. It only sees what the library asks the wallet to do.',
    scenario: 'ledger',
    sources: [
      { label: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/news/security/ledger-dapp-supply-chain-attack-steals-600k-from-crypto-wallets/' },
      { label: 'The Hacker News', url: 'https://thehackernews.com/2023/12/crypto-hardware-wallet-ledgers-supply.html' },
      { label: 'SlowMist', url: 'https://slowmist.medium.com/supply-chain-attack-on-ledger-connect-kit-analyzing-the-impact-and-preventive-measures-1005e39422fd' },
    ],
  },
  {
    id: 'squarespace',
    name: 'Squarespace domain hijacks',
    when: '9–12 July 2024',
    year: 2024,
    vector: 'Registrar takeover',
    loss: 'Not consolidated',
    lossNote: 'Reporting names affected projects, not one reliable total.',
    headline: 'Registrar accounts were taken over across many crypto domains at once.',
    what: 'DNS records for crypto and DeFi domains registered with Squarespace, including Celer Network, Compound Labs, Pendle Labs and Unstoppable Domains, were changed to send visitors to wallet-drainer pages. Reporting links it to weak defaults after the Google Domains migration; the exact cause was not confirmed in the sources reviewed.',
    seen: 'The project’s real domain, now serving someone else’s page.',
    lens: 'For a site the curator never listed there is no snapshot, but the watcher can still see the DNS change, and an address the site never used is still untrusted.',
    limit: 'With no baseline BOUND can only say “no score”, which is not a safe signal.',
    scenario: 'squarespace',
    sources: [
      { label: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/news/security/dns-hijacks-target-crypto-platforms-registered-with-squarespace/' },
      { label: 'rekt.news', url: 'https://rekt.news/thanks-squarespace/' },
      { label: 'The Block: Celer', url: 'https://www.theblock.co/news/markets/2024-07-11-celer-network-thwarts-attempted-dns-attack-that-allegedly-puts-128-web3-projects-at-risk-304956' },
    ],
  },
  {
    id: 'bybit',
    name: 'Bybit / Safe{Wallet}',
    when: '21 February 2025',
    year: 2025,
    vector: 'Tampered Safe{Wallet} JavaScript',
    loss: '≈ $1.4–1.5B',
    lossNote: 'About 401,000 ETH. The FBI attributed it to North Korea’s TraderTraitor group.',
    headline: 'Signers saw a routine transfer. They signed away the wallet.',
    what: 'Investigators found malicious JavaScript served from Safe{Wallet}’s cloud infrastructure that only changed behaviour when Bybit’s cold-wallet transaction was about to be signed. The interface showed a routine transfer while the signed transaction handed control of the wallet contract to the attacker. Forensics found the original files were restored about two minutes after the theft. Bybit’s own systems were not breached.',
    seen: 'A routine transfer on the real Safe{Wallet} site.',
    lens: 'The review window lives in the extension, outside the page, so a tampered page cannot redraw it. But BOUND does not decode Safe transactions: it would show an amber “typed-data fields not recognized”, not the delegatecall.',
    limit: 'Partial at best today. Decoding Safe transactions and delegatecall is not implemented.',
    scenario: 'bybit',
    sources: [
      { label: 'NCC Group / Fox-IT', url: 'https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/' },
      { label: 'SlowMist', url: 'https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2' },
    ],
  },
];

// Reported to be fair about scope: an incident BOUND would not have addressed.
export const outOfScope = {
  id: 'solana-web3js',
  name: '@solana/web3.js backdoor',
  when: 'December 2024',
  loss: 'Reported ≈ $130K so far',
  text: 'A hijacked publish account added code that sent private keys to an attacker’s server. It hit software that holds keys directly, such as bots and backends. No wallet prompt is ever shown, so there is nothing for a wallet-request check to review.',
  sources: [
    { label: 'The Hacker News', url: 'https://thehackernews.com/2024/12/researchers-uncover-backdoor-in-solanas.html' },
    { label: 'The Register', url: 'https://www.theregister.com/2024/12/05/solana_javascript_sdk_compromised/' },
  ],
};

export const byIncident = Object.fromEntries(incidents.map((i) => [i.id, i]));

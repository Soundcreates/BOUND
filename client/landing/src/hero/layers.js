// Security & privacy layers, top (what the user sees) → bottom (foundation).
// Copy mirrors the repo: client/extension, shared/decoder + policy-core,
// shared/integrations/ens, shared/integrations/arkiv, shared/integrations/anon-rpc.
export const layers = [
  {
    id: 'mediation',
    title: 'Request mediation',
    text: 'Wallet requests pause in extension-controlled UI before you sign.',
    tag: 'EXTENSION · EIP-1193',
  },
  {
    id: 'policy',
    title: 'Decode & policy',
    text: 'Calldata is decoded and checked against a curator policy.',
    tag: 'DECODER · POLICY',
  },
  {
    id: 'ens',
    title: 'Trusted reference',
    text: 'An ENS name points to the reference a site should match.',
    tag: 'ENS · IDENTITY',
  },
  {
    id: 'arkiv',
    title: 'Verifiable snapshots',
    text: 'Chain-specific snapshots stored as public, checkable records.',
    tag: 'ARKIV · RECORDS',
  },
  {
    id: 'anon-rpc',
    title: 'Private lookups',
    text: 'Eligible chain reads are routed with privacy in mind.',
    tag: 'ANON-RPC · PRIVACY',
  },
];

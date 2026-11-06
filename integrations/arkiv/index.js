import { validateBundle, validateRecord } from '../../packages/contracts/index.js';

// Client query returns Arkiv metadata envelopes, not self-asserted payload owners.
export async function queryBundle({ client, owner, currentBlock, now }) {
  const records = await client.query({ owner });
  if (!Array.isArray(records)) throw new Error('invalid query response');
  const eligible = records.filter(e => e && e.owner === owner && Number.isSafeInteger(e.expiresAt) && e.expiresAt > currentBlock && validateRecord(e.record) && ['baseline', 'drift', 'incident', 'status', 'frontend'].includes(e.record.kind));
  const bundle = { schemaVersion: 1, generatedAt: new Date(now()).toISOString(), records: eligible };
  if (!validateBundle(bundle, owner, currentBlock)) throw new Error('invalid Arkiv metadata');
  return bundle;
}

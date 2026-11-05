import {validateRecord} from '../../packages/contracts/index.js';

const address = /^0x[0-9a-f]{40}$/;
const entityKey = /^0x[0-9a-f]{64}$/;
const operationId = /^[0-9a-f]{64}(?:-(?:pending|published))?$/;
const MAX_LIFETIME_BLOCKS = 7_884_000;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

// SDK/signing boundary: adapters must index the operation ID and public-read it
// back with actual Arkiv owner, key, and expiry metadata before acknowledging.
export function createArkivWriter({owner, schemaTag, findByOperationId, submitOnce, currentBlock, minLifetimeBlocks = 43_200}) {
  if (typeof owner !== 'string' || !address.test(owner) || typeof schemaTag !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag) ||
      typeof findByOperationId !== 'function' || typeof submitOnce !== 'function' || typeof currentBlock !== 'function' ||
      !Number.isSafeInteger(minLifetimeBlocks) || minLifetimeBlocks < 1 || minLifetimeBlocks > MAX_LIFETIME_BLOCKS) throw new Error('invalid Arkiv writer configuration');

  async function lookup(id) {
    const block = await currentBlock();
    if (!Number.isSafeInteger(block) || block < 0) throw new Error('invalid Arkiv block');
    const entity = await findByOperationId({owner, schemaTag, operationId: id});
    if (entity === null) return {entity: null, block};
    if (!entity || entity.owner !== owner || !entityKey.test(entity.key) || !Number.isSafeInteger(entity.expiresAt) ||
        entity.expiresAt <= block || entity.expiresAt > block + MAX_LIFETIME_BLOCKS || !validateRecord(entity.record)) throw new Error('invalid Arkiv write read-back');
    return {entity, block};
  }

  let queue = Promise.resolve();
  async function writeOnce(record, id) {
    if (!validateRecord(record) || typeof id !== 'string' || !operationId.test(id)) throw new Error('invalid Arkiv write input');
    const prior = await lookup(id);
    if (prior.entity) {
      if (!same(prior.entity.record, record)) throw new Error('Arkiv operation ID conflict');
      return prior.entity;
    }
    // submitOnce must persist signed bytes before submission and reuse them after restart.
    await submitOnce({owner, schemaTag, operationId: id, record: structuredClone(record), minLifetimeBlocks});
    const committed = await lookup(id);
    if (!committed.entity || !same(committed.entity.record, record)) throw new Error('Arkiv write not confirmed');
    return committed.entity;
  }

  function write(record,id) {
    const captured=structuredClone(record);
    const result=queue.then(()=>writeOnce(captured,id));
    queue=result.catch(()=>{});
    return result;
  }
  return {write};
}

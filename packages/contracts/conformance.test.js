import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { validateRoot, validateRootSnapshotPair, validateObservation, validateSnapshot, validateRecord, validateBundle, validateDecision, validateObservationBatch, validateIntakeResponse, validateAdapterResult, parseUniqueJSON } from './index.js';
import { keccak256 } from './keccak-reference.js';
const fixture = async name => JSON.parse(await readFile(new URL(`../../fixtures/contracts/${name}.json`, import.meta.url)));
test('root and intake vectors', async () => {
  const vectors = await fixture('vectors');
  for (const [key, validate] of [['roots', validateRoot], ['observations', validateObservation]]) for (const {value, valid} of vectors[key]) assert.equal(validate(value), valid);
});
test('snapshot rejects duplicate values and missing provenance', async () => {
  const snapshot = await fixture('snapshot');
  assert.equal(validateSnapshot(snapshot), true);
  const chain = snapshot.sites['xn--bcher-kva.example:8443']['1'];
  chain.trustedCounterparties.push(chain.trustedCounterparties[0]);
  assert.equal(validateSnapshot(snapshot), false);
  chain.trustedCounterparties.pop(); chain.sourceEvidence = [];
  assert.equal(validateSnapshot(snapshot), false);
});
test('root and snapshot agree on network and epoch', async () => {
  const snapshot = await fixture('snapshot');
  const root = (await fixture('vectors')).roots[0].value;
  assert.equal(validateRootSnapshotPair(root, snapshot), true);
  assert.equal(validateRootSnapshotPair({...root, epoch: 2}, snapshot), false);
  assert.equal(validateRootSnapshotPair({...root, network: 'other'}, snapshot), false);
});
test('records and bundle enforce ownership and expiry', async () => {
  const records = await fixture('records');
  for (const record of records) { assert.equal(validateRecord(record), true); assert.equal(validateRecord({...record, wallet:'private'}), false); }
  const owner = '0x'+'a'.repeat(40);
  let keyNumber = 0;
  const wrap = record => ({key:'0x'+(++keyNumber).toString(16).padStart(64, '0'), owner, expiresAt:101, record});
  const bundle = {schemaVersion:1, generatedAt:'2026-01-01T00:00:00.000Z', records:records.filter(r => r.kind !== 'observation').map(wrap)};
  assert.equal(validateBundle(bundle, owner, 100), true);
  assert.equal(validateBundle(bundle, owner), false);
  assert.equal(validateBundle(bundle, '0x'+'b'.repeat(40), 100), false);
  assert.equal(validateBundle(bundle, owner, 101), false);
  const foreign = structuredClone(bundle);
  foreign.records[0].owner = '0x'+'b'.repeat(40);
  assert.equal(validateBundle(foreign, owner, 100), false);
  const mixed = structuredClone(bundle);
  mixed.records[1].owner = '0x'+'b'.repeat(40);
  assert.equal(validateBundle(mixed, owner, 100), false);
  const expired = structuredClone(bundle);
  expired.records[0].expiresAt = 100;
  assert.equal(validateBundle(expired, owner, 100), false);
  const noMetadata = structuredClone(bundle);
  delete noMetadata.records[0].owner;
  assert.equal(validateBundle(noMetadata, owner, 100), false);
  const duplicateKey = structuredClone(bundle);
  duplicateKey.records[1].key = duplicateKey.records[0].key;
  assert.equal(validateBundle(duplicateKey, owner, 100), false);
  const polluted = structuredClone(bundle);
  polluted.records[0].record.owner = owner;
  assert.equal(validateBundle(polluted, owner, 100), false);
});
test('raw JSON rejects duplicate and escaped duplicate keys', () => {
  assert.throws(() => parseUniqueJSON('{"a":1,"\\u0061":2}'), /duplicate/);
  assert.throws(() => parseUniqueJSON('{"a":{"x":1,"x":2}}'), /duplicate/);
  assert.deepEqual(parseUniqueJSON('{"a":1,"b":{"a":2}}'), {a:1,b:{a:2}});
});
test('decision and adapter vectors', async () => {
  for (const [name, validate] of [['decisions',validateDecision], ['adapter-results',validateAdapterResult]]) for (const {value,valid} of await fixture(name)) assert.equal(validate(value),valid);
});
test('intake batch excludes extra privacy-sensitive fields', () => {
  const event = {site:'example.org',kind:'warned',value:'0x'+'1'.repeat(40),chainId:1,reporterKey:'key'};
  assert.equal(validateObservationBatch({schemaVersion:1,events:[event]}),true);
  assert.equal(validateObservationBatch({schemaVersion:1,events:[{...event,choice:'continue'}]}),false);
  assert.equal(validateIntakeResponse({schemaVersion:1,result:'accepted'}),true);
  assert.equal(validateIntakeResponse({schemaVersion:1,result:'accepted',requestDigest:'private'}),false);
});
test('Keccak-256 digest vector matches independently checked canonical bytes', async () => {
  assert.equal(keccak256(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  const canonical = await readFile(new URL('../../fixtures/contracts/snapshot-canonical.json', import.meta.url));
  const expected = await fixture('snapshot-digest');
  assert.equal(keccak256(canonical), expected.digest);
});
test('record hash, address, and Swarm reference fields reject coercible types and secret references', async () => {
  const records = await fixture('records');
  for (const value of [[], {}, 7, null]) {
    assert.equal(validateRecord({...records[0], value}), false);
    assert.equal(validateRecord({...records[3], counterparty: value}), false);
    assert.equal(validateRecord({...records[3], reportDigest: value}), false);
    const bundle = {schemaVersion:1, generatedAt:'2026-01-01T00:00:00.000Z', records:[{key:'0x'+'1'.repeat(64), owner:'0x'+'a'.repeat(40), expiresAt:101, record:records[1]}]};
    bundle.records[0].owner = value;
    assert.equal(validateBundle(bundle, '0x'+'a'.repeat(40), 100), false);
    bundle.records[0].owner = '0x'+'a'.repeat(40);
    bundle.records[0].key = value;
    assert.equal(validateBundle(bundle, '0x'+'a'.repeat(40), 100), false);
  }
  for (const swarmReference of ['a'.repeat(128), 'https://swarm.example/ref?key=secret']) {
    assert.equal(validateRecord({...records[3], swarmReference}), false);
  }
});
test('snapshot compares mixed timestamp representations by instant', async () => {
  const snapshot = await fixture('snapshot');
  snapshot.generatedAt = '2026-01-01T00:00:00.500Z';
  snapshot.expiresAt = '2026-01-01T00:00:00Z';
  assert.equal(validateSnapshot(snapshot), false);
  snapshot.generatedAt = '2026-01-01T00:00:00Z';
  snapshot.expiresAt = '2026-01-01T00:00:00.500Z';
  assert.equal(validateSnapshot(snapshot), true);
  snapshot.expiresAt = '2026-01-01T00:00:00.000Z';
  assert.equal(validateSnapshot(snapshot), false);
});
test('canonical fixture matches the snapshot for its restricted values', async () => {
  const snapshot = await fixture('snapshot');
  const canonical = await readFile(new URL('../../fixtures/contracts/snapshot-canonical.json', import.meta.url), 'utf8');
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  assert.equal(canonical, JSON.stringify(sort(snapshot)));
});
test('bypass-possible coverage cannot produce a green decision', () => {
  assert.equal(validateDecision({coverage:'mediated',evaluated:true,bypassPossible:true,verdict:'green',score:100}), false);
  assert.equal(validateDecision({coverage:'mediated',evaluated:true,bypassPossible:true,verdict:'amber',score:65}), true);
});
test('incident status remains valid while the public report is unavailable', async () => {
  const {validateRecord} = await import('./index.js');
  const status=(await fixture('records')).find(record=>record.kind==='status');
  assert.equal(validateRecord({...status,incidentReference:null}),true);
  assert.equal(validateRecord({...status,state:'normal',incidentReference:status.incidentReference}),false);
});

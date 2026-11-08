import test from 'node:test';
import assert from 'node:assert/strict';
import {isFrontendPath, isFrontendHash, validateFrontendRecord} from './frontend.js';

const hash = 'sha256-' + Buffer.alloc(32).toString('base64');
test('frontend path and hash are canonical and exclude private paths', () => {
  assert.equal(isFrontendPath('/app.js'), true);
  for (const path of ['/a/../b', '/a%2fb', '/a?x', '/%zz', '/0x' + 'a'.repeat(40), '/' + 'x'.repeat(65)]) assert.equal(isFrontendPath(path), false, path);
  assert.equal(isFrontendHash(hash), true);
  assert.equal(isFrontendHash(hash.slice(0, -2) + 'B='), false);
});
test('frontend record enforces maturity and receipt window', () => {
  const record = {schemaVersion:1, kind:'frontend', site:'app.example.com', chainId:1, scripts:[{path:'/app.js', hash, reporters:3, firstSeen:'2026-01-01T00:00:00Z', lastSeen:'2026-01-01T01:00:00Z', established:true}], updatedAt:'2026-01-01T01:00:00Z'};
  assert.equal(validateFrontendRecord(record), true);
  assert.equal(validateFrontendRecord({...record, scripts:[{...record.scripts[0], established:false}]}), false);
  assert.equal(validateFrontendRecord({...record, updatedAt:'2026-01-03T01:00:00Z'}), false);
});

test('frontend intake and bundle enforce exact wire shapes', async () => {
  const {validateObservation, validateObservationBatch, validateRecord, validateBundle} = await import('./index.js');
  const event = {site:'example.org',kind:'frontend',chainId:1,reporterKey:'key',path:'/app.js',hash:'sha256-' + 'A'.repeat(43) + '='};
  assert.equal(validateObservation(event), true);
  assert.equal(validateObservationBatch({schemaVersion:1,events:[event]}), true);
  for (const extra of [{value:'secret'}, {url:'https://example.org'}, {timestamp:1}, {text:'inline'}]) assert.equal(validateObservation({...event,...extra}), false);
  assert.equal(validateObservation({...event,reporterKey:'é'}), false);
  const record = {schemaVersion:1,kind:'frontend',site:'example.org',chainId:1,scripts:[],updatedAt:'2026-01-01T00:00:00Z'};
  assert.equal(validateRecord(record), true);
  const owner='0x'+'1'.repeat(40);
  assert.equal(validateBundle({schemaVersion:1,generatedAt:'2026-01-01T00:00:00Z',records:[{key:'0x'+'2'.repeat(64),owner,expiresAt:2,record}]},owner,1), true);
});


test('frontend observation limits site length at 253 characters', async () => {
 const {validateObservation}=await import('./index.js');
 const site='a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61);
 const event={site,kind:'frontend',chainId:1,reporterKey:'key',path:'/app.js',hash};
 assert.equal(site.length,253);assert.equal(validateObservation(event),true);
 assert.equal(validateObservation({...event,site:site+'e'}),false);
});

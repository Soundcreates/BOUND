import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyDrift } from './drift.js';
const base = {nameservers:['ns1.example'],addresses:['192.0.2.1'],asns:{'192.0.2.1':'64500'},certificate:{fingerprint:'old',issuer:'Example CA',names:['example.org']}};
test('NS change is corroborated', () => {
  const result=classifyDrift(base,{...base,nameservers:['ns2.example']});
  assert.equal(result.corroborated,true); assert.deepEqual(result.changes.map(c=>c.kind),['ns']);
});
test('renewal with same issuer and names is not corroborated', () => {
  const result=classifyDrift(base,{...base,certificate:{...base.certificate,fingerprint:'new'}});
  assert.equal(result.corroborated,false); assert.deepEqual(result.changes.map(c=>c.kind),['cert']);
});
test('certificate issuer or names change is corroborated', () => {
  assert.equal(classifyDrift(base,{...base,certificate:{...base.certificate,issuer:'Other CA',fingerprint:'new'}}).corroborated,true);
  assert.equal(classifyDrift(base,{...base,certificate:{...base.certificate,names:['other.example'],fingerprint:'new'}}).corroborated,true);
});
test('address change requires known and different ASNs', () => {
  assert.equal(classifyDrift(base,{...base,addresses:['192.0.2.2'],asns:{'192.0.2.2':'64500'}}).corroborated,false);
  assert.equal(classifyDrift(base,{...base,addresses:['192.0.2.2'],asns:{}}).corroborated,false);
  assert.equal(classifyDrift(base,{...base,addresses:['192.0.2.2'],asns:{'192.0.2.2':'64501'}}).corroborated,true);
});
test('incomplete polling results cannot turn missing data into drift', () => {
  for (const bad of [{...base,nameservers:[]},{...base,addresses:[]},{...base,certificate:null},{...base,certificate:{...base.certificate,issuer:''}},{...base,asns:null}]) {
    assert.throws(()=>classifyDrift(base,bad), /incomplete/);
  }
});

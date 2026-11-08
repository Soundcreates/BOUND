import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createCymruLookup} from './asn.js';
test('Cymru DNS resolves IPv4 to normalized origin ASNs', async()=>{
 let question;
 const lookup=createCymruLookup({resolveTxt:async name=>{question=name;return [['64501 | 192.0.2.0/24 | ZZ | test | 2020-01-01']];}});
 assert.equal(await lookup('192.0.2.1'),'64501');assert.equal(question,'1.2.0.192.origin.asn.cymru.com');
});
test('unknown, malformed, or invalid data cannot corroborate a change',async()=>{
 const unknown=createCymruLookup({resolveTxt:async()=>[['NA | NA']]});
 await assert.rejects(unknown('192.0.2.1'),/ASN/);
 await assert.rejects(unknown('127.0.0.999'),/IPv4/);
 const multi=createCymruLookup({resolveTxt:async()=>[['64500 64501 | 192.0.2.0/24']]});
 await assert.rejects(multi('192.0.2.1'),/ASN/);
 const ambiguous=createCymruLookup({resolveTxt:async()=>[['64500 | 192.0.2.0/24'],['64501 | 192.0.2.0/24']]});
 await assert.rejects(ambiguous('192.0.2.1'),/ASN/);
});

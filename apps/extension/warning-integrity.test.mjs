import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {frontendIntegrityText} from './warning-integrity.mjs';
test('displays stale subset and blind spots',()=>{const text=frontendIntegrityText({comparison:'agree',coverage:{compared:1,total:2},dataState:'stale',ageMs:123,unfamiliar:[],conflicts:[]}); assert.match(text,/1 of 2/); assert.match(text,/stale \(123 ms/); assert.match(text,/inline scripts/);});

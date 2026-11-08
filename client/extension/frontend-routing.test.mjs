import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {applyFrontendWarning} from './frontend-routing.mjs';
test('conflict raises severity without changing verdict or score', () => { const r=applyFrontendWarning({details:{verdict:'amber',score:42},assessment:{comparison:'conflict'}}); assert.equal(r.tier,'huge'); assert.equal(r.verdict,'amber'); assert.equal(r.score,42); assert.equal(applyFrontendWarning({details:{tier:'firewall'},assessment:{comparison:'conflict'}}).tier,'firewall'); });

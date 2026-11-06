import test from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser } from './browser-path.mjs';

test('browser selection respects explicit configuration and does not silently fall back', async () => {
  const checked = [];
  const check = async path => { checked.push(path); throw new Error('missing'); };
  await assert.rejects(findBrowser({ override: '/missing/browser', platform: 'darwin', check }), /BOUND_CHROMIUM_PATH/);
  assert.deepEqual(checked, ['/missing/browser']);
});

test('browser selection finds an available platform browser', async () => {
  const checked = [];
  const result = await findBrowser({ override: '', platform: 'linux', check: async path => { checked.push(path); if (path !== '/usr/bin/google-chrome') throw new Error('missing'); } });
  assert.equal(result, '/usr/bin/google-chrome');
  assert.equal(checked.length, 3);
});

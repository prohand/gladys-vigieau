// -----------------------------------------------------------------------------
// The start-up order: the refresh never depends on the catalog being accepted.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollThenPublish } from '../src/lifecycle.js';

function steps({ configured = true, publishError = null } = {}) {
  const calls = [];
  return {
    calls,
    configured,
    publish: async () => {
      calls.push('publish');
      if (publishError) {
        throw publishError;
      }
    },
    startPolling: () => calls.push('start'),
    stopPolling: () => calls.push('stop'),
  };
}

test('the refresh is armed BEFORE the catalog is published', async () => {
  const s = steps();
  assert.equal(await pollThenPublish(s), true);
  assert.deepEqual(s.calls, ['start', 'publish']);
});

test('a catalog Gladys refuses leaves the refresh running', async () => {
  // The devices the user already created must keep receiving their level even
  // when the Discovery list could not be re-sent.
  const s = steps({ publishError: new Error('Gladys refused the batch') });
  await assert.rejects(() => pollThenPublish(s), /refused/);
  assert.deepEqual(s.calls, ['start', 'publish']);
});

test('no usable location stops the refresh, and still publishes the empty catalog', async () => {
  const s = steps({ configured: false });
  assert.equal(await pollThenPublish(s), false);
  assert.deepEqual(s.calls, ['stop', 'publish']);
});

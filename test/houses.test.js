// -----------------------------------------------------------------------------
// Reading the houses configured in Gladys, through the SDK's getHouses().
//
// The network is never touched: the SDK instance is a stub, and its failures
// are the SDK's own GladysApiError, so the 403 detection is tested against the
// shape the SDK really throws.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { fetchHouses, HOUSE_ACCESS_DENIED, normalizeHouse } from '../src/houses.js';

/** An SDK instance whose getHouses answers `body`, or throws `error`. */
function sdk({ body = [], error = null } = {}) {
  const calls = [];
  return {
    calls,
    async getHouses() {
      calls.push('getHouses');
      if (error) {
        throw error;
      }
      return body;
    },
  };
}

test('the houses are read through the SDK', async () => {
  const gladys = sdk({
    body: [{ id: 'h1', name: 'Maison', selector: 'maison', latitude: 43.9, longitude: 1.35 }],
  });

  const houses = await fetchHouses(gladys);

  assert.deepEqual(gladys.calls, ['getHouses']);
  assert.deepEqual(houses, [
    { id: 'h1', name: 'Maison', selector: 'maison', latitude: 43.9, longitude: 1.35 },
  ]);
});

test('a house that was never placed on the map has no coordinates, not a zero', async () => {
  // `Number(null)` is 0, a valid latitude in the Gulf of Guinea.
  const gladys = sdk({ body: [{ id: 'h1', name: 'Bureau', latitude: null, longitude: null }] });

  const [house] = await fetchHouses(gladys);

  assert.equal(house.latitude, null);
  assert.equal(house.longitude, null);
});

test('a refused access is told apart from every other failure', async () => {
  // A 403 means the installed manifest never declared `location: true`, which
  // only a re-install fixes — nothing a retry would help with. The SDK carries
  // the HTTP status in `status`; its `code` is the core's own error code.
  const gladys = sdk({ error: new GladysApiError(403, 'FORBIDDEN', 'Forbidden') });

  await assert.rejects(fetchHouses(gladys), (err) => {
    assert.equal(err.code, HOUSE_ACCESS_DENIED);
    return true;
  });
});

test('any other failure is passed on as the SDK raised it', async () => {
  const error = new GladysApiError(500, 'SERVER_ERROR', 'Internal Server Error');
  await assert.rejects(fetchHouses(sdk({ error })), (err) => {
    assert.equal(err, error);
    assert.notEqual(err.code, HOUSE_ACCESS_DENIED);
    return true;
  });
});

test('an answer that is not a list is no houses, not a crash', async () => {
  assert.deepEqual(await fetchHouses(sdk({ body: { message: 'nope' } })), []);
});

test('a house with no name is still listed under one', () => {
  // The name is what tells "Maison" from "Bureau" in the answer of the button.
  assert.equal(normalizeHouse({ id: 'h1', name: '   ' }).name, 'Maison');
});

test('an unusable coordinate is dropped rather than watched', () => {
  const house = normalizeHouse({ id: 'h1', name: 'X', latitude: 300, longitude: 2 });
  assert.equal(house.latitude, null);
});

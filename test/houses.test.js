// -----------------------------------------------------------------------------
// Reading GET /house on the host API.
//
// The network is never touched: `globalThis.fetch` is stubbed per test and
// restored afterwards.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHouses, HOUSE_ACCESS_DENIED, HOUSE_API_PATH, normalizeHouse } from '../src/houses.js';

const CREDENTIALS = { hostApiUrl: 'http://172.30.0.1:80', token: 'jwt' };

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub `fetch` with one canned answer, and record what it was called with. */
function stubFetch({ status = 200, body = [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return calls;
}

test('the houses are read from the documented endpoint, with the integration token', async () => {
  const calls = stubFetch({
    body: [{ id: 'h1', name: 'Maison', selector: 'maison', latitude: 43.9, longitude: 1.35 }],
  });

  const houses = await fetchHouses(CREDENTIALS);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `http://172.30.0.1:80${HOUSE_API_PATH}`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer jwt');
  assert.deepEqual(houses, [
    { id: 'h1', name: 'Maison', selector: 'maison', latitude: 43.9, longitude: 1.35 },
  ]);
});

test('a trailing slash on the host URL does not double the one in the path', async () => {
  const calls = stubFetch();
  await fetchHouses({ ...CREDENTIALS, hostApiUrl: 'http://172.30.0.1:80/' });
  assert.equal(calls[0].url, `http://172.30.0.1:80${HOUSE_API_PATH}`);
});

test('a house that was never placed on the map has no coordinates, not a zero', async () => {
  // `Number(null)` is 0, a valid latitude in the Gulf of Guinea.
  stubFetch({ body: [{ id: 'h1', name: 'Bureau', latitude: null, longitude: null }] });

  const [house] = await fetchHouses(CREDENTIALS);

  assert.equal(house.latitude, null);
  assert.equal(house.longitude, null);
});

test('a refused access is told apart from every other failure', async () => {
  // A 403 means the installed manifest never declared `location: true`, which
  // only a re-install fixes — nothing a retry would help with.
  stubFetch({ status: 403 });

  await assert.rejects(fetchHouses(CREDENTIALS), (err) => {
    assert.equal(err.code, HOUSE_ACCESS_DENIED);
    return true;
  });
});

test('any other HTTP error carries its status', async () => {
  stubFetch({ status: 500 });
  await assert.rejects(fetchHouses(CREDENTIALS), /500/);
});

test('an answer that is not a list is no houses, not a crash', async () => {
  stubFetch({ body: { message: 'nope' } });
  assert.deepEqual(await fetchHouses(CREDENTIALS), []);
});

test('missing credentials fail before any request is made', async () => {
  const calls = stubFetch();
  await assert.rejects(fetchHouses({ hostApiUrl: '', token: '' }), /GLADYS_HOST_API_URL/);
  assert.equal(calls.length, 0);
});

test('a house with no name is still listed under one', () => {
  // The name is what tells "Maison" from "Bureau" in the answer of the button.
  assert.equal(normalizeHouse({ id: 'h1', name: '   ' }).name, 'Maison');
});

test('an unusable coordinate is dropped rather than watched', () => {
  const house = normalizeHouse({ id: 'h1', name: 'X', latitude: 300, longitude: 2 });
  assert.equal(house.latitude, null);
});

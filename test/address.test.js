import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeAddress,
  MIN_SCORE,
  pickAddress,
  resolveAddress,
  searchAddresses,
} from '../src/address.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the geocoder with a fixed payload, and record the URL called. */
function stubGeocoder(features, status = 200) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ type: 'FeatureCollection', features }),
    };
  };
  return calls;
}

/** One Base Adresse Nationale feature, in its real shape. */
function feature({ label, lon, lat, score, type = 'housenumber', city = '', postcode = '' }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      label,
      score,
      type,
      city,
      postcode,
      citycode: '82005',
      context: '82, Tarn-et-Garonne, Occitanie',
    },
  };
}

// --- Geocoding ---------------------------------------------------------------

test('searchAddresses reads the GeoJSON coordinates in the right order', async () => {
  // [longitude, latitude] — swapping them moves the location by hundreds of
  // kilometres, silently. The VigiEau front-end reads them the same way.
  stubGeocoder([
    feature({ label: '12 Rue des Lilas 82000 Montauban', lon: 1.3548, lat: 44.0175, score: 0.96 }),
  ]);
  const [match] = await searchAddresses('12 rue des lilas montauban');
  assert.equal(match.longitude, 1.3548);
  assert.equal(match.latitude, 44.0175);
});

test('searchAddresses normalizes the fields it needs', async () => {
  stubGeocoder([
    feature({
      label: 'Aucamville 82600',
      lon: 1.2,
      lat: 43.9,
      score: 0.8,
      type: 'municipality',
      city: 'Aucamville',
      postcode: '82600',
    }),
  ]);
  const [match] = await searchAddresses('Aucamville 82');
  assert.equal(match.label, 'Aucamville 82600');
  assert.equal(match.city, 'Aucamville');
  assert.equal(match.postcode, '82600');
  assert.equal(match.citycode, '82005');
  assert.equal(match.type, 'municipality');
  assert.equal(match.score, 0.8);
});

test('searchAddresses sends the query to the /search endpoint', async () => {
  const calls = stubGeocoder([]);
  await searchAddresses('Montauban');
  assert.match(calls[0], /\/search\/\?/);
  assert.match(calls[0], /q=Montauban/);
});

test('searchAddresses refuses a query too short to mean anything', async () => {
  await assert.rejects(() => searchAddresses('ab'), /at least three characters/);
  await assert.rejects(() => searchAddresses(''), /at least three characters/);
});

test('searchAddresses drops a feature without usable coordinates', async () => {
  stubGeocoder([
    { type: 'Feature', geometry: null, properties: { label: 'Broken', score: 0.9 } },
    feature({ label: 'Montauban', lon: 1.35, lat: 44.01, score: 0.9 }),
  ]);
  const matches = await searchAddresses('Montauban');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].label, 'Montauban');
});

test('searchAddresses surfaces a geocoder outage', async () => {
  stubGeocoder(null, 503);
  await assert.rejects(() => searchAddresses('Montauban'), /Base Adresse Nationale HTTP 503/);
});

test('searchAddresses tolerates a payload without features', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  assert.deepEqual(await searchAddresses('Montauban'), []);
});

// --- Picking -----------------------------------------------------------------

test('pickAddress takes the best match when it is convincing', () => {
  const best = pickAddress([
    { label: 'a', score: 0.9 },
    { label: 'b', score: 0.4 },
  ]);
  assert.equal(best.label, 'a');
});

test('pickAddress refuses a weak best match', () => {
  // A postal code covers several communes: guessing would silently watch
  // another town's drought level.
  assert.equal(pickAddress([{ label: 'a', score: MIN_SCORE - 0.01 }]), null);
  assert.equal(pickAddress([]), null);
});

// --- Presentation ------------------------------------------------------------

test('describeAddress shows the label and its context', () => {
  const line = describeAddress({ label: '12 Rue des Lilas 82000 Montauban', context: '82, …' });
  assert.match(line, /Rue des Lilas/);
  assert.match(line, /82/);
});

test('describeAddress copes with a match that has no context', () => {
  assert.equal(describeAddress({ label: 'Montauban' }), 'Montauban');
});

// --- Orchestration -----------------------------------------------------------

test('resolveAddress returns one point for a precise address', async () => {
  stubGeocoder([
    feature({ label: '12 Rue des Lilas 82000 Montauban', lon: 1.35, lat: 44.01, score: 0.96 }),
  ]);
  const { match, candidates } = await resolveAddress('12 rue des lilas 82000');
  assert.equal(match.latitude, 44.01);
  assert.equal(candidates.length, 1);
});

test('resolveAddress hands the candidates back when nothing stands out', async () => {
  stubGeocoder([
    feature({ label: 'Sainte-Marie 08390', lon: 4.5, lat: 49.5, score: 0.3, type: 'municipality' }),
    feature({
      label: 'Sainte-Marie 15190',
      lon: 2.8,
      lat: 45.1,
      score: 0.29,
      type: 'municipality',
    }),
  ]);
  const { match, candidates } = await resolveAddress('Sainte-Marie');
  assert.equal(match, null);
  assert.equal(candidates.length, 2);
});

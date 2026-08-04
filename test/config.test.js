import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, locationId, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ latitude: 45.75, longitude: 4.85, location_name: 'Jardin' });
  assert.equal(config.latitude, 45.75);
  assert.equal(config.longitude, 4.85);
  assert.equal(config.location_name, 'Jardin');
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({ latitude: '43.6', longitude: '1.44', poll_frequency: '7200' });
  assert.equal(config.latitude, 43.6);
  assert.equal(config.longitude, 1.44);
  assert.equal(config.poll_frequency, 7200);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('normalizeConfig keeps the INSEE code as a string, leading zero included', () => {
  const config = normalizeConfig({ commune: '01001' });
  assert.equal(config.commune, '01001');
  assert.equal(typeof config.commune, 'string');
});

test('normalizeConfig trims the free-text fields', () => {
  const config = normalizeConfig({ commune: ' 75056 ', location_name: '  Maison  ' });
  assert.equal(config.commune, '75056');
  assert.equal(config.location_name, 'Maison');
});

test('normalizeConfig falls back to the default for an unknown profile', () => {
  assert.equal(normalizeConfig({ profil: 'astronaute' }).profil, 'particulier');
  assert.equal(normalizeConfig({ profil: 'exploitation' }).profil, 'exploitation');
});

test('normalizeConfig falls back to the default for a missing numeric field', () => {
  assert.equal(normalizeConfig({ profil: 'entreprise' }).poll_frequency, 3600);
});

test('locationId prefers the INSEE code over the coordinates', () => {
  const config = normalizeConfig({ commune: '75056', latitude: 1, longitude: 2 });
  assert.equal(locationId(config), 'commune-75056');
});

test('locationId is stable against a sub-metre coordinate jitter', () => {
  const a = locationId(normalizeConfig({ latitude: 48.85661, longitude: 2.35221 }));
  const b = locationId(normalizeConfig({ latitude: 48.856612, longitude: 2.352214 }));
  assert.equal(a, b, 'the device external_id must survive a tiny coordinate change');
});

test('locationId changes when the location really moves', () => {
  const paris = locationId(normalizeConfig({ latitude: 48.8566, longitude: 2.3522 }));
  const lyon = locationId(normalizeConfig({ latitude: 45.764, longitude: 4.8357 }));
  assert.notEqual(paris, lyon);
});

test('locationId ignores a mere rename of the location', () => {
  const before = locationId(normalizeConfig({ latitude: 48.8566, location_name: 'Maison' }));
  const after = locationId(normalizeConfig({ latitude: 48.8566, location_name: 'Résidence' }));
  assert.equal(before, after, 'renaming must not orphan the device');
});

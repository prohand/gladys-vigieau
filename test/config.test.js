import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  locationId,
  hasCoordinates,
  isConfigured,
  DEFAULT_CONFIG,
} from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ commune: '69123', location_name: 'Jardin' });
  assert.equal(config.commune, '69123');
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

test('normalizeConfig upper-cases the Corsican INSEE codes', () => {
  assert.equal(normalizeConfig({ commune: '2a004' }).commune, '2A004');
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

// --- Optional coordinates ----------------------------------------------------

test('an empty coordinate field is null, never the 0 meridian', () => {
  // `Number('')` is 0, a perfectly valid latitude in the Gulf of Guinea: the
  // difference between "left empty" and "the equator" must survive the form.
  const config = normalizeConfig({ commune: '75056', latitude: '', longitude: undefined });
  assert.equal(config.latitude, null);
  assert.equal(config.longitude, null);
  assert.equal(hasCoordinates(config), false);
});

test('a coordinate of 0 is kept as a real coordinate', () => {
  const config = normalizeConfig({ commune: '75056', latitude: 0, longitude: 0 });
  assert.equal(config.latitude, 0);
  assert.equal(hasCoordinates(config), true);
});

test('a single coordinate is not enough to query a point', () => {
  assert.equal(hasCoordinates(normalizeConfig({ latitude: 48.85 })), false);
  assert.equal(hasCoordinates(normalizeConfig({ longitude: 2.35 })), false);
  assert.equal(hasCoordinates(normalizeConfig({ latitude: 48.85, longitude: 2.35 })), true);
});

test('a non-numeric coordinate is treated as empty', () => {
  assert.equal(normalizeConfig({ latitude: 'nord' }).latitude, null);
});

// --- Is the integration usable? ----------------------------------------------

test('isConfigured requires the INSEE code, or coordinates as a substitute', () => {
  assert.equal(isConfigured(normalizeConfig()), false, 'a fresh install knows no location');
  assert.equal(isConfigured(normalizeConfig({ commune: '75056' })), true);
  assert.equal(isConfigured(normalizeConfig({ latitude: 48.85, longitude: 2.35 })), true);
});

// --- Stable device identity --------------------------------------------------

test('locationId uses the commune when no coordinates are given', () => {
  assert.equal(locationId(normalizeConfig({ commune: '75056' })), 'commune-75056');
});

test('locationId prefers the coordinates, which is what is actually queried', () => {
  const config = normalizeConfig({ commune: '75056', latitude: 48.8566, longitude: 2.3522 });
  assert.equal(locationId(config), 'latlon-48.8566_2.3522');
});

test('locationId is stable against a sub-metre coordinate jitter', () => {
  const a = locationId(normalizeConfig({ latitude: 48.85661, longitude: 2.35221 }));
  const b = locationId(normalizeConfig({ latitude: 48.856612, longitude: 2.352214 }));
  assert.equal(a, b, 'the device external_id must survive a tiny coordinate change');
});

test('locationId changes when the location really moves', () => {
  const paris = locationId(normalizeConfig({ commune: '75056' }));
  const lyon = locationId(normalizeConfig({ commune: '69123' }));
  assert.notEqual(paris, lyon);
});

test('locationId ignores a mere rename of the location', () => {
  const before = locationId(normalizeConfig({ commune: '75056', location_name: 'Maison' }));
  const after = locationId(normalizeConfig({ commune: '75056', location_name: 'Résidence' }));
  assert.equal(before, after, 'renaming must not orphan the device');
});

test('locationId ignores the case of the INSEE code', () => {
  assert.equal(
    locationId(normalizeConfig({ commune: '2a004' })),
    locationId(normalizeConfig({ commune: '2A004' })),
  );
});

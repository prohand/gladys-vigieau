import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  legacyLocationId,
  hasCoordinates,
  isConfigured,
  formatCoordinate,
  legacyCoordinatePatch,
  DEFAULT_CONFIG,
} from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ latitude: 45.764, location_name: 'Jardin' });
  assert.equal(config.latitude, 45.764);
  assert.equal(config.location_name, 'Jardin');
});

test('normalizeConfig coerces numeric strings coming from a form', () => {
  const config = normalizeConfig({ latitude: '43.6', longitude: '1.44', poll_frequency: '7200' });
  assert.equal(config.latitude, 43.6);
  assert.equal(config.longitude, 1.44);
  assert.equal(config.poll_frequency, 7200);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('normalizeConfig trims the free-text fields', () => {
  assert.equal(normalizeConfig({ location_name: '  Maison  ' }).location_name, 'Maison');
  assert.equal(normalizeConfig({ address_label: '  12 rue X  ' }).address_label, '12 rue X');
});

test('the remembered address is informational and starts empty', () => {
  assert.equal(normalizeConfig().address_label, '');
  const config = normalizeConfig({ address_label: '12 Rue des Lilas 82000 Montauban' });
  assert.equal(config.address_label, '12 Rue des Lilas 82000 Montauban');
  // It must never take part in the location id either.
  assert.equal(
    legacyLocationId(normalizeConfig({ latitude: 1, longitude: 2, address_label: 'a' })),
    legacyLocationId(normalizeConfig({ latitude: 1, longitude: 2, address_label: 'b' })),
  );
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
  const config = normalizeConfig({ latitude: '', longitude: undefined });
  assert.equal(config.latitude, null);
  assert.equal(config.longitude, null);
  assert.equal(hasCoordinates(config), false);
});

test('a coordinate of 0 is kept as a real coordinate', () => {
  const config = normalizeConfig({ latitude: 0, longitude: 0 });
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

// --- Decimal separator -------------------------------------------------------

test('a coordinate typed with a comma is the same point as with a dot', () => {
  // The fields are text on purpose: an <input type="number"> hands the front an
  // EMPTY value for "48.8566" on a French browser, and the key is then dropped
  // from the saved payload — the coordinate silently keeps its old value.
  const comma = normalizeConfig({ latitude: '48,8566', longitude: '2,3522' });
  const dot = normalizeConfig({ latitude: '48.8566', longitude: '2.3522' });
  assert.equal(comma.latitude, 48.8566);
  assert.equal(comma.longitude, 2.3522);
  assert.deepEqual(comma, dot);
  assert.equal(legacyLocationId(comma), legacyLocationId(dot));
});

test('a negative or space-padded coordinate survives both separators', () => {
  assert.equal(normalizeConfig({ latitude: '-4,5' }).latitude, -4.5);
  assert.equal(normalizeConfig({ latitude: ' 48,8566 ' }).latitude, 48.8566);
  // A copy-paste from a web page brings non-breaking spaces along.
  assert.equal(normalizeConfig({ longitude: '2 345,678' }).longitude, null, 'out of range');
  assert.equal(normalizeConfig({ longitude: '2 ,3522' }).longitude, 2.3522);
});

test('a coordinate outside the WGS-84 range is treated as empty', () => {
  // The core enforced min/max as long as the fields were declared `number`;
  // they are text now, so the check has to happen here.
  assert.equal(normalizeConfig({ latitude: '91' }).latitude, null);
  assert.equal(normalizeConfig({ latitude: '-90' }).latitude, -90);
  assert.equal(normalizeConfig({ longitude: '181' }).longitude, null);
  assert.equal(normalizeConfig({ longitude: '180' }).longitude, 180);
  // A latitude of 100 typed for a longitude of 100 is fine the other way round.
  assert.equal(normalizeConfig({ longitude: '100' }).longitude, 100);
  assert.equal(normalizeConfig({ latitude: 100 }).latitude, null);
});

test('formatCoordinate writes the form the core and the parser both accept', () => {
  assert.equal(formatCoordinate(48.8566), '48.8566');
  assert.equal(typeof formatCoordinate(2.3522), 'string', 'a `string` field refuses a number');
  assert.equal(normalizeConfig({ latitude: formatCoordinate(48.8566) }).latitude, 48.8566);
});

test('coordinates stored as numbers by an older version are rewritten as text', () => {
  // Without the rewrite, the next Save on the Configuration screen fails as a
  // whole: the front sends the stored number back under a `string` field.
  assert.deepEqual(legacyCoordinatePatch({ latitude: 48.8566, longitude: 2.3522 }), {
    latitude: '48.8566',
    longitude: '2.3522',
  });
  assert.deepEqual(legacyCoordinatePatch({ latitude: '48.8566', longitude: '2.3522' }), {});
  assert.deepEqual(legacyCoordinatePatch({}), {});
  assert.deepEqual(legacyCoordinatePatch(), {});
  // A single stored number is migrated on its own.
  assert.deepEqual(legacyCoordinatePatch({ latitude: 0 }), { latitude: '0' });
});

// --- Is the integration usable? ----------------------------------------------

test('isConfigured requires a geocoded point', () => {
  assert.equal(isConfigured(normalizeConfig()), false, 'a fresh install knows no location');
  assert.equal(isConfigured(normalizeConfig({ latitude: 48.85 })), false, 'half a point is none');
  assert.equal(isConfigured(normalizeConfig({ latitude: 48.85, longitude: 2.35 })), true);
});

// --- Recognizing the devices published by the versions <= 1.1.1 --------------
// Those versions built the device external_id from this id, and that WAS the
// bug: each address got its own device. It survives to recognize — and adopt —
// the devices they created, so it must reproduce them exactly.

test('legacyLocationId reproduces the id those versions published', () => {
  const config = normalizeConfig({ latitude: 48.8566, longitude: 2.3522 });
  assert.equal(legacyLocationId(config), 'latlon-48.8566_2.3522');
});

test('legacyLocationId keeps its ~10 m rounding', () => {
  const a = legacyLocationId(normalizeConfig({ latitude: 48.85661, longitude: 2.35221 }));
  const b = legacyLocationId(normalizeConfig({ latitude: 48.856612, longitude: 2.352214 }));
  assert.equal(a, b, 'a sub-metre jitter published the same id');
});

test('legacyLocationId changes when the location really moves', () => {
  const paris = legacyLocationId(normalizeConfig({ latitude: 48.8566, longitude: 2.3522 }));
  const lyon = legacyLocationId(normalizeConfig({ latitude: 45.764, longitude: 4.8357 }));
  assert.notEqual(paris, lyon);
});

test('legacyLocationId ignores a mere rename of the location', () => {
  const point = { latitude: 48.8566, longitude: 2.3522 };
  const before = legacyLocationId(normalizeConfig({ ...point, location_name: 'Maison' }));
  const after = legacyLocationId(normalizeConfig({ ...point, location_name: 'Résidence' }));
  assert.equal(before, after);
});

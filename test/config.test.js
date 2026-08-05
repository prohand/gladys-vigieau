import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  legacyLocationId,
  isConfigured,
  formatCoordinate,
  toCoordinate,
  readDetailFields,
  legacyCoordinatePatch,
  DEFAULT_CONFIG,
} from '../src/config.js';
import { FIRST_LOCATION_ID } from '../src/locations.js';

/** A stored location list, in the shape `getConfig()` hands it back. */
function stored(...locations) {
  return locations.map((location, index) => ({
    id: `loc-${index}`,
    name: 'Maison',
    address_label: '',
    ...location,
  }));
}

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), { ...DEFAULT_CONFIG, locations: [], selectedId: '' });
});

test('the selected location is resolved to an id that really exists', () => {
  const locations = stored(
    { id: 'loc-a', name: 'Maison', latitude: '48.8', longitude: '2.3' },
    { id: 'loc-b', name: 'Jardin', latitude: '43.6', longitude: '1.4' },
  ).map((location, index) => ({ ...location, id: index === 0 ? 'loc-a' : 'loc-b' }));

  assert.equal(normalizeConfig({ locations, selected_location: 'loc-b' }).selectedId, 'loc-b');
  // A stale id — the location it named has been deleted — falls back to the
  // first one rather than leaving every editing action pointed at nothing.
  assert.equal(normalizeConfig({ locations, selected_location: 'loc-gone' }).selectedId, 'loc-a');
  assert.equal(normalizeConfig({ locations }).selectedId, 'loc-a');
  assert.equal(normalizeConfig({ locations: [] }).selectedId, '');
});

test('readDetailFields hands back the four mirror fields as trimmed text', () => {
  assert.deepEqual(
    readDetailFields({
      location_name: '  Maison ',
      address_label: '12 rue des Lilas',
      latitude: '48,8566',
      longitude: 2.3522,
      profil: 'particulier',
    }),
    {
      location_name: 'Maison',
      address_label: '12 rue des Lilas',
      // Not parsed here: this is what the FORM holds, raw, so two snapshots of
      // it can be compared field by field.
      latitude: '48,8566',
      longitude: '2.3522',
    },
  );
  assert.deepEqual(readDetailFields(), {
    location_name: '',
    address_label: '',
    latitude: '',
    longitude: '',
  });
});

test('normalizeConfig keeps user values over the defaults', () => {
  const config = normalizeConfig({ profil: 'exploitation', poll_frequency: 7200 });
  assert.equal(config.profil, 'exploitation');
  assert.equal(config.poll_frequency, 7200);
});

test('normalizeConfig coerces the numeric string coming from a form', () => {
  const config = normalizeConfig({ poll_frequency: '7200' });
  assert.equal(config.poll_frequency, 7200);
  assert.equal(typeof config.poll_frequency, 'number');
});

test('normalizeConfig falls back to the default for an unknown profile', () => {
  assert.equal(normalizeConfig({ profil: 'astronaute' }).profil, 'particulier');
  assert.equal(normalizeConfig({ profil: 'exploitation' }).profil, 'exploitation');
});

test('normalizeConfig falls back to the default for a missing numeric field', () => {
  assert.equal(normalizeConfig({ profil: 'entreprise' }).poll_frequency, 3600);
});

test('the location list is parsed out of the off-schema key', () => {
  const config = normalizeConfig({
    locations: stored({ name: 'Jardin', latitude: '43.6', longitude: '1.44' }),
  });
  assert.equal(config.locations.length, 1);
  assert.equal(config.locations[0].name, 'Jardin');
  assert.equal(config.locations[0].latitude, 43.6);
  assert.equal(config.locations[0].longitude, 1.44);
});

// --- Coordinates -------------------------------------------------------------

test('an empty coordinate is null, never the 0 meridian', () => {
  // `Number('')` is 0, a perfectly valid latitude in the Gulf of Guinea: the
  // difference between "left empty" and "the equator" must survive the form.
  assert.equal(toCoordinate('', 'latitude'), null);
  assert.equal(toCoordinate(undefined, 'longitude'), null);
  assert.equal(toCoordinate(0, 'latitude'), 0, 'a real 0 is a real coordinate');
});

test('a non-numeric coordinate is treated as empty', () => {
  assert.equal(toCoordinate('nord', 'latitude'), null);
});

test('a coordinate typed with a comma is the same point as with a dot', () => {
  // Coordinates are text on purpose: an <input type="number"> hands the front an
  // EMPTY value for "48.8566" on a French browser, and the key is then dropped
  // from the saved payload — the coordinate silently keeps its old value.
  assert.equal(toCoordinate('48,8566', 'latitude'), 48.8566);
  assert.equal(toCoordinate('48.8566', 'latitude'), 48.8566);
});

test('a negative or space-padded coordinate survives both separators', () => {
  assert.equal(toCoordinate('-4,5', 'latitude'), -4.5);
  assert.equal(toCoordinate(' 48,8566 ', 'latitude'), 48.8566);
  // A copy-paste from a web page brings non-breaking spaces along.
  assert.equal(toCoordinate('2 345,678', 'longitude'), null, 'out of range');
  assert.equal(toCoordinate('2 ,3522', 'longitude'), 2.3522);
});

test('a coordinate outside the WGS-84 range is treated as empty', () => {
  // The core enforced min/max as long as the coordinates were `number` config
  // fields; they are text now, so the check has to happen here.
  assert.equal(toCoordinate('91', 'latitude'), null);
  assert.equal(toCoordinate('-90', 'latitude'), -90);
  assert.equal(toCoordinate('181', 'longitude'), null);
  assert.equal(toCoordinate('180', 'longitude'), 180);
  // A latitude of 100 typed for a longitude of 100 is fine the other way round.
  assert.equal(toCoordinate('100', 'longitude'), 100);
  assert.equal(toCoordinate(100, 'latitude'), null);
});

test('formatCoordinate writes the form the parser reads back', () => {
  assert.equal(formatCoordinate(48.8566), '48.8566');
  assert.equal(typeof formatCoordinate(2.3522), 'string');
  assert.equal(toCoordinate(formatCoordinate(48.8566), 'latitude'), 48.8566);
});

// --- Is the integration usable? ----------------------------------------------

test('isConfigured requires at least one geocoded point', () => {
  assert.equal(isConfigured(normalizeConfig()), false, 'a fresh install knows no location');
  assert.equal(
    isConfigured(normalizeConfig({ locations: stored({ latitude: '48.85' }) })),
    false,
    'half a point is none',
  );
  assert.equal(
    isConfigured(normalizeConfig({ locations: stored({ latitude: '48.85', longitude: '2.35' }) })),
    true,
  );
});

test('isConfigured is happy as soon as ONE location is usable', () => {
  const config = normalizeConfig({
    locations: stored({ latitude: '', longitude: '' }, { latitude: '45.76', longitude: '4.83' }),
  });
  assert.equal(isConfigured(config), true, 'a broken entry must not silence the working one');
});

// --- Migrating an install made before 1.3.0 ----------------------------------

test('a pre-1.3.0 configuration becomes the first location, under its old id', () => {
  // Its device was published as `ext:...:drought-zone:location`. Reusing that id
  // is what keeps the device the user added to a room, with its history.
  const config = normalizeConfig({
    location_name: 'Maison',
    address_label: '12 rue des Lilas',
    latitude: '48.8566',
    longitude: '2.3522',
  });
  assert.deepEqual(config.locations, [
    {
      id: FIRST_LOCATION_ID,
      name: 'Maison',
      address_label: '12 rue des Lilas',
      latitude: 48.8566,
      longitude: 2.3522,
    },
  ]);
});

test('a pre-1.3.0 configuration with no coordinates migrates to no location', () => {
  assert.deepEqual(normalizeConfig({ location_name: 'Maison' }).locations, []);
});

test('an explicitly empty list is NOT re-filled from the old fields', () => {
  // An empty array means the user deleted every location: resurrecting their
  // old address on the next restart would be a bug, not a migration.
  const config = normalizeConfig({
    locations: [],
    latitude: '48.8566',
    longitude: '2.3522',
  });
  assert.deepEqual(config.locations, []);
});

test('the coordinates stored as numbers by <= 1.1.1 still migrate', () => {
  // They were declared `number` then, and they are read whatever their JSON
  // type: this is what rebuilds the first location of an upgraded install.
  const config = normalizeConfig({ latitude: 48.8566, longitude: 2.3522 });
  assert.equal(config.locations[0].latitude, 48.8566);
  assert.equal(config.locations[0].longitude, 2.3522);
});

test('a coordinate stored as a number is rewritten as text', () => {
  // The fields are still in the config_schema — they mirror the selected
  // location — and they are `string`. Left as numbers, the first Save of an
  // upgraded install would 422 as a whole: the front sends the untouched
  // stored value back and the core refuses a number under a `string` field.
  assert.deepEqual(legacyCoordinatePatch({ latitude: 48.8566, longitude: 2.3522 }), {
    latitude: '48.8566',
    longitude: '2.3522',
  });
  assert.deepEqual(legacyCoordinatePatch({ latitude: '48.8566', longitude: '2.3522' }), {});
  assert.deepEqual(legacyCoordinatePatch({}), {});
});

// --- Recognizing the devices published by the versions <= 1.1.1 --------------
// Those versions built the device external_id from this id, and that WAS the
// bug: each address got its own device. It survives to recognize — and adopt —
// the devices they created, so it must reproduce them exactly.

test('legacyLocationId reproduces the id those versions published', () => {
  assert.equal(legacyLocationId({ latitude: 48.8566, longitude: 2.3522 }), 'latlon-48.8566_2.3522');
});

test('legacyLocationId keeps its ~10 m rounding', () => {
  const a = legacyLocationId({ latitude: 48.85661, longitude: 2.35221 });
  const b = legacyLocationId({ latitude: 48.856612, longitude: 2.352214 });
  assert.equal(a, b, 'a sub-metre jitter published the same id');
});

test('legacyLocationId changes when the location really moves', () => {
  const paris = legacyLocationId({ latitude: 48.8566, longitude: 2.3522 });
  const lyon = legacyLocationId({ latitude: 45.764, longitude: 4.8357 });
  assert.notEqual(paris, lyon);
});

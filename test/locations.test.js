// -----------------------------------------------------------------------------
// The watched location list: the store the Configuration screen cannot hold.
//
// What these tests pin: a location keeps its id for life (the device external_id
// is built on it), the list survives a round-trip through the JSON the core
// stores, and no edit can silently drop or duplicate an entry.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_LOCATION_ID,
  MAX_LOCATIONS,
  describeLocation,
  findLocationById,
  findLocationByName,
  hasCoordinates,
  legacyLocations,
  locationQuery,
  newLocationId,
  normalizeLocations,
  removeLocation,
  serializeLocations,
  upsertLocation,
  usableLocations,
} from '../src/locations.js';

const paris = {
  id: 'loc-1',
  name: 'Maison',
  address_label: '',
  latitude: 48.8566,
  longitude: 2.3522,
};
const lyon = {
  id: 'loc-2',
  name: 'Jardin',
  address_label: '',
  latitude: 45.764,
  longitude: 4.8357,
};

test('an empty or missing list normalizes to no location', () => {
  assert.deepEqual(normalizeLocations(undefined), []);
  assert.deepEqual(normalizeLocations(null), []);
  assert.deepEqual(normalizeLocations([]), []);
  assert.deepEqual(normalizeLocations('nope'), []);
});

test('a stored list round-trips through serialize/normalize unchanged', () => {
  // What we write with setConfig has to be exactly what getConfig hands back,
  // or a restart would move a location.
  const locations = [paris, lyon];
  assert.deepEqual(normalizeLocations(serializeLocations(locations)), locations);
});

test('coordinates are serialized as TEXT, both separators parsed back', () => {
  const [serialized] = serializeLocations([paris]);
  assert.equal(typeof serialized.latitude, 'string');
  assert.equal(serialized.latitude, '48.8566');
  const [comma] = normalizeLocations([{ ...serialized, latitude: '48,8566' }]);
  assert.equal(comma.latitude, 48.8566);
});

test('a location with unusable coordinates is kept, but never published', () => {
  // Dropping it would lose the entry over a malformed value; the user must see
  // it in the list and be able to fix it.
  const locations = normalizeLocations([{ id: 'loc-1', name: 'Maison', latitude: 'nord' }]);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].latitude, null);
  assert.equal(hasCoordinates(locations[0]), false);
  assert.deepEqual(usableLocations(locations), []);
});

test('a single coordinate is not a point', () => {
  assert.equal(hasCoordinates({ latitude: 48.85, longitude: null }), false);
  assert.equal(hasCoordinates({ latitude: null, longitude: 2.35 }), false);
  assert.equal(hasCoordinates({ latitude: 0, longitude: 0 }), true, '0/0 is a real point');
});

test('a duplicated id is dropped rather than published twice', () => {
  // Two devices under one external_id: the second would overwrite the first's
  // states, silently.
  const locations = normalizeLocations([paris, { ...lyon, id: paris.id }]);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'Maison');
});

test('entries that are not objects are skipped', () => {
  assert.deepEqual(normalizeLocations([null, 'x', 42, paris]).length, 1);
});

test('the list is capped, so a loop cannot turn an install into a crawler', () => {
  const many = Array.from({ length: MAX_LOCATIONS + 5 }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: '48.85',
    longitude: '2.35',
  }));
  assert.equal(normalizeLocations(many).length, MAX_LOCATIONS);
});

// --- Identifiers -------------------------------------------------------------

test('a new id never collides with one already in use', () => {
  const existing = [paris, lyon];
  for (let i = 0; i < 50; i += 1) {
    const id = newLocationId(existing);
    assert.ok(!existing.some((location) => location.id === id));
    assert.notEqual(id, FIRST_LOCATION_ID, 'the migrated id is never handed out again');
  }
});

test('an entry stored without an id is given one instead of being dropped', () => {
  const [location] = normalizeLocations([{ name: 'Maison', latitude: '48.85', longitude: '2.35' }]);
  assert.ok(location.id, 'a device cannot be published without an external_id');
});

// --- Editing -----------------------------------------------------------------

test('upsertLocation adds a location without touching the others', () => {
  const locations = upsertLocation([paris], {
    id: 'loc-9',
    name: 'Chalet',
    latitude: 45.9,
    longitude: 6.87,
  });
  assert.equal(locations.length, 2);
  assert.deepEqual(locations[0], paris, 'the existing entries are untouched');
  assert.equal(locations[1].name, 'Chalet');
});

test('upsertLocation updates in place, keeping the id', () => {
  const locations = upsertLocation([paris, lyon], { id: lyon.id, name: 'Potager' });
  assert.equal(locations.length, 2);
  assert.equal(locations[1].id, lyon.id, 'the id is the device identity: it never moves');
  assert.equal(locations[1].name, 'Potager');
});

test('a rename does not blank the address the point came from', () => {
  const located = { ...paris, address_label: '12 rue des Lilas' };
  const [renamed] = upsertLocation([located], { id: located.id, name: 'Résidence' });
  assert.equal(renamed.address_label, '12 rue des Lilas');
  assert.equal(renamed.latitude, 48.8566, 'and it does not move either');
});

test('moving a location keeps its id, so its device keeps its history', () => {
  const [moved] = upsertLocation([paris], {
    id: paris.id,
    latitude: 45.764,
    longitude: 4.8357,
    address_label: 'Lyon',
  });
  assert.equal(moved.id, paris.id);
  assert.equal(moved.latitude, 45.764);
  assert.equal(moved.name, 'Maison', 'and its name');
});

test('removeLocation removes exactly one entry', () => {
  assert.deepEqual(removeLocation([paris, lyon], lyon.id), [paris]);
  assert.deepEqual(removeLocation([paris], 'unknown'), [paris], 'an unknown id changes nothing');
});

test('nothing mutates the list it was given', () => {
  const locations = [paris, lyon];
  upsertLocation(locations, { id: paris.id, name: 'Autre' });
  removeLocation(locations, paris.id);
  assert.deepEqual(locations, [paris, lyon]);
});

// --- Lookups -----------------------------------------------------------------

test('findLocationById finds the entry a device external_id was built on', () => {
  assert.equal(findLocationById([paris, lyon], 'loc-2'), lyon);
  assert.equal(findLocationById([paris], 'nope'), undefined);
});

test('findLocationByName ignores case and accents', () => {
  const accented = { ...paris, name: 'Résidence d’été' };
  assert.equal(findLocationByName([accented], 'residence d’ete'), accented);
  assert.equal(findLocationByName([accented], '  RÉSIDENCE D’ÉTÉ '), accented);
  assert.equal(findLocationByName([accented], ''), undefined, 'an empty name matches nothing');
  assert.equal(findLocationByName([accented], undefined), undefined);
});

// --- What the VigiEau driver is handed ---------------------------------------

test('locationQuery carries the point plus the GLOBAL profile', () => {
  // The profile is a config field shared by every location: the restrictions
  // that apply to a household are the same in every garden they own.
  assert.deepEqual(locationQuery({ profil: 'exploitation' }, paris), {
    latitude: 48.8566,
    longitude: 2.3522,
    profil: 'exploitation',
  });
});

// --- Migration ---------------------------------------------------------------

test('legacyLocations rebuilds the single pre-1.3.0 location under its old id', () => {
  assert.deepEqual(
    legacyLocations({
      location_name: 'Maison',
      address_label: '12 rue des Lilas',
      latitude: '48.8566',
      longitude: '2.3522',
    }),
    [
      {
        id: FIRST_LOCATION_ID,
        name: 'Maison',
        address_label: '12 rue des Lilas',
        latitude: 48.8566,
        longitude: 2.3522,
      },
    ],
  );
});

test('legacyLocations rebuilds nothing when no point was configured', () => {
  assert.deepEqual(legacyLocations({ location_name: 'Maison' }), []);
  assert.deepEqual(legacyLocations({ latitude: '48.85' }), [], 'half a point is none');
  assert.deepEqual(legacyLocations({}), []);
  assert.deepEqual(legacyLocations(), []);
});

test('legacyLocations names the location when the old config had no name', () => {
  const [location] = legacyLocations({ latitude: '48.85', longitude: '2.35' });
  assert.ok(location.name.length > 0, 'a device name cannot be empty');
});

// --- Messages ----------------------------------------------------------------

test('describeLocation shows the name, the address and the point', () => {
  const described = describeLocation({ ...paris, address_label: '12 rue des Lilas' });
  assert.match(described, /Maison/);
  assert.match(described, /12 rue des Lilas/);
  assert.match(described, /48\.85660/);
});

test('describeLocation survives a location with no usable coordinates', () => {
  const described = describeLocation({ name: 'Maison', latitude: null, longitude: null });
  assert.match(described, /Maison/);
});

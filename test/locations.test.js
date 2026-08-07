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
  LOCATION_LINE_MARKER,
  MAX_LOCATIONS,
  describeLocation,
  findLocationAtPoint,
  findLocationById,
  describeLocations,
  locationAtPosition,
  positionOf,
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
import { boldLabel } from '../src/richText.js';
import { plain } from './helpers/text.js';

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

test('findLocationAtPoint recognizes a point already watched', () => {
  // What keeps "Ajouter mes maisons Gladys" idempotent: the same roof, clicked
  // twice, is one location and one device history.
  assert.equal(findLocationAtPoint([paris, lyon], { latitude: 45.764, longitude: 4.8357 }), lyon);
  assert.equal(
    findLocationAtPoint([paris], { latitude: 48.8566001, longitude: 2.3522001 }),
    paris,
    'five decimals is about a metre — far below anything VigiEau tells apart',
  );
  assert.equal(findLocationAtPoint([paris], { latitude: 44.01, longitude: 1.35 }), undefined);
  assert.equal(
    findLocationAtPoint([paris], { latitude: null, longitude: null }),
    undefined,
    'a house never placed on the map matches nothing, least of all a location at 0',
  );
});

test('findLocationById finds the entry a device external_id was built on', () => {
  assert.equal(findLocationById([paris, lyon], 'loc-2'), lyon);
  assert.equal(findLocationById([paris], 'nope'), undefined);
});

test('a position designates a location, the way the dropdown does', () => {
  // The options of a `select` are written in the manifest, so they can only be
  // positions: "Lieu 1", "Lieu 2"... See src/locationEditor.js.
  assert.equal(locationAtPosition([paris, lyon], '1'), paris);
  assert.equal(locationAtPosition([paris, lyon], '2'), lyon);
  assert.equal(locationAtPosition([paris, lyon], '3'), null, 'past the end of the list');
  assert.equal(locationAtPosition([paris], '0'), null);
  assert.equal(locationAtPosition([paris], 'nope'), null);
  assert.equal(locationAtPosition([paris], undefined), null);
});

test('positionOf is the number the listing prints and the dropdown offers', () => {
  assert.equal(positionOf([paris, lyon], 'loc-2'), 2);
  assert.equal(positionOf([paris, lyon], 'nope'), 0);
});

test('describeLocations numbers the list, for the messages under a button', () => {
  // Those numbers are the ones the delete dropdown offers: a `select` holds
  // only the static options the manifest declares, never the location names.
  const summary = plain(describeLocations([paris, lyon]));
  assert.match(summary, /1\. Maison/);
  assert.match(summary, /2\. Jardin/);
  assert.match(describeLocations([]), /aucun lieu/);
});

test('describeLocations puts one location per line', () => {
  // A single run-on paragraph is unreadable past two locations. The newline is
  // what "one per line" means, even though today's Configuration screen renders
  // the message as the text of a plain <div> and collapses it — hence the
  // marker opening each entry, which keeps them apart either way.
  const lines = describeLocations([paris, lyon]).split('\n');
  assert.equal(lines.length, 2);
  assert.match(plain(lines[0]), /^• 1\. Maison — /);
  assert.match(plain(lines[1]), /^• 2\. Jardin — /);
});

test('the number and the name of an entry are emphasized, the detail is not', () => {
  // The only emphasis the Configuration screen can render: it escapes markup,
  // so bold is bold CHARACTERS (see src/richText.js). It stops at the label —
  // the address is what the user reads, searches and copies, and those code
  // points are not the letters they look like.
  const [line] = describeLocations([
    { ...lyon, address_label: '3 Rue Garibaldi 69003 Lyon' },
  ]).split('\n');
  assert.ok(line.startsWith(`• ${boldLabel('1. Jardin')} — `), line);
  assert.match(line, /— 3 Rue Garibaldi 69003 Lyon \(45\.76400, 4\.83570\)$/);
  assert.doesNotMatch(line.slice(line.indexOf(' — ')), /[\u{1D400}-\u{1D7FF}]/u);
});

test('a name the bold characters cannot spell keeps the label plain', () => {
  // There is no bold "é" in Unicode, and French town names are full of them.
  // Half a bold word renders in two typefaces mid-word — a rendering bug, not
  // emphasis — so such a label is simply left as it is.
  const [line] = describeLocations([{ ...paris, name: 'Chalet d’été' }]).split('\n');
  assert.equal(line, '• 1. Chalet d’été — 48.85660, 2.35220');
});

test('every entry opens with the marker, so a collapsed newline still reads as a list', () => {
  // THE bug this pins. The Configuration screen renders an action's answer as
  // the text of a plain <div class="alert">, and its default
  // `white-space: normal` collapses the newline into a space — checked in the
  // Gladys front on master, where the message is still a plain text child and
  // no CSS rule sets white-space. Collapsed, a bare "2." disappears among the
  // digits of an address ("... 69600 Oullins (45.71611, 4.80877) 2. Paris");
  // the bullet cannot occur inside one, so it is the visible boundary.
  const collapsed = describeLocations([paris, lyon]).replace(/\n/g, ' ');
  assert.equal(collapsed.split(LOCATION_LINE_MARKER).length - 1, 2, 'one marker per location');
  assert.ok(collapsed.startsWith(LOCATION_LINE_MARKER));
});

test('describeLocations lists a location that cannot be published either', () => {
  // It is neither published nor queried: this line is the only thing that says
  // why, so leaving it out would hide the entry the user has to fix.
  const broken = { name: 'Cassé', address_label: '', latitude: null, longitude: null };
  assert.match(plain(describeLocations([paris, broken])), /2\. Cassé — —/);
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
  assert.equal(
    describeLocation({ ...paris, address_label: '12 rue des Lilas' }),
    'Maison — 12 rue des Lilas (48.85660, 2.35220)',
  );
});

test('describeLocation drops the address column when there is none', () => {
  assert.equal(describeLocation(paris), 'Maison — 48.85660, 2.35220');
});

test('describeLocation survives a location with no usable coordinates', () => {
  const described = describeLocation({ name: 'Maison', latitude: null, longitude: null });
  assert.match(described, /Maison/);
});

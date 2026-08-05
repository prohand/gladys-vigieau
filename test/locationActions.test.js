// -----------------------------------------------------------------------------
// The buttons that manage the watched locations.
//
// They are the only way to edit the list — a config_schema cannot hold one —
// so everything a user can do wrong here (a vague address, a name they reuse,
// a device that is not in the dropdown yet) belongs in these tests.
// -----------------------------------------------------------------------------

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationActions } from '../src/locationActions.js';
import { normalizeConfig } from '../src/config.js';
import { MAX_LOCATIONS, serializeLocations } from '../src/locations.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The external_id the fake `devices` select hands back for a location. */
function deviceIdOf(location) {
  return `ext:vigieau:drought-zone:${location.id}`;
}

/**
 * The handlers, wired to an in-memory configuration: exactly what index.js
 * injects, minus the SDK.
 */
function createHarness({ locations = [] } = {}) {
  let config = normalizeConfig({ locations });
  const saves = [];
  const actions = createLocationActions({
    getConfig: () => config,
    saveLocations: async (next) => {
      saves.push(next);
      // Round-trips through the storage format, as the real one does.
      config = normalizeConfig({ locations: serializeLocations(next) });
    },
    resolveDevice: (externalId) =>
      config.locations.find((location) => deviceIdOf(location) === externalId),
  });
  return { actions, saves, locations: () => config.locations };
}

/** Answer the Base Adresse Nationale with these features. */
function stubGeocoder(features) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features }),
  });
}

/** One geocoder answer, good enough to be picked on its own. */
function addressFeature({ label, longitude, latitude, score = 0.9 }) {
  return {
    geometry: { coordinates: [longitude, latitude] },
    properties: { label, score, city: 'Paris', postcode: '75001', context: '75, Paris' },
  };
}

const PARIS = addressFeature({
  label: '12 Rue des Lilas 75001 Paris',
  longitude: 2.3522,
  latitude: 48.8566,
});
const LYON = addressFeature({
  label: '3 Rue Garibaldi 69003 Lyon',
  longitude: 4.8357,
  latitude: 45.764,
});

const MAISON = { id: 'loc-maison', name: 'Maison', latitude: '48.8566', longitude: '2.3522' };

// --- Adding ------------------------------------------------------------------

test('ajouter_lieu geocodes the address and stores the point', async () => {
  const { actions, locations } = createHarness();
  stubGeocoder([PARIS]);
  const message = await actions.ajouter_lieu({ nom: 'Maison', adresse: '12 rue des Lilas' });

  assert.equal(locations().length, 1);
  const [saved] = locations();
  assert.equal(saved.name, 'Maison');
  assert.equal(saved.latitude, 48.8566);
  assert.equal(saved.longitude, 2.3522, 'GeoJSON is [longitude, latitude], never the other way');
  assert.equal(saved.address_label, '12 Rue des Lilas 75001 Paris');
  assert.match(message.fr, /ajouté/);
  assert.match(message.fr, /Découverte/, 'the user is told where to add the device');
});

test('ajouter_lieu accepts coordinates typed by hand, with either separator', async () => {
  const { actions, locations } = createHarness();
  const message = await actions.ajouter_lieu({
    nom: 'Chalet',
    latitude: '45,9',
    longitude: '6,87',
  });
  assert.equal(locations()[0].latitude, 45.9);
  assert.equal(locations()[0].longitude, 6.87);
  assert.match(message.fr, /Chalet/);
});

test('ajouter_lieu refuses half a point', async () => {
  const { actions, saves } = createHarness();
  const message = await actions.ajouter_lieu({ nom: 'Chalet', latitude: '45.9' });
  assert.match(message.fr, /latitude ET la longitude/i);
  assert.equal(saves.length, 0, 'nothing is stored');
});

test('ajouter_lieu refuses an out-of-range coordinate rather than storing it', async () => {
  const { actions, saves } = createHarness();
  const message = await actions.ajouter_lieu({ nom: 'Nulle part', latitude: '91', longitude: '2' });
  assert.match(message.fr, /latitude ET la longitude/i);
  assert.equal(saves.length, 0);
});

test('ajouter_lieu insists on a name', async () => {
  const { actions, saves } = createHarness();
  const message = await actions.ajouter_lieu({ nom: '   ', adresse: 'Paris' });
  assert.match(message.fr, /nom/);
  assert.equal(saves.length, 0, 'a device cannot be named after nothing');
});

test('ajouter_lieu insists on a location', async () => {
  const { actions, saves } = createHarness();
  const message = await actions.ajouter_lieu({ nom: 'Maison' });
  assert.match(message.fr, /adresse/);
  assert.equal(saves.length, 0);
});

test('ajouter_lieu never guesses between several matching addresses', async () => {
  // A postal code covers several communes and a town name exists a dozen times
  // over: guessing would silently watch another town's drought level.
  const { actions, saves } = createHarness();
  stubGeocoder([
    addressFeature({ label: 'Saint-Martin (01)', longitude: 5.1, latitude: 46.1, score: 0.35 }),
    addressFeature({ label: 'Saint-Martin (02)', longitude: 3.4, latitude: 49.4, score: 0.34 }),
  ]);
  const message = await actions.ajouter_lieu({ nom: 'Maison', adresse: 'Saint-Martin' });
  assert.match(message.fr, /Précisez/);
  assert.match(message.fr, /Saint-Martin \(01\)/, 'the candidates are listed');
  assert.equal(saves.length, 0);
});

test('ajouter_lieu says so when the address does not exist', async () => {
  const { actions, saves } = createHarness();
  stubGeocoder([]);
  const message = await actions.ajouter_lieu({ nom: 'Maison', adresse: 'zzzzzz qqqqq' });
  assert.match(message.fr, /Aucune adresse/);
  assert.equal(saves.length, 0);
});

test('reusing a name updates that location instead of adding a twin', async () => {
  // The way to fix an address typed wrong before its device even exists: the
  // `devices` dropdown of the other actions cannot reach it yet.
  const { actions, locations } = createHarness({ locations: [MAISON] });
  stubGeocoder([LYON]);
  const message = await actions.ajouter_lieu({ nom: 'maison', adresse: '3 rue Garibaldi' });

  assert.equal(locations().length, 1, 'no twin');
  assert.equal(locations()[0].id, MAISON.id, 'and the device keeps its identity');
  assert.equal(locations()[0].latitude, 45.764);
  assert.match(message.fr, /mis à jour/);
});

test('a brand new location gets an id of its own', async () => {
  const { actions, locations } = createHarness({ locations: [MAISON] });
  stubGeocoder([LYON]);
  await actions.ajouter_lieu({ nom: 'Jardin', adresse: '3 rue Garibaldi' });
  assert.equal(locations().length, 2);
  assert.notEqual(locations()[1].id, locations()[0].id);
});

test('ajouter_lieu refuses to grow the list past the cap', async () => {
  const full = Array.from({ length: MAX_LOCATIONS }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: '48.85',
    longitude: '2.35',
  }));
  const { actions, saves } = createHarness({ locations: full });
  stubGeocoder([PARIS]);
  const message = await actions.ajouter_lieu({ nom: 'Un de trop', adresse: 'Paris' });
  assert.match(message.fr, new RegExp(`${MAX_LOCATIONS}`));
  assert.equal(saves.length, 0);
});

test('the cap never blocks an update of an existing location', async () => {
  const full = Array.from({ length: MAX_LOCATIONS }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: '48.85',
    longitude: '2.35',
  }));
  const { actions, locations } = createHarness({ locations: full });
  stubGeocoder([LYON]);
  await actions.ajouter_lieu({ nom: 'Lieu 0', adresse: '3 rue Garibaldi' });
  assert.equal(locations().length, MAX_LOCATIONS);
  assert.equal(locations()[0].latitude, 45.764);
});

// --- Editing -----------------------------------------------------------------

test('modifier_lieu renames without moving the location', async () => {
  const located = { ...MAISON, address_label: '12 rue des Lilas' };
  const { actions, locations } = createHarness({ locations: [located] });
  const message = await actions.modifier_lieu({
    appareil: deviceIdOf(located),
    nom: 'Résidence',
  });

  assert.equal(locations()[0].name, 'Résidence');
  assert.equal(locations()[0].latitude, 48.8566, 'a rename must not move it');
  assert.equal(locations()[0].address_label, '12 rue des Lilas', 'nor blank its address');
  assert.equal(locations()[0].id, MAISON.id, 'nor change the device identity');
  assert.match(message.fr, /historique/);
});

test('modifier_lieu moves without renaming the location', async () => {
  const { actions, locations } = createHarness({ locations: [MAISON] });
  stubGeocoder([LYON]);
  await actions.modifier_lieu({ appareil: deviceIdOf(MAISON), adresse: '3 rue Garibaldi' });

  assert.equal(locations()[0].name, 'Maison');
  assert.equal(locations()[0].latitude, 45.764);
  assert.equal(locations()[0].id, MAISON.id);
});

test('modifier_lieu needs a device it can resolve', async () => {
  const { actions, saves } = createHarness({ locations: [MAISON] });
  assert.match((await actions.modifier_lieu({})).fr, /Choisissez/);
  assert.match((await actions.modifier_lieu({ appareil: 'mqtt:sensor:1' })).fr, /Choisissez/);
  assert.equal(saves.length, 0);
});

test('modifier_lieu says so when nothing was actually asked for', async () => {
  const { actions, saves } = createHarness({ locations: [MAISON] });
  const message = await actions.modifier_lieu({ appareil: deviceIdOf(MAISON) });
  assert.match(message.fr, /Rien à modifier/);
  assert.equal(saves.length, 0);
});

test('modifier_lieu leaves the location alone when the new address is ambiguous', async () => {
  const { actions, saves } = createHarness({ locations: [MAISON] });
  stubGeocoder([
    addressFeature({ label: 'Saint-Martin (01)', longitude: 5.1, latitude: 46.1, score: 0.3 }),
    addressFeature({ label: 'Saint-Martin (02)', longitude: 3.4, latitude: 49.4, score: 0.29 }),
  ]);
  const message = await actions.modifier_lieu({
    appareil: deviceIdOf(MAISON),
    adresse: 'Saint-Martin',
  });
  assert.match(message.fr, /Précisez/);
  assert.equal(saves.length, 0, 'a half-applied edit would be worse than none');
});

// --- Deleting ----------------------------------------------------------------

test('supprimer_lieu removes the location behind the selected device', async () => {
  const jardin = { id: 'loc-jardin', name: 'Jardin', latitude: '45.764', longitude: '4.8357' };
  const { actions, locations } = createHarness({ locations: [MAISON, jardin] });
  const message = await actions.supprimer_lieu({ appareil: deviceIdOf(jardin) });

  assert.deepEqual(
    locations().map((location) => location.name),
    ['Maison'],
  );
  assert.match(message.fr, /Jardin/);
  // An integration cannot delete a Gladys device, and a sensor that never
  // updates again is worse than being told to remove it.
  assert.match(message.fr, /Supprimez aussi son appareil/);
});

test('supprimer_lieu reaches a location whose device was never created', async () => {
  // The `devices` dropdown only lists devices the user actually added, so a
  // location added by mistake would otherwise be impossible to remove.
  const { actions, locations } = createHarness({ locations: [MAISON] });
  const message = await actions.supprimer_lieu({ nom: 'maison' });
  assert.deepEqual(locations(), []);
  assert.match(message.fr, /Maison/);
});

test('supprimer_lieu refuses to guess what to delete', async () => {
  const { actions, saves } = createHarness({ locations: [MAISON] });
  assert.match((await actions.supprimer_lieu({})).fr, /Choisissez/);
  assert.match((await actions.supprimer_lieu({ nom: 'Inconnu' })).fr, /Choisissez/);
  assert.match((await actions.supprimer_lieu({ appareil: 'mqtt:1' })).fr, /Choisissez/);
  assert.equal(saves.length, 0);
});

// --- Listing -----------------------------------------------------------------

test('lister_lieux shows every location with its point', async () => {
  const jardin = { id: 'loc-jardin', name: 'Jardin', latitude: '45.764', longitude: '4.8357' };
  const { actions } = createHarness({ locations: [MAISON, jardin] });
  const message = await actions.lister_lieux();
  assert.match(message.fr, /Maison/);
  assert.match(message.fr, /Jardin/);
  assert.match(message.fr, new RegExp(`2/${MAX_LOCATIONS}`));
});

test('lister_lieux flags the locations that publish no device', async () => {
  const broken = { id: 'loc-broken', name: 'Cassé', latitude: 'nord' };
  const { actions } = createHarness({ locations: [MAISON, broken] });
  const message = await actions.lister_lieux();
  assert.match(message.fr, /sans coordonnées utilisables/);
  assert.match(message.en, /without usable coordinates/);
});

test('lister_lieux says so on a fresh install', async () => {
  const { actions } = createHarness();
  const message = await actions.lister_lieux();
  assert.match(message.fr, /Aucun lieu/);
  assert.match(message.en, /No location/);
});

// --- Every message reaches both languages ------------------------------------

test('every action message is multi-language', async () => {
  const { actions } = createHarness({ locations: [MAISON] });
  stubGeocoder([LYON]);
  const messages = [
    await actions.ajouter_lieu({ nom: 'Jardin', adresse: '3 rue Garibaldi' }),
    await actions.ajouter_lieu({}),
    await actions.modifier_lieu({ appareil: deviceIdOf(MAISON), nom: 'Résidence' }),
    await actions.modifier_lieu({}),
    await actions.lister_lieux(),
    await actions.supprimer_lieu({ nom: 'Résidence' }),
    await actions.supprimer_lieu({}),
  ];
  for (const message of messages) {
    assert.ok(message.fr, `missing French text in ${JSON.stringify(message)}`);
    assert.ok(message.en, `missing English text in ${JSON.stringify(message)}`);
  }
});

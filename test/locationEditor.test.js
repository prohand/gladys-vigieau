// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// It is the only way to change the watched locations — a config_schema cannot
// hold a list, and nothing on that screen edits one any more — so everything a
// user can do here belongs in these tests: add, delete, and read the table the
// integration draws under "Informations sur les lieux".
//
// Plus the one thing they cannot see: the table lines are config fields, so an
// open tab sends back the lines it was loaded with and the core stores them. A
// location added or deleted since must not stay on screen for good, and a line
// typed over must never become a location.
// -----------------------------------------------------------------------------

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationEditor } from '../src/locationEditor.js';
import { normalizeConfig } from '../src/config.js';
import { MAX_LOCATIONS, ROW_FIELDS } from '../src/locations.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * The manager, wired to an in-memory configuration: exactly what index.js
 * injects, minus the SDK.
 *
 * `stored` is the whole raw config as `getConfig()` hands it back — the
 * off-schema `locations` key AND the `lieu_N` fields, since those are what the
 * Configuration screen sends back and what the manager writes.
 */
function createHarness(stored = {}, { createdDeviceNames = {} } = {}) {
  let raw = { ...stored };
  let config = normalizeConfig(raw);
  const writes = [];
  let republished = 0;

  const editor = createLocationEditor({
    getConfig: () => config,
    setConfig: async (patch) => {
      writes.push(patch);
      raw = { ...raw, ...patch };
      config = normalizeConfig(raw);
    },
    onLocationsChanged: async () => {
      republished += 1;
    },
    // index.js answers this by looking the location's external_id up in
    // gladys.getDevices(); here the test just names the ones it created.
    findCreatedDevice: async (location) =>
      createdDeviceNames[location.id] ? { name: createdDeviceNames[location.id] } : null,
  });

  return {
    editor,
    writes,
    republished: () => republished,
    raw: () => raw,
    locations: () => config.locations,
    /** The table as the Configuration screen would show it, empty lines cut. */
    table: () => ROW_FIELDS.map((key) => raw[key] ?? '').filter((line) => line !== ''),
    // What the screen shows: a line the integration never had to write is
    // absent from the store, and the front falls back on the manifest default.
    row: (position) => raw[`lieu_${position}`] ?? '',
    /**
     * What an open Configuration screen sends back on a Save.
     *
     * The tab keeps showing what it loaded — the core pushes nothing to an open
     * form, and `POST /config` answers with the values read BEFORE the
     * integration writes anything — so the lines it sends are the ones of the
     * last page load, whatever happened since. Reproducing that is the point.
     */
    saveForm: async (edits = {}) => {
      raw = { ...raw, ...form, ...edits };
      config = normalizeConfig(raw);
      return editor.sync();
    },
    /** Remember what the screen is showing (it loads on page load). */
    reload: () => {
      form = Object.fromEntries(ROW_FIELDS.map((key) => [key, raw[key] ?? '']));
    },
  };
}

// The lines an open browser tab is showing. `reload()` refreshes them, and a
// Save sends them back untouched except for what the user typed — which is
// exactly how the front behaves.
let form = {};

function harness(stored = {}, options) {
  const h = createHarness(stored, options);
  // The connection draws the table, exactly as index.js does before publishing
  // anything; only what a test triggers itself is interesting afterwards.
  h.editor.sync();
  h.reload();
  h.writes.length = 0;
  return h;
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
function addressFeature({ label, longitude, latitude, score = 0.9, city = 'Paris' }) {
  return {
    geometry: { coordinates: [longitude, latitude] },
    properties: { label, score, city, postcode: '75001', context: '75, Paris' },
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
  city: 'Lyon',
});

const MAISON = {
  id: 'loc-maison',
  name: 'Maison',
  address_label: '12 Rue des Lilas 75001 Paris',
  latitude: '48.8566',
  longitude: '2.3522',
};
const JARDIN = {
  id: 'loc-jardin',
  name: 'Jardin',
  address_label: '3 Rue Garibaldi 69003 Lyon',
  latitude: '45.764',
  longitude: '4.8357',
};

/** A stored configuration whose table is already drawn. */
function installed(locations) {
  return { locations };
}

// --- Adding ------------------------------------------------------------------

test('rechercher_adresse geocodes the address and stores the point', async () => {
  const h = harness();
  stubGeocoder([PARIS]);
  const message = await h.editor.actions.rechercher_adresse({
    nom: 'Maison',
    adresse: '12 rue des Lilas',
  });

  assert.equal(h.locations().length, 1);
  const [saved] = h.locations();
  assert.equal(saved.name, 'Maison');
  assert.equal(saved.latitude, 48.8566);
  assert.equal(saved.longitude, 2.3522, 'GeoJSON is [longitude, latitude], never the other way');
  assert.match(message.fr, /Maison/);
  assert.match(message.fr, /Découverte/, 'the device still has to be added by the user');
  assert.equal(h.republished(), 1, 'the new device is offered right away');
});

test('a location added without a name is named after its town', async () => {
  const h = harness();
  stubGeocoder([LYON]);
  await h.editor.actions.rechercher_adresse({ adresse: '3 rue Garibaldi' });
  assert.equal(h.locations()[0].name, 'Lyon');
});

test('a new location takes the first free line of the table', async () => {
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  const message = await h.editor.actions.rechercher_adresse({
    nom: 'Jardin',
    adresse: '3 rue Garibaldi',
  });

  assert.equal(h.locations().length, 2);
  assert.equal(h.row(2), 'Jardin | 3 Rue Garibaldi 69003 Lyon | 45.76400 | 4.83570');
  assert.equal(h.row(1), 'Maison | 12 Rue des Lilas 75001 Paris | 48.85660 | 2.35220');
  assert.match(message.fr, /Lieu 2/, 'the number is the one the delete dropdown offers');
  assert.match(message.fr, /F5/, 'the open page will not show the new line on its own');
});

test('a vague address is never resolved by a coin flip', async () => {
  const h = harness();
  stubGeocoder([
    addressFeature({ label: 'Montauban 82000', longitude: 1.35, latitude: 44.01, score: 0.4 }),
    addressFeature({
      label: 'Montauban-de-Bretagne',
      longitude: -2.05,
      latitude: 48.2,
      score: 0.39,
    }),
  ]);
  const message = await h.editor.actions.rechercher_adresse({ adresse: 'Montauban' });

  assert.equal(h.locations().length, 0, 'nothing is stored on a guess');
  assert.match(message.fr, /Précisez/);
  assert.match(message.fr, /Montauban-de-Bretagne/, 'the candidates are shown');
});

test('an address that matches nothing says so', async () => {
  const h = harness();
  stubGeocoder([]);
  const message = await h.editor.actions.rechercher_adresse({ adresse: 'zzzz' });
  assert.equal(h.locations().length, 0);
  assert.match(message.fr, /Aucune adresse trouvée/);
});

test('the list is capped, and says how to make room', async () => {
  const full = Array.from({ length: MAX_LOCATIONS }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: '48.8566',
    longitude: '2.3522',
  }));
  const h = harness(installed(full));
  stubGeocoder([PARIS]);
  const message = await h.editor.actions.rechercher_adresse({ nom: 'Trop', adresse: 'Paris' });

  assert.equal(h.locations().length, MAX_LOCATIONS);
  assert.match(message.fr, new RegExp(`${MAX_LOCATIONS}`));
  assert.match(message.fr, /Supprimez/);
});

// --- The table ---------------------------------------------------------------

test('every configured location gets a line, and nothing else does', async () => {
  const h = harness({ locations: [MAISON, JARDIN] });
  await h.editor.sync();

  assert.deepEqual(h.table(), [
    'Maison | 12 Rue des Lilas 75001 Paris | 48.85660 | 2.35220',
    'Jardin | 3 Rue Garibaldi 69003 Lyon | 45.76400 | 4.83570',
  ]);
  assert.equal(h.row(3), '', 'the ten lines exist whatever the list holds');
  assert.equal(h.republished(), 0, 'the caller publishes the catalog itself on connection');
});

test('a location with no address still fills its four columns', async () => {
  const h = harness({
    locations: [{ id: 'loc-point', name: 'Point', latitude: '44.01', longitude: '1.35' }],
  });
  await h.editor.sync();
  assert.equal(h.row(1), 'Point | — | 44.01000 | 1.35000');
});

test('a location whose coordinates are unusable shows as much', async () => {
  // It cannot be published nor queried: the line is what says why.
  const h = harness({ locations: [{ id: 'loc-ko', name: 'Cassé', latitude: '', longitude: '' }] });
  await h.editor.sync();
  assert.equal(h.row(1), 'Cassé | — | — | —');
});

test('an untouched table is not rewritten on every save', async () => {
  const h = harness(installed([MAISON]));
  const rewritten = await h.saveForm();
  assert.equal(rewritten, false, 'saving the general settings must not write the table back');
  assert.equal(h.writes.length, 0);
});

test('a line typed over by the user is restored, and creates no location', async () => {
  const h = harness(installed([MAISON]));
  const rewritten = await h.saveForm({ lieu_1: 'nimporte quoi', lieu_2: 'Chalet | ici | 1 | 2' });

  assert.equal(rewritten, true);
  assert.equal(h.locations().length, 1, 'the table is a display, never an input');
  assert.equal(h.row(1), 'Maison | 12 Rue des Lilas 75001 Paris | 48.85660 | 2.35220');
  assert.equal(h.row(2), '');
});

test('the line of a location added since the page was loaded survives a save', async () => {
  // The open tab still shows one line and sends it back; the core stores it,
  // and without the redraw the location just added would vanish from the table
  // until the container restarts.
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  await h.editor.actions.rechercher_adresse({ nom: 'Jardin', adresse: '3 rue Garibaldi' });
  await h.saveForm();

  assert.equal(h.locations().length, 2);
  assert.match(h.row(2), /^Jardin/);
});

test('the line of a deleted location does not come back on the next save', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  h.reload();
  await h.editor.actions.supprimer_lieu({ lieu: '2', confirmation: true });
  await h.saveForm();

  assert.equal(h.locations().length, 1);
  assert.equal(h.row(2), '', 'only the configured locations show');
});

// --- Deleting ----------------------------------------------------------------

test('supprimer_lieu asks for a confirmation, and names what it would delete', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '2' });
  assert.equal(h.locations().length, 2, 'nothing is deleted on a stray click');
  assert.match(message.fr, /Jardin/);
  assert.match(message.fr, /confirme/);
});

test('supprimer_lieu removes the location its dropdown numbers', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '2', confirmation: true });

  assert.deepEqual(
    h.locations().map((location) => location.id),
    ['loc-maison'],
  );
  assert.equal(h.row(2), '', 'its line is cleared');
  // Its device was never created: re-publishing the catalog without it is all
  // it takes for the Discovery screen to stop offering it.
  assert.match(message.fr, /plus proposé dans l’onglet Découverte/);
  assert.equal(h.republished(), 1);
});

test('deleting a location whose device EXISTS says so, and where to delete it', async () => {
  // The one case an integration cannot clean up: the host API gives it no way
  // to delete a device the user created. Saying nothing leaves a sensor that
  // never updates again and no clue why.
  const h = harness(installed([MAISON, JARDIN]), {
    createdDeviceNames: { 'loc-jardin': 'Vigilance sécheresse — Jardin' },
  });
  const message = await h.editor.actions.supprimer_lieu({ lieu: '2', confirmation: true });

  assert.match(message.fr, /Vigilance sécheresse — Jardin/);
  assert.match(message.fr, /existe toujours dans Gladys/);
  assert.match(message.fr, /onglet Appareils/);
});

test('deleting a line moves the ones under it up, and says so', async () => {
  // The numbers of the table are what the delete dropdown offers: deleting by
  // position twice in a row, on a page nobody reloaded, would hit the wrong one.
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });

  assert.equal(h.row(1), 'Jardin | 3 Rue Garibaldi 69003 Lyon | 45.76400 | 4.83570');
  assert.equal(h.row(2), '');
  assert.match(message.fr, /remontent/);
  assert.match(message.fr, /F5/);
});

test('deleting the last line renumbers nothing', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '2', confirmation: true });
  assert.doesNotMatch(message.fr, /remontent/);
});

test('deleting the only location empties the table', async () => {
  const h = harness(installed([MAISON]));
  await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });

  assert.equal(h.locations().length, 0);
  assert.deepEqual(h.table(), []);
  assert.equal(h.republished(), 1, 'an empty catalog is published, and that is the point');
});

test('deleting says there is nothing to delete', async () => {
  const h = harness();
  const message = await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });
  assert.match(message.fr, /Aucun lieu/);
});

test('deleting a position the table does not reach is refused', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '3', confirmation: true });
  assert.equal(h.locations().length, 1, 'nothing was deleted');
  assert.match(message.fr, /pas de lieu/);
  assert.match(message.fr, /Maison/, 'and the answer lists what IS watched');
});

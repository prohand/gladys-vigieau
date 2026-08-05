// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// It is the only way to edit the watched locations — a config_schema cannot
// hold a list — so everything a user can do here belongs in these tests: add,
// select, edit through the mirror fields, delete. Plus the one thing they
// cannot see: the screen keeps showing the PREVIOUS location after a selection
// (the core pushes nothing back to an open form), and saving it must not write
// that location's address onto the newly selected one.
// -----------------------------------------------------------------------------

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationEditor, detailFieldsOf, SUMMARY_FIELD } from '../src/locationEditor.js';
import { normalizeConfig } from '../src/config.js';
import { MAX_LOCATIONS } from '../src/locations.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * The manager, wired to an in-memory configuration: exactly what index.js
 * injects, minus the SDK.
 *
 * `stored` is the whole raw config as `getConfig()` hands it back — the
 * off-schema keys AND the config fields, since the mirror fields are what the
 * Configuration screen sends and what the manager writes.
 */
function createHarness(stored = {}) {
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
  });

  return {
    editor,
    writes,
    republished: () => republished,
    raw: () => raw,
    config: () => config,
    locations: () => config.locations,
    selected: () => config.locations.find((location) => location.id === config.selectedId),
    /**
     * What an open Configuration screen would send back on the next Save.
     *
     * The tab keeps showing what it just sent — `saveConfig` refreshes its
     * fields from the POST answer, which the core builds from the database
     * BEFORE the integration has written anything back — so the edits stay in
     * `form` for the next Save too. Reproducing that is the whole point: it is
     * where the stale-form bugs live.
     */
    saveForm: (edits = {}) => {
      form = { ...form, ...edits };
      raw = { ...raw, ...form };
      config = normalizeConfig(raw);
      return editor.applyFormEdits();
    },
    /** Remember what the screen is currently showing (it loads on page load). */
    reload: () => {
      form = {
        location_name: raw.location_name ?? '',
        address_label: raw.address_label ?? '',
        latitude: raw.latitude ?? '',
        longitude: raw.longitude ?? '',
      };
    },
  };
}

// The fields an open browser tab is showing. `createHarness` seeds it from the
// stored config, `reload()` refreshes it, and a Save sends it back untouched
// except for what the user typed — which is exactly how the front behaves.
let form = {};

function harness(stored = {}) {
  const h = createHarness(stored);
  h.reload();
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

/** A stored configuration whose mirror fields already show `selected`. */
function installed(locations, selectedId = locations[0].id) {
  const selected = locations.find((location) => location.id === selectedId);
  return {
    locations,
    selected_location: selectedId,
    location_name: selected.name,
    address_label: selected.address_label,
    latitude: selected.latitude,
    longitude: selected.longitude,
  };
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

test('adding a location selects it and fills the mirror fields', async () => {
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  await h.editor.actions.rechercher_adresse({ nom: 'Jardin', adresse: '3 rue Garibaldi' });

  assert.equal(h.locations().length, 2);
  assert.equal(h.selected().name, 'Jardin', 'you edit what you have just added');
  assert.equal(h.raw().location_name, 'Jardin');
  assert.equal(h.raw().latitude, '45.764');
  assert.match(h.raw()[SUMMARY_FIELD], /▶ 2\. Jardin/);
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
  const full = Array.from({ length: MAX_LOCATIONS }, (_, index) => ({
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

// --- Selecting ---------------------------------------------------------------

test('selectionner_lieu points the mirror fields at the chosen position', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.selectionner_lieu({ lieu: '2' });

  assert.equal(h.selected().name, 'Jardin');
  assert.equal(h.raw().location_name, 'Jardin');
  assert.equal(h.raw().address_label, '3 Rue Garibaldi 69003 Lyon');
  assert.equal(h.raw().latitude, '45.764');
  assert.match(message.fr, /Jardin/);
  // The core pushes nothing to a form that is already open: without a reload
  // the fields above the button still show the previous location.
  assert.match(message.fr, /F5/);
});

test('a position past the end of the list is refused, with the list', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.editor.actions.selectionner_lieu({ lieu: '4' });
  assert.equal(h.selected().name, 'Maison', 'the selection did not move');
  assert.match(message.fr, /pas de lieu/);
  assert.match(message.fr, /Maison/, 'what does exist is shown');
});

test('selecting says there is nothing to select yet', async () => {
  const h = harness();
  const message = await h.editor.actions.selectionner_lieu({ lieu: '1' });
  assert.match(message.fr, /Aucun lieu/);
});

// --- Editing through the mirror fields ---------------------------------------

test('renaming the selected location through the form keeps its device', async () => {
  const h = harness(installed([MAISON, JARDIN], 'loc-jardin'));
  const message = await h.saveForm({ location_name: 'Potager' });

  assert.equal(h.locations()[1].name, 'Potager');
  assert.equal(h.locations()[1].id, 'loc-jardin', 'the identity never follows the name');
  assert.equal(h.locations()[0].name, 'Maison', 'the other location is untouched');
  assert.match(message.fr, /historique/);
});

test('a new address in the form is geocoded and moves the point', async () => {
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  await h.saveForm({ address_label: '3 rue Garibaldi' });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 45.764);
  assert.equal(saved.longitude, 4.8357);
  assert.equal(saved.address_label, '3 Rue Garibaldi 69003 Lyon', 'the resolved label is stored');
  assert.equal(saved.id, 'loc-maison', 'moving a location is not creating another one');
});

test('an address that cannot be resolved leaves the point where it was', async () => {
  const h = harness(installed([MAISON]));
  stubGeocoder([]);
  const message = await h.saveForm({ address_label: 'zzzz' });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 48.8566, 'the device keeps watching a real place');
  assert.equal(saved.address_label, '12 Rue des Lilas 75001 Paris');
  assert.match(message.fr, /Aucune adresse trouvée/);
  // Nothing of ours is rendered on the Configuration screen outside an action
  // result, so the reason has to travel in a field the next page load shows.
  assert.match(h.raw()[SUMMARY_FIELD], /^⚠/);
});

test('coordinates typed by hand win over the address', async () => {
  const h = harness(installed([MAISON]));
  // A French browser hands us a comma, and the field is `string` precisely so
  // that it reaches us at all.
  await h.saveForm({ latitude: '45,764', longitude: '4,8357' });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 45.764);
  assert.equal(saved.longitude, 4.8357);
});

test('half a pair of coordinates is refused, and the point is kept', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.saveForm({ latitude: '200' });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 48.8566, 'a latitude of 200 is not a place');
  assert.match(message.fr, /-90/);
  assert.match(h.raw()[SUMMARY_FIELD], /^⚠/);
});

test('saving an untouched form changes nothing and writes nothing', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.saveForm();
  assert.equal(message, null);
  assert.equal(h.writes.length, 0, 'a Save of the global settings must not rewrite the list');
});

test('a comma-separated coordinate is not read as an edit on every save', async () => {
  const h = harness(installed([MAISON]));
  await h.saveForm({ latitude: '48,8566' });
  assert.equal(h.writes.length, 0, '"48,8566" and "48.8566" are the same point: nothing to store');
});

test('an emptied name is refused rather than applied', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.saveForm({ location_name: '   ' });
  assert.equal(
    h.locations()[0].name,
    'Maison',
    'a device called "Vigilance sécheresse — " helps nobody',
  );
  // The core has already stored the empty name in the mirror field: left
  // there, the next page load would show the rename as if it had gone through.
  assert.equal(h.raw().location_name, 'Maison');
  assert.match(message.fr, /besoin d’un nom/);
  assert.match(h.raw()[SUMMARY_FIELD], /^⚠/);
});

test('a refused field is restored even when another one was accepted', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.saveForm({ location_name: '', latitude: '45.764', longitude: '4.8357' });

  assert.equal(h.locations()[0].name, 'Maison', 'the name was refused');
  assert.equal(h.locations()[0].latitude, 45.764, 'the point was accepted');
  assert.equal(h.raw().location_name, 'Maison');
  assert.match(message.fr, /besoin d’un nom/);
});

test('clearing the address keeps the point and drops its description', async () => {
  const h = harness(installed([MAISON]));
  await h.saveForm({ address_label: '' });
  const [saved] = h.locations();
  assert.equal(saved.address_label, '');
  assert.equal(saved.latitude, 48.8566);
});

// --- The stale form ----------------------------------------------------------
// The one thing the user cannot see. Everything below would silently corrupt a
// location without the snapshot the manager takes on every rewrite.

test('saving the form left over from a selection does NOT overwrite the new location', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  // No reload: the browser is still showing Maison's name and address.
  await h.saveForm();

  const jardin = h.locations()[1];
  assert.equal(jardin.name, 'Jardin', 'the selected location kept its own name');
  assert.equal(jardin.latitude, 45.764, 'and its own point');
  assert.equal(h.locations()[0].name, 'Maison');
});

test('an edit made on the stale form still reaches the selected location', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  // The user did not reload, but they did type: only what they touched is an
  // edit, the rest is the old location showing through.
  await h.saveForm({ location_name: 'Potager' });

  const jardin = h.locations()[1];
  assert.equal(jardin.name, 'Potager');
  assert.equal(jardin.address_label, '3 Rue Garibaldi 69003 Lyon', 'not Maison’s address');
  assert.equal(jardin.latitude, 45.764);
});

test('a SECOND save of the same stale form is still neutralized', async () => {
  // The regression this whole branch nearly shipped. The first Save is
  // neutralized and writes nothing — so the core keeps the stale values it has
  // just stored, the tab keeps showing them, and a guard cleared here would
  // let the second Save write the previous location's point onto this one.
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  await h.saveForm();
  await h.saveForm();

  const jardin = h.locations()[1];
  assert.equal(jardin.name, 'Jardin');
  assert.equal(jardin.latitude, 45.764, 'Maison’s point never reached Jardin');
  assert.equal(h.raw().location_name, 'Jardin', 'the database is back in step with the selection');
});

test('an edit made two saves after a selection still lands on the right location', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  await h.saveForm();
  await h.saveForm({ location_name: 'Potager' });

  assert.equal(h.locations()[1].name, 'Potager');
  assert.equal(h.locations()[1].latitude, 45.764, 'and not Maison’s point along with it');
});

test('the snapshot is used once: the next save is an ordinary one', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  await h.saveForm();
  h.reload(); // the user finally pressed F5
  await h.saveForm({ location_name: 'Potager' });

  assert.equal(h.locations()[1].name, 'Potager');
  assert.equal(h.editor._staleFields(), null);
});

test('two selections in a row keep protecting what the screen really shows', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  await h.editor.actions.selectionner_lieu({ lieu: '2' });
  await h.editor.actions.selectionner_lieu({ lieu: '1' });
  await h.saveForm();

  assert.equal(h.locations()[0].name, 'Maison');
  assert.equal(h.locations()[1].name, 'Jardin', 'neither location was touched');
});

test('saving after a delete does not resurrect the deleted location', async () => {
  const h = harness(installed([MAISON, JARDIN], 'loc-jardin'));
  await h.editor.actions.supprimer_lieu({ confirmation: true });
  // The form still holds Jardin's name and address.
  await h.saveForm();

  assert.equal(h.locations().length, 1);
  assert.equal(h.locations()[0].name, 'Maison', 'Maison was not renamed into Jardin');
  assert.equal(h.locations()[0].latitude, 48.8566);
});

// --- Deleting ----------------------------------------------------------------

test('supprimer_lieu asks for a confirmation, and names what it would delete', async () => {
  const h = harness(installed([MAISON, JARDIN], 'loc-jardin'));
  const message = await h.editor.actions.supprimer_lieu({});
  assert.equal(h.locations().length, 2, 'nothing is deleted on a stray click');
  assert.match(message.fr, /Jardin/);
  assert.match(message.fr, /confirme/);
});

test('supprimer_lieu removes the selected location and selects another', async () => {
  const h = harness(installed([MAISON, JARDIN], 'loc-jardin'));
  const message = await h.editor.actions.supprimer_lieu({ confirmation: true });

  assert.deepEqual(
    h.locations().map((location) => location.id),
    ['loc-maison'],
  );
  assert.equal(h.selected().name, 'Maison');
  assert.equal(h.raw().location_name, 'Maison', 'the mirror follows the new selection');
  // An integration can only stop OFFERING a device; deleting it is the user's.
  assert.match(message.fr, /Supprimez aussi son appareil/);
  assert.equal(h.republished(), 1);
});

test('deleting the last location empties the mirror fields', async () => {
  const h = harness(installed([MAISON]));
  await h.editor.actions.supprimer_lieu({ confirmation: true });

  assert.equal(h.locations().length, 0);
  assert.equal(h.raw().location_name, '');
  assert.equal(h.raw().latitude, '');
  assert.equal(h.raw()[SUMMARY_FIELD], '');
});

test('deleting says there is nothing to delete', async () => {
  const h = harness();
  const message = await h.editor.actions.supprimer_lieu({ confirmation: true });
  assert.match(message.fr, /Aucun lieu/);
});

test('an empty list never creates a location out of the form', async () => {
  // The fields still hold what the deleted location had; saving them must not
  // bring it back.
  const h = harness(installed([MAISON]));
  await h.editor.actions.supprimer_lieu({ confirmation: true });
  await h.saveForm({ location_name: 'Maison', latitude: '48.8566', longitude: '2.3522' });
  assert.equal(h.locations().length, 0);
});

// --- Connection --------------------------------------------------------------

test('sync writes the screen without touching the list nor re-publishing', async () => {
  const h = harness({ locations: [MAISON, JARDIN], selected_location: 'loc-jardin' });
  await h.editor.sync();

  assert.equal(h.raw().location_name, 'Jardin');
  assert.equal(h.raw().longitude, '4.8357');
  assert.match(h.raw()[SUMMARY_FIELD], /▶ 2\. Jardin/);
  assert.equal(h.republished(), 0, 'the caller publishes the catalog itself on connection');
});

test('detailFieldsOf is what an empty selection writes', () => {
  assert.deepEqual(detailFieldsOf(null), {
    location_name: '',
    address_label: '',
    latitude: '',
    longitude: '',
  });
});

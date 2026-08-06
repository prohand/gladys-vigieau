// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// It is the only way to change the watched locations — a config_schema cannot
// hold a list, and nothing on that screen shows one — so everything a user can
// do with them belongs in these tests: add a location from an address, add one
// from a point typed by hand, list them, and delete one.
//
// The listing matters as much as the rest: the screen displays NOTHING an
// integration says except the message an action resolves to, so
// "Afficher les lieux" is the only thing that maps "Lieu 2" to a name — which
// is exactly what the delete dropdown asks for.
// -----------------------------------------------------------------------------

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationEditor } from '../src/locationEditor.js';
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
 * `stored` is the whole raw config as `getConfig()` hands it back, the
 * off-schema `locations` key included — it is where the list lives.
 */
function harness(stored = {}, { createdDeviceNames = {}, reverse = null } = {}) {
  let raw = { ...stored };
  let config = normalizeConfig(raw);
  const writes = [];
  const reverseCalls = [];
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
    // Injected like the forward geocoder: it is what labels a typed point, and
    // the tests decide what the Base Adresse Nationale knows about it.
    reverseAddress: async (latitude, longitude) => {
      reverseCalls.push([latitude, longitude]);
      return typeof reverse === 'function' ? reverse(latitude, longitude) : reverse;
    },
  });

  return {
    editor,
    writes,
    reverseCalls,
    republished: () => republished,
    raw: () => raw,
    locations: () => config.locations,
  };
}

/** Answer the Base Adresse Nationale with these features. */
function stubGeocoder(features) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ features }),
  });
}

/** A geocoder that must never be called. */
function forbidGeocoder() {
  globalThis.fetch = async () => {
    throw new Error('the geocoder was called for a point that was typed');
  };
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

/** A stored configuration, as an install that already watches these has it. */
function installed(locations) {
  return { locations };
}

// --- Adding from an address --------------------------------------------------

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

test('a new location takes the next number of the listing', async () => {
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  const message = await h.editor.actions.rechercher_adresse({
    nom: 'Jardin',
    adresse: '3 rue Garibaldi',
  });

  assert.equal(h.locations().length, 2);
  assert.equal(h.locations()[1].name, 'Jardin');
  assert.match(message.fr, /Lieu 2/, 'the number is the one the delete dropdown offers');
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

test('an empty form asks for an address OR a point', async () => {
  const h = harness();
  const message = await h.editor.actions.rechercher_adresse({});
  assert.equal(h.locations().length, 0);
  assert.match(message.fr, /adresse/);
  assert.match(message.fr, /latitude/);
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

// --- Adding from a point typed by hand ---------------------------------------
// The way out of the cases geocoding cannot serve: an address the Base Adresse
// Nationale does not know, a plot with no street, a point read off a map.

/** The address the Base Adresse Nationale answers for a point. */
const OULLINS = {
  label: 'Grande Rue 69600 Oullins-Pierre-Bénite',
  city: 'Oullins-Pierre-Bénite',
  latitude: 45.71368,
  longitude: 4.80517,
};

test('a typed latitude and longitude add the location without geocoding', async () => {
  const h = harness();
  forbidGeocoder();
  const message = await h.editor.actions.rechercher_adresse({
    nom: 'Parcelle',
    latitude: '44.01',
    longitude: '1.35',
  });

  const [saved] = h.locations();
  assert.equal(saved.name, 'Parcelle');
  assert.equal(saved.latitude, 44.01);
  assert.equal(saved.longitude, 1.35);
  assert.equal(saved.address_label, '', 'the point falls on no address the BAN knows');
  assert.match(message.fr, /Parcelle/);
  assert.equal(h.republished(), 1);
});

test('a typed point is labelled with the address it falls on', async () => {
  // Without this the listing read "45.71368, 4.80517 — 45.71368, 4.80517" and
  // the device was named after two decimals. The point is still the one typed.
  const h = harness({}, { reverse: OULLINS });
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({ latitude: '45.71368', longitude: '4.80517' });

  const [saved] = h.locations();
  assert.equal(saved.address_label, 'Grande Rue 69600 Oullins-Pierre-Bénite');
  assert.equal(saved.name, 'Oullins-Pierre-Bénite', 'named after its town, like a geocoded one');
  assert.equal(saved.latitude, 45.71368, 'the label never moves the point');
  assert.equal(saved.longitude, 4.80517);
  assert.deepEqual(h.reverseCalls, [[45.71368, 4.80517]]);
});

test('a name typed by the user survives the address lookup', async () => {
  const h = harness({}, { reverse: OULLINS });
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({
    nom: 'Jardin',
    latitude: '45.71368',
    longitude: '4.80517',
  });

  const [saved] = h.locations();
  assert.equal(saved.name, 'Jardin');
  assert.equal(saved.address_label, 'Grande Rue 69600 Oullins-Pierre-Bénite');
});

test('a point whose address cannot be looked up is still added', async () => {
  // The address is a label; the point is what is watched. A geocoder outage
  // must not refuse coordinates the user read off a map.
  const h = harness(
    {},
    {
      reverse: () => {
        throw new Error('Base Adresse Nationale HTTP 503');
      },
    },
  );
  forbidGeocoder();
  const message = await h.editor.actions.rechercher_adresse({
    latitude: '45.71368',
    longitude: '4.80517',
  });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 45.71368);
  assert.equal(saved.address_label, '');
  assert.equal(saved.name, '45.71368, 4.80517', 'no town to name it after');
  assert.match(message.fr, /ajouté/);
});

test('a typed point is accepted with the French decimal separator', async () => {
  // The coordinates are `string` fields for exactly this reason: an
  // <input type="number"> hands the front an empty value for "48.8566" on a
  // French browser, and the key is then dropped from the payload it sends.
  const h = harness();
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({ latitude: '48,8566', longitude: '2,3522' });
  assert.equal(h.locations()[0].latitude, 48.8566);
  assert.equal(h.locations()[0].longitude, 2.3522);
});

test('a typed point wins over the address, which stays as its label', async () => {
  const h = harness({}, { reverse: OULLINS });
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({
    adresse: 'Le pré du bas',
    latitude: '44.01',
    longitude: '1.35',
  });

  const [saved] = h.locations();
  assert.equal(saved.latitude, 44.01, 'the point the user gave is the point that is watched');
  assert.equal(saved.address_label, 'Le pré du bas');
  assert.equal(saved.name, 'Le pré du bas', 'and it names the location, there being no town');
  assert.deepEqual(h.reverseCalls, [], 'the user wrote the label: nothing to look up');
});

test('an unnamed point with no address is named after itself', async () => {
  // A device cannot be published without a name, and "Vigilance sécheresse — "
  // says nothing.
  const h = harness();
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({ latitude: '44.01', longitude: '1.35' });
  assert.equal(h.locations()[0].name, '44.01000, 1.35000');
});

test('half a point is refused rather than completed with a zero', async () => {
  // `Number('')` is 0, a perfectly valid longitude off the coast of Ghana.
  const h = harness();
  forbidGeocoder();
  const message = await h.editor.actions.rechercher_adresse({ nom: 'Moitié', latitude: '44.01' });
  assert.equal(h.locations().length, 0);
  assert.match(message.fr, /longitude/);
});

test('a coordinate outside the WGS-84 range is refused, and says what it got', async () => {
  const h = harness();
  forbidGeocoder();
  const message = await h.editor.actions.rechercher_adresse({
    latitude: '300',
    longitude: '1.35',
  });
  assert.equal(h.locations().length, 0);
  assert.match(message.fr, /300/, 'the user has to see which value was rejected');
});

test('a typed point is refused before the geocoder is even called', async () => {
  // The address is not a fallback for a point that was typed wrong: silently
  // geocoding it would watch somewhere else entirely.
  const h = harness();
  forbidGeocoder();
  const message = await h.editor.actions.rechercher_adresse({
    adresse: '12 rue des Lilas',
    latitude: 'nord',
    longitude: '1.35',
  });
  assert.equal(h.locations().length, 0);
  assert.match(message.fr, /latitude/);
});

// --- Listing -----------------------------------------------------------------

test('afficher_lieux numbers every configured location', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.afficher_lieux();

  assert.match(message.fr, /1\. Maison — 12 Rue des Lilas 75001 Paris \(48\.85660, 2\.35220\)/);
  assert.match(message.fr, /2\. Jardin — 3 Rue Garibaldi 69003 Lyon \(45\.76400, 4\.83570\)/);
  assert.match(message.fr, new RegExp(`2/${MAX_LOCATIONS}`), 'and how much room is left');
  assert.equal(h.writes.length, 0, 'a listing writes nothing');
  assert.equal(h.republished(), 0);
});

test('afficher_lieux puts one location per line, the header on its own', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.afficher_lieux();

  for (const language of ['fr', 'en']) {
    const lines = message[language].split('\n');
    assert.equal(lines.length, 3, `${language}: a header line, then one line per location`);
    assert.match(lines[1], /^• 1\. Maison/);
    assert.match(lines[2], /^• 2\. Jardin/);
  }
});

test('afficher_lieux stays a list once the Configuration screen collapses the newlines', async () => {
  // That screen renders an action's answer as the text of a plain
  // <div class="alert">, whose default `white-space: normal` turns every
  // newline into a space — so what the user actually reads is this. The marker
  // opening each entry is what still separates them there.
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.afficher_lieux();

  for (const language of ['fr', 'en']) {
    const collapsed = message[language].replace(/\n/g, ' ');
    assert.equal(collapsed.split('• 1. ').length - 1, 1, `${language}: one entry per location`);
    assert.equal(collapsed.split('• 2. ').length - 1, 1);
    assert.doesNotMatch(
      collapsed,
      /(un par ligne|one per line)/i,
      'promising lines the screen does not render is how the bug was reported',
    );
  }
});

test('afficher_lieux lists a location that cannot be published either', async () => {
  // It is neither published nor queried: the listing is the only thing that
  // says why, so leaving it out would hide the entry the user has to fix.
  const h = harness(installed([{ id: 'loc-ko', name: 'Cassé', latitude: '', longitude: '' }]));
  const message = await h.editor.actions.afficher_lieux();
  assert.match(message.fr, /1\. Cassé/);
  assert.match(message.fr, /—/, 'with a dash where its point should be');
});

test('afficher_lieux says how to create the first location', async () => {
  const h = harness();
  const message = await h.editor.actions.afficher_lieux();
  assert.match(message.fr, /Aucun lieu/);
  assert.match(message.fr, /Ajouter un lieu/);
});

test('afficher_lieux shows a location added since the page was loaded', async () => {
  // The whole point of a listing under a button: the Configuration screen is
  // never refreshed by Gladys, but an action's answer is read live.
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  await h.editor.actions.rechercher_adresse({ nom: 'Jardin', adresse: '3 rue Garibaldi' });
  const message = await h.editor.actions.afficher_lieux();
  assert.match(message.fr, /2\. Jardin/);
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

test('deleting renumbers the locations under it, and says so', async () => {
  // Those numbers are what the delete dropdown offers: deleting by position
  // twice in a row, without listing again, would hit the wrong one.
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });

  assert.deepEqual(
    h.locations().map((location) => location.name),
    ['Jardin'],
  );
  assert.match(message.fr, /remontent/);
  assert.match(message.fr, /Afficher les lieux/);
});

test('deleting the last one renumbers nothing', async () => {
  const h = harness(installed([MAISON, JARDIN]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '2', confirmation: true });
  assert.doesNotMatch(message.fr, /remontent/);
});

test('deleting the only location empties the list', async () => {
  const h = harness(installed([MAISON]));
  await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });

  assert.equal(h.locations().length, 0);
  assert.equal(h.republished(), 1, 'an empty catalog is published, and that is the point');
});

test('deleting says there is nothing to delete', async () => {
  const h = harness();
  const message = await h.editor.actions.supprimer_lieu({ lieu: '1', confirmation: true });
  assert.match(message.fr, /Aucun lieu/);
});

test('deleting a position the list does not reach is refused', async () => {
  const h = harness(installed([MAISON]));
  const message = await h.editor.actions.supprimer_lieu({ lieu: '3', confirmation: true });
  assert.equal(h.locations().length, 1, 'nothing was deleted');
  assert.match(message.fr, /pas de lieu/);
  assert.match(message.fr, /Maison/, 'and the answer lists what IS watched');
});

// --- What is written --------------------------------------------------------

test('an edit writes the location list and nothing else', async () => {
  // The `lieu_1` .. `lieu_10` fields of 1.3.0 are gone from the schema: writing
  // them would only leave dead values in the store.
  const h = harness(installed([MAISON]));
  stubGeocoder([LYON]);
  await h.editor.actions.rechercher_adresse({ nom: 'Jardin', adresse: '3 rue Garibaldi' });

  assert.equal(h.writes.length, 1);
  assert.deepEqual(Object.keys(h.writes[0]), ['locations']);
});

test('what is written is what normalizeConfig reads back', async () => {
  // A restart must not move a location: the stored shape is text coordinates.
  const h = harness();
  forbidGeocoder();
  await h.editor.actions.rechercher_adresse({
    nom: 'Parcelle',
    latitude: '44,01',
    longitude: '1,35',
  });

  assert.deepEqual(h.raw().locations, [
    {
      id: h.locations()[0].id,
      name: 'Parcelle',
      address_label: '',
      latitude: '44.01',
      longitude: '1.35',
    },
  ]);
});

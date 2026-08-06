// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { DEFAULT_CONFIG, PROFILES } from '../src/config.js';
import { LOCATIONS_KEY, MAX_LOCATIONS } from '../src/locations.js';
import { createLocationEditor } from '../src/locationEditor.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Actions registered outside the blueprints, in index.js: the ones that EDIT
// the location list write the configuration back and re-publish the catalog,
// which is not a device's business. Read off the factory rather than listed by
// hand, so adding one there cannot silently skip the manifest.
const REGISTRY_LEVEL_ACTIONS = Object.keys(
  createLocationEditor({
    getConfig: () => ({ locations: [] }),
    setConfig: async () => {},
    onLocationsChanged: async () => {},
  }).actions,
);

// The store schema only accepts these widget types — 'text' is NOT one of them,
// the free-text widget is called 'string'. Getting it wrong is rejected at
// indexing time, long after the code looks fine locally.
const ALLOWED_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

/** Every field of the manifest, config fields and action fields alike. */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
  ];
}

function action(key) {
  return (manifest.actions ?? []).find((a) => a.key === key);
}

function configField(key) {
  return manifest.config_schema.find((f) => f.key === key);
}

test('every manifest action has a registered handler', () => {
  const handled = new Set([
    ...DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {})),
    ...REGISTRY_LEVEL_ACTIONS,
  ]);
  for (const declared of manifest.actions ?? []) {
    assert.ok(handled.has(declared.key), `manifest action "${declared.key}" has no handler`);
  }
});

test('every registered handler is declared in the manifest', () => {
  const declared = new Set((manifest.actions ?? []).map((a) => a.key));
  for (const key of [
    ...DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {})),
    ...REGISTRY_LEVEL_ACTIONS,
  ]) {
    assert.ok(declared.has(key), `action "${key}" is implemented but not declared`);
  }
});

// --- The location manager ----------------------------------------------------
// The locations are a list the user builds at runtime through the actions. A
// config_schema is a fixed set of fields with no repeatable one, so the list
// cannot be a form field: it lives under an off-schema key, and the only place
// it is ever displayed is the message of the "afficher_lieux" action.

test('the location list is not a config_schema field', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(
    !keys.includes(LOCATIONS_KEY),
    'an off-schema key is free internal storage; declaring it would 422 every save',
  );
});

test('the Configuration screen holds NOTHING about the locations', () => {
  // Every non-section field it renders is an <input>: no read-only widget, no
  // multi-line one, no repeatable one. The ten `lieu_N` lines of 1.3.0 were a
  // table only in spirit — they needed an F5 to refresh and a rewrite on every
  // save — and a `select` pointing at one entry could only ever offer positions,
  // never names. The list belongs under the buttons, where a message is shown.
  const keys = manifest.config_schema.map((f) => f.key);
  assert.deepEqual(
    keys.filter((key) => /^lieu/.test(key)),
    [],
    'no table line and no location section left in the schema',
  );
  for (const key of ['lieu', 'lieux', 'location_name', 'address_label', 'latitude', 'longitude']) {
    assert.equal(configField(key), undefined, `"${key}" belonged to the editable screen`);
  }
});

test('the general settings are the whole Configuration screen', () => {
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(keys, ['profil', 'poll_frequency'], 'they apply to every location');
});

test('listing the locations is an action, and the only display there is', () => {
  const listing = action('afficher_lieux');
  assert.ok(listing, 'nothing on the Configuration screen shows the list');
  assert.equal((listing.fields ?? []).length, 0, 'it reports on every location');
  // Its numbers are the ones the delete dropdown offers: it is what tells the
  // user which location "Lieu 2" is.
  assert.match(listing.description.fr, /numéro/i);
});

test('the delete action names a location by its number in the listing', () => {
  const deletePicker = (action('supprimer_lieu').fields ?? []).find((f) => f.key === 'lieu');
  assert.ok(deletePicker, 'the only dropdown left, and it deletes');
  assert.equal(deletePicker.type, 'select');
  assert.equal(deletePicker.required, true);
  assert.equal(deletePicker.default, '1');
  // Static options, because that is all a manifest can hold: they are the line
  // numbers of the table, which is what maps a number to a name.
  assert.deepEqual(
    deletePicker.options.map((option) => option.value),
    Array.from({ length: MAX_LOCATIONS }, (unused, index) => String(index + 1)),
    'the dropdown and MAX_LOCATIONS must not drift apart',
  );
});

test('the delete action is the LAST button of the screen', () => {
  // The buttons are rendered in manifest order (ActionsCard.jsx maps over
  // `actions`), and this one is the only destructive button of the page: it
  // sits under the two read-only reports rather than between the listing and
  // them, where a mis-click lands while looking for "Tester la connexion".
  // Its dropdown numbers still come from "Afficher les lieux", which stays
  // above it.
  const keys = (manifest.actions ?? []).map((a) => a.key);
  assert.equal(keys[keys.length - 1], 'supprimer_lieu');
  assert.ok(
    keys.indexOf('afficher_lieux') < keys.indexOf('supprimer_lieu'),
    'the listing is what tells the user which location "Lieu 2" is',
  );
});

test('"Pour commencer" carries the presentation and its two links, nothing else', () => {
  const intro = configField('intro');
  assert.equal(intro.type, 'section');
  assert.deepEqual(
    (intro.links ?? []).map((link) => link.url),
    ['https://vigieau.gouv.fr', 'https://api.vigieau.beta.gouv.fr/swagger'],
  );
  // Everything about picking a location moved to its own section: this one
  // says what VigiEau is, and stops there.
  assert.doesNotMatch(intro.description.fr, /liste deroulante|F5|rechargez/i);
});

test('NO field takes its options from a core-defined dynamic source', () => {
  // THE bug this pins. A `select` with `source: "devices"` IS rendered as a
  // dropdown of the integration's own devices by the Configuration screen —
  // but the server side of that source (getDynamicOptions, Gladys PR #2779)
  // ships in no released Gladys: up to 4.84.4 included, validateConfigValue
  // reads a select's valid values from the manifest's STATIC `options`, which
  // a field with a `source` does not have. Every value the dropdown offered
  // was therefore refused with a 422 before the action reached the container,
  // and the screen showed "L'action a échoué. Vérifiez que l'intégration est
  // démarrée." Positions are validated on every version, past and future.
  for (const field of allFields()) {
    assert.equal(
      field.source,
      undefined,
      `"${field.key}": no released Gladys can validate a dynamic source`,
    );
  }
});

test('adding a location asks for an address, or for a point', () => {
  const add = action('rechercher_adresse');
  assert.ok(add, 'adding a location is still the way in: type an address, it is geocoded');
  assert.deepEqual(
    (add.fields ?? []).map((f) => f.key),
    ['nom', 'adresse', 'latitude', 'longitude'],
  );
  for (const field of add.fields) {
    // NOTHING is required here: an address alone is enough, and so is a point.
    // Marking the address required would forbid the point, and marking the
    // coordinates required would forbid the address.
    assert.notEqual(
      field.required,
      true,
      `"${field.key}" cannot be the only way to add a location`,
    );
  }
});

test('a coordinate is typed in a `string` field, never in a `number` one', () => {
  // An <input type="number"> is sanitized by the browser against ITS OWN
  // locale: a French one turns "48.8566" into an empty string, and the front
  // then drops the key from the payload it sends. `toCoordinate` parses the
  // text itself, comma included, and checks the WGS-84 range the store schema
  // can only express on a number.
  for (const key of ['latitude', 'longitude']) {
    const field = (action('rechercher_adresse').fields ?? []).find((f) => f.key === key);
    assert.equal(field.type, 'string', `"${key}" must not be a number field`);
    assert.equal(field.min, undefined, 'the range is checked in src/coordinates.js');
    assert.equal(field.max, undefined);
  }
});

test('deleting takes its own location plus a confirmation', () => {
  const remove = action('supprimer_lieu');
  assert.deepEqual(
    (remove.fields ?? []).map((f) => f.key),
    ['lieu', 'confirmation'],
  );
  const confirmation = remove.fields[1];
  assert.equal(confirmation.type, 'boolean');
  assert.equal(confirmation.default, false, 'never armed by default');
});

test('the query actions take no field at all', () => {
  // They report on every watched location, so there is nothing to ask.
  for (const key of ['afficher_lieux', 'test_vigieau', 'show_restrictions']) {
    assert.equal((action(key).fields ?? []).length, 0, `"${key}" needs no form`);
  }
});

test('no INSEE commune code is asked for any more', () => {
  // The commune path answers 409 whenever a commune spans several zones of the
  // same type; a geocoded point never does.
  const keys = allFields().map((f) => f.key);
  assert.ok(!keys.includes('commune'), 'a location is a point, not a commune code');
  assert.ok(!('commune' in DEFAULT_CONFIG));
});

// --- Field rules -------------------------------------------------------------

test('every field uses a widget type the store accepts', () => {
  for (const field of allFields()) {
    assert.ok(
      ALLOWED_FIELD_TYPES.includes(field.type),
      `field "${field.key}" has the unsupported type "${field.type}"`,
    );
  }
});

test('every field carries both labels', () => {
  for (const field of allFields()) {
    assert.ok(field.label?.en && field.label?.fr, `"${field.key}" needs both labels`);
  }
});

test('placeholders are multi-language objects, never bare strings', () => {
  for (const field of allFields()) {
    if (field.placeholder !== undefined) {
      assert.equal(
        typeof field.placeholder,
        'object',
        `"${field.key}": placeholder must be an object`,
      );
      assert.ok(field.placeholder.en, `"${field.key}": placeholder needs an English text`);
    }
  }
});

test('the global settings keep their defaults in DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG is missing "${field.key}"`);
    assert.equal(
      DEFAULT_CONFIG[field.key],
      field.default,
      `DEFAULT_CONFIG.${field.key} must match the manifest default`,
    );
  }
});

test('the profile select offers exactly the profiles VigiEau accepts', () => {
  const field = configField('profil');
  assert.deepEqual(
    field.options.map((option) => option.value).sort(),
    [...PROFILES].sort(),
    'the manifest options and PROFILES must not drift apart',
  );
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration screen opens with an intro block');
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('every label and description is translated in French and English', () => {
  const texts = [
    manifest.description,
    ...allFields().flatMap((f) => [
      f.label,
      f.description,
      ...(f.options ?? []).map((o) => o.label),
      ...(f.links ?? []).map((l) => l.label),
    ]),
    ...(manifest.actions ?? []).flatMap((a) => [a.label, a.description]),
  ].filter(Boolean);

  for (const text of texts) {
    assert.ok(text.en, `missing English text in ${JSON.stringify(text)}`);
    assert.ok(text.fr, `missing French text in ${JSON.stringify(text)}`);
  }
});

test('the manifest version matches package.json and the Docker image tag', () => {
  assert.equal(manifest.version, packageJson.version, 'the release workflow bumps both together');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image "${manifest.docker_image}" must be tagged with the manifest version`,
  );
});

test('the catalog description stays within the 100-character store limit', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10, `description.${language} is too short`);
    assert.ok(text.length <= 100, `description.${language} is ${text.length} characters, max 100`);
  }
});

// --- Coordinates -------------------------------------------------------------

test('the only number field left is the refresh interval', () => {
  // A `number` field is an <input type="number">, whose value the browser
  // sanitizes against ITS OWN locale: a French browser turns "48.8566" into an
  // empty string and the front then drops the key from the payload it sends —
  // silently, the value keeping whatever it held. A decimal a user has to type
  // therefore belongs in a `string` field, parsed here (src/coordinates.js).
  // An interval in whole seconds is the one number no locale can mangle.
  assert.deepEqual(
    allFields()
      .filter((f) => f.type === 'number')
      .map((f) => f.key),
    ['poll_frequency'],
  );
});

test('a coordinate is never a Configuration field', () => {
  // The point of a location is geocoded from an address or typed in the add
  // action; the Configuration screen holds neither, so a Save can never move a
  // location under the integration's feet.
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(!keys.includes('latitude') && !keys.includes('longitude'));
});

test('the address form explains the postal-code trap', () => {
  // A postal code covers several communes, and one commune can span several
  // restriction zones — which is exactly when VigiEau refuses to answer.
  const address = (action('rechercher_adresse').fields ?? []).find((f) => f.key === 'adresse');
  assert.match(address.description.fr, /code postal/);
  assert.match(address.description.en, /postal code/);
});

test('the intro comes before the settings it explains', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(
    keys.indexOf('intro') < keys.indexOf('profil'),
    'the note is useless once the user has already scrolled past it',
  );
  assert.ok(
    keys.indexOf('intro') < keys.indexOf('settings_section'),
    'what VigiEau is comes before the settings',
  );
});

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { DEFAULT_CONFIG, DETAIL_FIELDS, PROFILES } from '../src/config.js';
import { LOCATIONS_KEY, MAX_LOCATIONS, SELECTED_KEY } from '../src/locations.js';
import { createLocationEditor, SUMMARY_FIELD } from '../src/locationEditor.js';

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
    getConfig: () => ({ locations: [], selectedId: '' }),
    setConfig: async () => {},
    onLocationsChanged: async () => {},
  }).actions,
);

// The config fields that MIRROR the selected location instead of storing a
// setting of their own: the integration writes them, the user edits them, and
// the edit goes back into the location list. They have no place in
// DEFAULT_CONFIG — there is no such thing as a default address.
const MIRROR_FIELDS = [SUMMARY_FIELD, ...DETAIL_FIELDS];

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
// The locations are a list the user builds at runtime. A config_schema is a
// fixed set of fields with no repeatable one, so the list cannot be a form
// field: it lives under off-schema keys, and one dropdown points the mirror
// fields at the entry the user wants to look at.

test('neither the list nor the selection is a config_schema field', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  for (const key of [LOCATIONS_KEY, SELECTED_KEY]) {
    assert.ok(
      !keys.includes(key),
      `"${key}" is free internal storage of the integration; declaring it would 422 every save`,
    );
  }
});

test('ONE dropdown selects the location, and it offers positions', () => {
  const field = (action('selectionner_lieu').fields ?? []).find((f) => f.key === 'lieu');
  assert.ok(field, 'the whole point of the screen is that single dropdown');
  assert.equal(field.type, 'select');
  assert.equal(field.required, true);
  // Static options, because that is all a manifest can hold: they are
  // POSITIONS in the list, and the `lieux` field is what maps a position to a
  // name. One option per location the integration accepts, no more, no less.
  assert.deepEqual(
    field.options.map((option) => option.value),
    Array.from({ length: MAX_LOCATIONS }, (_, index) => String(index + 1)),
    'the dropdown and MAX_LOCATIONS must not drift apart',
  );
});

test('it is the ONLY dropdown that designates a location', () => {
  // What this rewrite is about: four actions each carrying their own location
  // picker is what the previous attempt did, and it made the screen unusable.
  const pickers = allFields().filter((f) => f.key === 'lieu');
  assert.equal(pickers.length, 1, 'a second location picker means a second thing to keep in sync');
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

test('adding a location only ever asks for an address', () => {
  const add = action('rechercher_adresse');
  assert.ok(add, 'adding a location has not changed: type an address, it is geocoded');
  assert.deepEqual(
    (add.fields ?? []).map((f) => f.key),
    ['nom', 'adresse'],
  );
  assert.equal(add.fields.find((f) => f.key === 'adresse').required, true);
  assert.notEqual(
    add.fields.find((f) => f.key === 'nom').required,
    true,
    'an unnamed location is named after its town',
  );
});

test('deleting takes a confirmation and nothing else', () => {
  // It works on the SELECTED location — no picker of its own — so the only
  // thing standing between a stray click and a lost location is the checkbox.
  const remove = action('supprimer_lieu');
  assert.deepEqual(
    (remove.fields ?? []).map((f) => f.key),
    ['confirmation'],
  );
  assert.equal(remove.fields[0].type, 'boolean');
  assert.equal(remove.fields[0].default, false, 'never armed by default');
});

test('the query actions take no field at all', () => {
  // They report on every watched location, so there is nothing to ask.
  for (const key of ['test_vigieau', 'show_restrictions']) {
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

test('the fields mirroring the selected location store no setting of their own', () => {
  for (const key of MIRROR_FIELDS) {
    const field = configField(key);
    assert.ok(field, `"${key}" is written by the integration and must exist in the schema`);
    assert.equal(field.type, 'string', `"${key}" holds whatever the user typed, verbatim`);
    assert.notEqual(field.required, true, 'they are empty until a location is added');
    assert.equal(field.default, '', 'an empty mirror, never a location made up out of nowhere');
    assert.ok(
      !(key in DEFAULT_CONFIG),
      `"${key}" mirrors a location: there is no default address to fall back on`,
    );
  }
});

test('the global settings keep their defaults in DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section' || MIRROR_FIELDS.includes(field.key)) {
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

test('the coordinates are text fields, so a typed dot survives the browser', () => {
  // A `number` field is an <input type="number">, whose value the browser
  // sanitizes against ITS OWN locale: a French browser turns "48.8566" into an
  // empty string and the front then drops the key from the payload it sends.
  // The range that `min`/`max` used to enforce is checked in src/coordinates.js.
  const coordinates = allFields().filter((f) => ['latitude', 'longitude'].includes(f.key));
  assert.ok(coordinates.length > 0, 'typing the coordinates by hand is still possible');
  for (const field of coordinates) {
    assert.equal(field.type, 'string', `"${field.key}" must accept both decimal separators`);
    assert.equal(field.min, undefined, 'min/max are number-only in the store schema');
    assert.equal(field.max, undefined, 'min/max are number-only in the store schema');
  }
});

test('the coordinate examples use the separator of the language they are shown in', () => {
  // The example is the first thing the user copies: showing "48.8566" to a
  // French user is telling them to type the separator their own browser used
  // to refuse.
  const separators = { fr: ',', en: '.' };
  const coordinates = allFields().filter((f) => ['latitude', 'longitude'].includes(f.key));
  for (const field of coordinates) {
    for (const [language, separator] of Object.entries(separators)) {
      assert.ok(field.placeholder?.[language], `"${field.key}": no ${language} placeholder`);
      assert.equal(
        field.placeholder[language].replace(/\d/g, ''),
        separator,
        `"${field.key}": the ${language} example must use "${separator}"`,
      );
    }
  }
});

test('the configuration screen explains the postal-code trap', () => {
  const address = configField('address_label');
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
    keys.indexOf(SUMMARY_FIELD) < keys.indexOf('location_name'),
    'the list of locations has to be read before the fields that mirror one of them',
  );
});

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

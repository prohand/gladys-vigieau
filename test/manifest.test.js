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
import { LOCATIONS_KEY } from '../src/locations.js';
import { createLocationActions } from '../src/locationActions.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Actions registered outside the blueprints, in index.js: the ones that EDIT
// the location list write the configuration back and re-publish the catalog,
// which is not a device's business. Read off the factory rather than listed by
// hand, so adding one there cannot silently skip the manifest.
const REGISTRY_LEVEL_ACTIONS = Object.keys(
  createLocationActions({
    getConfig: () => ({}),
    saveLocations: async () => {},
  }),
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
// field: it lives under the off-schema `locations` key and is edited through
// these actions, which designate a location by its NAME.

test('the location list is NOT a config_schema field', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(
    !keys.includes(LOCATIONS_KEY),
    'an off-schema key is free internal storage; declaring it would 422 every save',
  );
});

test('adding a location takes a name and a way to locate it', () => {
  const add = action('ajouter_lieu');
  assert.ok(add, 'the locations are added by an action, not by hand');
  assert.deepEqual(
    (add.fields ?? []).map((f) => f.key),
    ['nom', 'adresse', 'latitude', 'longitude'],
  );
  assert.equal(add.fields[0].required, true, 'a device cannot be named after nothing');
  for (const key of ['adresse', 'latitude', 'longitude']) {
    const field = add.fields.find((f) => f.key === key);
    assert.notEqual(field.required, true, 'an address OR a pair of coordinates, never both');
  }
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
  // démarrée." A location is designated by its name instead.
  for (const field of allFields()) {
    assert.equal(
      field.source,
      undefined,
      `"${field.key}": no released Gladys can validate a dynamic source`,
    );
  }
});

test('editing and deleting a location name the location they act on', () => {
  for (const key of ['modifier_lieu', 'supprimer_lieu']) {
    const field = (action(key).fields ?? []).find((f) => f.key === 'lieu');
    assert.ok(field, `"${key}" needs to know which location it acts on`);
    assert.equal(field.type, 'string', 'a typed name works on every Gladys version');
    assert.equal(field.required, true, 'these two edit exactly one location');
    assert.equal(field.default, undefined, 'a default would edit a location by surprise');
  }
});

test('a location can be deleted before its device has ever been created', () => {
  // A location lives in the integration's configuration, not in Gladys: the
  // one added by mistake, whose device was never created, is named like any
  // other and removable like any other.
  const remove = action('supprimer_lieu');
  assert.deepEqual(
    (remove.fields ?? []).map((f) => f.key),
    ['lieu'],
    'nothing else is needed to designate it',
  );
});

test('the query actions can be narrowed down to one location', () => {
  for (const key of ['test_vigieau', 'show_restrictions']) {
    const field = (action(key).fields ?? []).find((f) => f.key === 'lieu');
    assert.ok(field, `"${key}" should be targetable`);
    assert.equal(field.type, 'string');
    assert.notEqual(field.required, true, 'left empty, they cover every location');
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

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('every stored config field has a default in DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG is missing "${field.key}"`);
  }
});

test('the profile select offers exactly the profiles VigiEau accepts', () => {
  const field = manifest.config_schema.find((f) => f.key === 'profil');
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
    assert.equal(field.default, undefined, 'a default coordinate would silently watch Paris');
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
  const help = manifest.config_schema.find((f) => f.key === 'address_help');
  assert.ok(help, 'a section explains what a location is');
  assert.equal(help.type, 'section');
  assert.ok(help.links?.length >= 1);
  assert.match(help.description.fr, /code postal/);
  assert.match(help.description.en, /postal code/);
});

test('the help section comes before the settings it explains', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(
    keys.indexOf('address_help') < keys.indexOf('profil'),
    'the note is useless once the user has already scrolled past it',
  );
});

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

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

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Actions registered outside the blueprints, in index.js: the commune search
// writes the configuration back and re-publishes the catalog, which is not a
// device's business.
const REGISTRY_LEVEL_ACTIONS = ['rechercher_commune'];

test('every manifest action has a registered handler', () => {
  const handled = new Set([
    ...DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {})),
    ...REGISTRY_LEVEL_ACTIONS,
  ]);
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
  }
});

test('every registered handler is declared in the manifest', () => {
  const declared = new Set((manifest.actions ?? []).map((action) => action.key));
  for (const key of [
    ...DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {})),
    ...REGISTRY_LEVEL_ACTIONS,
  ]) {
    assert.ok(declared.has(key), `action "${key}" is implemented but not declared`);
  }
});

test('the commune search action carries the form it needs', () => {
  const action = (manifest.actions ?? []).find((a) => a.key === 'rechercher_commune');
  assert.ok(action, 'the INSEE code is filled in by an action, not by hand');
  const keys = (action.fields ?? []).map((f) => f.key);
  assert.deepEqual(keys, ['nom', 'code_postal']);
  for (const field of action.fields) {
    assert.equal(field.type, 'string', 'both criteria are free text');
    assert.notEqual(field.required, true, 'either criterion is enough on its own');
  }
});

test('action fields obey the same rules as the config fields', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.ok(ALLOWED_FIELD_TYPES.includes(field.type), `bad type on "${field.key}"`);
      assert.ok(field.label?.en && field.label?.fr, `"${field.key}" needs both labels`);
      if (field.placeholder !== undefined) {
        assert.equal(
          typeof field.placeholder,
          'object',
          `"${field.key}": placeholder is an object`,
        );
      }
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
    ...manifest.config_schema.flatMap((f) => [
      f.label,
      f.description,
      ...(f.options ?? []).map((o) => o.label),
      ...(f.links ?? []).map((l) => l.label),
    ]),
    ...(manifest.actions ?? []).map((a) => a.label),
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

test('every config field uses a widget type the store accepts', () => {
  for (const field of manifest.config_schema) {
    assert.ok(
      ALLOWED_FIELD_TYPES.includes(field.type),
      `field "${field.key}" has the unsupported type "${field.type}"`,
    );
  }
});

test('placeholders are multi-language objects, never bare strings', () => {
  for (const field of manifest.config_schema) {
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

test('the catalog description stays within the 100-character store limit', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10, `description.${language} is too short`);
    assert.ok(text.length <= 100, `description.${language} is ${text.length} characters, max 100`);
  }
});

test('the INSEE code is mandatory and the coordinates are not', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.equal(field('commune').required, true, 'the INSEE code is the mandatory input');
  assert.notEqual(field('latitude').required, true, 'the coordinates only refine the commune');
  assert.notEqual(field('longitude').required, true);
});

test('the optional coordinates ship no default that would override the commune', () => {
  // A default latitude/longitude would make every install query a point
  // instead of the commune the user carefully filled in.
  for (const key of ['latitude', 'longitude']) {
    const field = manifest.config_schema.find((f) => f.key === key);
    assert.equal(field.default, undefined, `"${key}" must start empty`);
    assert.equal(DEFAULT_CONFIG[key], null, `DEFAULT_CONFIG.${key} means "left empty"`);
  }
});

test('the configuration screen explains where to find the INSEE code', () => {
  const help = manifest.config_schema.find((f) => f.key === 'insee_help');
  assert.ok(help, 'a section walks the user through finding their INSEE code');
  assert.equal(help.type, 'section');
  assert.ok(help.links?.length >= 1, 'the note carries at least one lookup link');
  // The single most common mistake is using the postal code instead.
  assert.match(help.description.fr, /code postal/);
  assert.match(help.description.en, /postal code/);
});

test('the help section comes before the field it explains', () => {
  const keys = manifest.config_schema.map((f) => f.key);
  assert.ok(
    keys.indexOf('insee_help') < keys.indexOf('commune'),
    'the note is useless once the user has already filled the field in',
  );
});

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

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

test('every manifest action has a registered handler', () => {
  const handled = new Set(DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {})));
  for (const action of manifest.actions ?? []) {
    assert.ok(handled.has(action.key), `manifest action "${action.key}" has no handler`);
  }
});

test('every registered handler is declared in the manifest', () => {
  const declared = new Set((manifest.actions ?? []).map((action) => action.key));
  for (const bp of DEVICE_BLUEPRINTS) {
    for (const key of Object.keys(bp.actions ?? {})) {
      assert.ok(declared.has(key), `action "${key}" is implemented but not declared`);
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

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

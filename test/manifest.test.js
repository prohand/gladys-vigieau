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
import { WIDGET, WIDGET_ACTION, createWidgets } from '../src/widgets.js';
import { SCENE_ACTION, createSceneActions } from '../src/sceneActions.js';
import { SCENE_TRIGGER } from '../src/readings.js';
import { SEVERITY_CODES } from '../src/vigieau.js';

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

// The widgets and scene actions registered in index.js, read off their
// factories for the same reason.
const WIDGET_HANDLERS = createWidgets({});
const SCENE_ACTION_HANDLERS = createSceneActions({});

/**
 * Every field of the Configuration screen: config fields and action fields.
 * The widget settings and the scene fields are checked on their own, below —
 * they live on other screens, under other rules.
 */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
  ];
}

/** The fields of the dashboard and scene editor: widget settings, scene fields. */
function capabilityFields() {
  return [
    ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((trigger) => trigger.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((declared) => declared.fields ?? []),
  ];
}

/** The minimum Gladys version the manifest claims, as `[major, minor, patch]`. */
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

/** Whether the minimum claimed version is at least `major.minor.patch`. */
function requiresAtLeast(major, minor, patch = 0) {
  const [ma, mi, pa] = minGladysVersion();
  return ma !== major ? ma > major : mi !== minor ? mi > minor : pa >= patch;
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

test('the three reporting actions announce the SAME entry format', () => {
  // They answer about the same list of locations, under the same numbers: the
  // listing, the connection test and the restrictions all print
  // "• number. name — detail" (see locationLine in src/locations.js), and each
  // description says so rather than describing a layout of its own.
  for (const key of ['afficher_lieux', 'test_vigieau', 'show_restrictions']) {
    const reporting = action(key);
    assert.match(reporting.description.fr, /•/, `${key} documents the entry marker`);
    assert.match(reporting.description.fr, /numéro/i, `${key} documents the entry number`);
    assert.match(reporting.description.en, /•/);
  }
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

test('a dynamic source only ever picks a CREATED device, never a location', () => {
  // `source: "devices"` lists the integration's devices the user has CREATED —
  // validated server-side since Gladys 5.1.0 (getDynamicOptions), which up to
  // 4.84.4 refused every value with a 422 and broke every action carrying one.
  //
  // It is right where a device is what the user means: a widget shows one, a
  // scene reads one. It is wrong on the Configuration screen, where the delete
  // dropdown designates a LOCATION — one that may never have been added from
  // the Discovery tab, and would then simply be missing from the list. That
  // one keeps its positions (see locationAtPosition).
  for (const field of allFields()) {
    assert.equal(field.source, undefined, `"${field.key}": a location is not a created device`);
  }
  assert.ok(requiresAtLeast(5, 1), 'the source is only validated from Gladys 5.1.0 on');
  for (const field of capabilityFields().filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.key, 'lieu', 'one name for one meaning, everywhere');
    assert.equal(field.options, undefined, 'options and source are mutually exclusive');
    assert.equal(field.default, undefined, 'a device list has no default');
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

test('the manifest asks for the house coordinates the import button reads', () => {
  // `GET /house` is an authorization contract, not just an endpoint: it is shown
  // on the install screen and enforced server-side, so without this line the
  // core answers 403 and "Ajouter mes maisons Gladys" can only apologize.
  assert.equal(manifest.location, true, 'importer_maisons reads GET /house');
  assert.ok(
    (manifest.actions ?? []).some((declared) => declared.key === 'importer_maisons'),
    'declaring the permission without the button asks the user for nothing in return',
  );
});

test('the compatibility range covers the version that opened GET /house', () => {
  // House coordinates landed in Gladys 4.85.0, and the manifest field asking
  // for them with it: the range is what keeps this version away from the
  // instances that cannot serve the import button.
  assert.match(manifest.gladys_version, /^>=\d+\.\d+\.\d+$/);
  assert.ok(requiresAtLeast(4, 85));
});

test('the catalog shelf is declared, and requires Gladys >= 4.86.0 to be', () => {
  // The vocabulary itself is the store's business — an unknown key is dropped
  // there with a warning, never a rejection, so a manifest can name a shelf a
  // running instance does not know yet. What has to hold HERE is the coupling
  // rule: an older core rejects any manifest field it does not know, so
  // declaring `categories` at all forbids claiming compatibility below the
  // first release that accepts it. VigiEau publishes drought levels and water
  // restrictions: `environment`, which is also the shelf the store's fallback
  // mapping already files this integration under.
  assert.deepEqual(manifest.categories, ['environment']);
  assert.ok(
    manifest.categories.length >= 1 && manifest.categories.length <= 3,
    'the store schema takes 1 to 3 unique keys',
  );
  assert.ok(
    requiresAtLeast(4, 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('the import button sits right under the button that adds one location', () => {
  // Both add locations, and this one is the shortcut for the other: separating
  // them by the reports would hide it under the fold of the add form.
  const keys = (manifest.actions ?? []).map((a) => a.key);
  assert.equal(keys[keys.indexOf('rechercher_adresse') + 1], 'importer_maisons');
});

test('the import button asks for nothing before it runs', () => {
  // Everything it needs is in Gladys already — that is the whole point of a
  // one-click import.
  assert.deepEqual(action('importer_maisons').fields ?? [], []);
});

test('the manifest declares the cloud transport only', () => {
  // VigiEau is a public HTTP API: there is no local channel, so Gladys must not
  // show the "Prefer the local connection" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

// --- Widgets, scene triggers and scene actions (Gladys >= 5.1.0) -------------
// Three capability fields the store AND an older core refuse below 5.1.0: an
// older core rejects any manifest field it does not know, and the store
// indexer enforces the floor per field.

test('the capability fields require Gladys >= 5.1.0', () => {
  for (const field of ['widgets', 'scene_triggers', 'scene_actions']) {
    assert.ok(manifest[field]?.length > 0, `${field} is declared`);
  }
  assert.ok(
    requiresAtLeast(5, 1),
    `widgets and scenes require gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every declared widget has a handler, and every handler is declared', () => {
  assert.deepEqual(
    (manifest.widgets ?? []).map((widget) => widget.key).sort(),
    Object.keys(WIDGET_HANDLERS).sort(),
  );
  assert.deepEqual(Object.values(WIDGET).sort(), Object.keys(WIDGET_HANDLERS).sort());
  for (const handler of Object.values(WIDGET_HANDLERS)) {
    assert.equal(typeof handler.get, 'function');
    assert.equal(typeof handler.action, 'function', `the "${WIDGET_ACTION.REFRESH}" button`);
  }
});

test('the widgets follow the store bounds', () => {
  for (const widget of manifest.widgets) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    assert.match(widget.icon, /^[a-z0-9-]{1,40}$/, 'a Feather icon name');
    for (const language of ['en', 'fr']) {
      const label = widget.label[language];
      assert.ok(label.length >= 3 && label.length <= 30, `${widget.key} label.${language}`);
      assert.ok(
        widget.description[language].length <= 100,
        `${widget.key} description.${language}`,
      );
    }
  }
});

test('the location widget asks which device, the overview asks nothing', () => {
  const byKey = Object.fromEntries(manifest.widgets.map((widget) => [widget.key, widget]));
  assert.deepEqual(
    byKey[WIDGET.LOCATION].settings.map((field) => [field.key, field.source, field.required]),
    [['lieu', 'devices', true]],
  );
  assert.equal((byKey[WIDGET.OVERVIEW].settings ?? []).length, 0, 'it shows every location');
});

test('every scene action has a handler, and every handler is declared', () => {
  assert.deepEqual(
    (manifest.scene_actions ?? []).map((declared) => declared.key).sort(),
    Object.keys(SCENE_ACTION_HANDLERS).sort(),
  );
  assert.deepEqual(Object.values(SCENE_ACTION).sort(), Object.keys(SCENE_ACTION_HANDLERS).sort());
});

test('every scene trigger the code fires is declared, and nothing else is', () => {
  assert.deepEqual(
    (manifest.scene_triggers ?? []).map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGER).sort(),
  );
});

test('a scene trigger filter can always say "any"', () => {
  // A boolean has no empty state, which is why the core refuses it as a
  // filter; and a REQUIRED filter would force every scene to pick one value.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(['string', 'number', 'select', 'multi_select'].includes(field.type), field.key);
      assert.notEqual(field.required, true, `${trigger.key}.${field.key}: empty must match any`);
    }
  }
});

test('the level filter offers exactly the VigiEau codes the events carry', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGER.LEVEL_CHANGED);
  const level = trigger.fields.find((field) => field.key === 'niveau');
  assert.equal(level.type, 'multi_select');
  assert.deepEqual(
    level.options.map((option) => option.value),
    SEVERITY_CODES,
    'crise included: the reason this filter exists next to the device trigger',
  );
});

test('the scene declarations are translated and their variables are scalars', () => {
  const declarations = [...manifest.scene_triggers, ...manifest.scene_actions];
  for (const declared of declarations) {
    for (const text of [declared.label, declared.description]) {
      assert.ok(text.en && text.fr, `${declared.key} needs both languages`);
    }
    assert.match(declared.key, /^[a-z0-9_]{1,40}$/);
    for (const variable of [...(declared.variables ?? []), ...(declared.outputs ?? [])]) {
      assert.ok(['string', 'number', 'boolean'].includes(variable.type), variable.key);
      assert.ok(variable.label.en && variable.label.fr, `${declared.key}.${variable.key}`);
    }
    for (const field of declared.fields ?? []) {
      assert.ok(field.label.en && field.label.fr, `${declared.key}.${field.key}`);
    }
  }
  for (const declared of manifest.scene_actions) {
    assert.ok(declared.timeout_seconds >= 5 && declared.timeout_seconds <= 120);
  }
});

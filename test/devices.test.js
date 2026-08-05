import { test, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from '../src/devices/index.js';
import { FEATURE, MIN_REFRESH_SECONDS } from '../src/devices/droughtZone.js';
import { deviceIds, forgetAdoptedDevices } from '../src/devices/identity.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys, zonesFixture } from './helpers/fakeGladys.js';

/** A configuration watching the given locations. */
function configWith(...locations) {
  return normalizeConfig({ locations });
}

const MAISON = { id: 'loc-maison', name: 'Maison', latitude: '48.8566', longitude: '2.3522' };
const JARDIN = { id: 'loc-jardin', name: 'Jardin', latitude: '45.764', longitude: '4.8357' };

const config = configWith(MAISON);
const realFetch = globalThis.fetch;

beforeEach(() => {
  // Adoptions are module state: a leftover would rename the ids under test.
  forgetAdoptedDevices();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer every VigiEau call with the given payload / status. */
function stubVigieau(payload, status = 200) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

/** Answer per location, keyed by the `lat` of the request. */
function stubVigieauByLatitude(byLatitude) {
  globalThis.fetch = async (url) => {
    const lat = new URL(url).searchParams.get('lat');
    const entry = byLatitude[lat];
    if (entry === undefined) {
      throw new Error(`no stub for lat=${lat}`);
    }
    return {
      ok: (entry.status ?? 200) < 300,
      status: entry.status ?? 200,
      json: async () => entry.payload,
    };
  };
}

const droughtZone = DEVICE_BLUEPRINTS.find((bp) => bp.key === 'drought-zone');

test('every blueprint exposes the required shape', () => {
  for (const bp of DEVICE_BLUEPRINTS) {
    assert.equal(typeof bp.key, 'string', 'key must be a string');
    assert.equal(typeof bp.deviceExternalIds, 'function', 'deviceExternalIds must be a function');
    assert.equal(typeof bp.buildDevices, 'function', 'buildDevices must be a function');
  }
});

test('buildDiscoveredDevices returns one payload per location', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, configWith(MAISON, JARDIN));
  assert.equal(devices.length, 2);
  for (const device of devices) {
    assert.equal(typeof device.name, 'string');
    assert.ok(device.external_id, 'each device has an external_id');
    assert.ok(Array.isArray(device.features) && device.features.length > 0);
  }
});

test('a configuration with no location publishes an EMPTY catalog', () => {
  // Empty, and it must actually be published: `setDiscoveredDevices` REPLACES
  // the previous list, so this array is the only thing that takes the device of
  // the last deleted location off the Discovery screen. Skipping the publish
  // here — which index.js used to do — left it on offer until a restart.
  const gladys = createFakeGladys();
  assert.deepEqual(buildDiscoveredDevices(gladys, normalizeConfig()), []);
});

test('a deleted location is no longer in the catalog that replaces the old one', () => {
  const gladys = createFakeGladys();
  const remaining = buildDiscoveredDevices(gladys, configWith(MAISON));
  assert.equal(remaining.length, 1);
  assert.match(remaining[0].name, /Maison/);
  assert.ok(
    !remaining.some((device) => device.external_id.includes('loc-jardin')),
    'the Discovery screen stops offering it as soon as this list is published',
  );
});

test('a location without usable coordinates publishes no device', () => {
  // A device pinned to an empty location is worse than no device at all.
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(
    gladys,
    configWith(MAISON, { id: 'loc-broken', name: 'Cassé', latitude: 'nord' }),
  );
  assert.equal(devices.length, 1);
  assert.match(devices[0].name, /Maison/);
});

test('device external_ids are unique across the catalog', () => {
  const gladys = createFakeGladys();
  const ids = buildDiscoveredDevices(gladys, configWith(MAISON, JARDIN)).map((d) => d.external_id);
  assert.equal(new Set(ids).size, ids.length, 'no two devices may share an external_id');
});

test('feature external_ids are unique across the whole catalog', () => {
  // Two locations sharing a feature id would overwrite each other's states.
  const gladys = createFakeGladys();
  const ids = buildDiscoveredDevices(gladys, configWith(MAISON, JARDIN)).flatMap((device) =>
    device.features.map((f) => f.external_id),
  );
  assert.equal(new Set(ids).size, ids.length);
});

test('each device name carries its own location', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, configWith(MAISON, JARDIN));
  assert.match(devices[0].name, /Maison/);
  assert.match(devices[1].name, /Jardin/);
});

test('the device declares no poll_frequency', () => {
  // Gladys only accepts a fixed enum of intervals, in MILLISECONDS, whose
  // slowest value is one minute — anything else is rejected with
  // "invalid poll frequency" and the whole batch is refused. A drought decree
  // changes once a day, so the integration runs its own timer instead.
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(
    gladys,
    normalizeConfig({ locations: [MAISON], poll_frequency: 7200 }),
  );
  assert.equal(device.poll_frequency, undefined);
});

test('every feature declares a numeric min and max', () => {
  // The core columns are NOT NULL with no default: a feature without min/max
  // is refused when the user adds the device from the Discovery screen.
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  for (const feature of device.features) {
    assert.equal(typeof feature.min, 'number', `${feature.name}: min must be a number`);
    assert.equal(typeof feature.max, 'number', `${feature.name}: max must be a number`);
    assert.ok(feature.max >= feature.min, `${feature.name}: max must not be below min`);
  }
});

test('every feature carries a name, a category and a type', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  for (const feature of device.features) {
    assert.ok(feature.name, 'the core requires a non-empty name');
    assert.ok(feature.category, 'the core validates the category against its own list');
    assert.ok(feature.type);
    assert.equal(typeof feature.read_only, 'boolean');
    assert.equal(typeof feature.has_feedback, 'boolean');
    assert.equal(typeof feature.keep_history, 'boolean');
  }
});

test('findBlueprintByDevice routes an external_id back to its owner blueprint', () => {
  const gladys = createFakeGladys();
  const twoLocations = configWith(MAISON, JARDIN);
  for (const bp of DEVICE_BLUEPRINTS) {
    for (const external_id of bp.deviceExternalIds(gladys, twoLocations)) {
      assert.equal(findBlueprintByDevice(gladys, { external_id }, twoLocations), bp);
    }
  }
});

test('a device keeps its external_id when its location moves', () => {
  // The bug this pins: the id used to carry the coordinates, so a new address
  // meant a NEW device — the old one had to be deleted, history included.
  const gladys = createFakeGladys();
  const moved = configWith({ ...MAISON, latitude: '45.764', longitude: '4.8357' });
  const [before] = buildDiscoveredDevices(gladys, config);
  const [after] = buildDiscoveredDevices(gladys, moved);

  assert.equal(after.external_id, before.external_id, 'the same device follows the address');
  assert.deepEqual(
    after.features.map((f) => f.external_id),
    before.features.map((f) => f.external_id),
    'and so do its features, or their history would restart',
  );
  // The refresh of the device created before the move still reaches us.
  assert.equal(
    findBlueprintByDevice(gladys, { external_id: before.external_id }, moved),
    droughtZone,
  );
});

test('a device keeps its external_id when its location is renamed', () => {
  const gladys = createFakeGladys();
  const [before] = buildDiscoveredDevices(gladys, config);
  const [after] = buildDiscoveredDevices(gladys, configWith({ ...MAISON, name: 'Résidence' }));
  assert.equal(after.external_id, before.external_id);
  assert.match(after.name, /Résidence/, 'only the displayed name follows');
});

test('findBlueprintByDevice returns undefined for a device that is not ours', () => {
  const gladys = createFakeGladys();
  // A leftover published by a version that keyed the id on the coordinates.
  const staleId = gladys.externalIds('drought-zone', 'latlon-45.7640_4.8357').device;
  assert.equal(findBlueprintByDevice(gladys, { external_id: staleId }, config), undefined);
});

test('the device of a deleted location stops being ours', () => {
  const gladys = createFakeGladys();
  const [jardinId] = droughtZone.deviceExternalIds(gladys, configWith(JARDIN));
  // The user removed "Jardin": its device must no longer be polled.
  assert.equal(findBlueprintByDevice(gladys, { external_id: jardinId }, config), undefined);
});

test('every severity feature is a read-only 0-3 risk index', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const severities = device.features.filter((f) => f.category === DEVICE_FEATURE_CATEGORIES.RISK);
  assert.equal(severities.length, 4, 'overall level + one per water type');
  for (const feature of severities) {
    assert.equal(feature.type, DEVICE_FEATURE_TYPES.RISK.INTEGER);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 3, 'Gladys only labels 0-3 on a risk feature');
    assert.equal(feature.read_only, true);
  }
});

test('the device carries the level as text alongside the numbers', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const text = device.features.find((f) => f.external_id.endsWith(FEATURE.LEVEL_TEXT));
  assert.equal(text.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(text.type, DEVICE_FEATURE_TYPES.TEXT.TEXT);
  assert.equal(text.read_only, true);
});

test('the device carries exactly five features', () => {
  // Four severity levels + the text label. A binary "restrictions in force"
  // used to sit here too; it only ever meant "level >= 1", which a scene can
  // test on the numeric level directly, and the core rendered it as the
  // baffling "Etat de l'entrée".
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  assert.equal(device.features.length, 5);
  assert.equal(
    device.features.filter((f) => f.type === DEVICE_FEATURE_TYPES.SENSOR.BINARY).length,
    0,
    'no binary feature is published any more',
  );
});

// --- Polling -----------------------------------------------------------------

/** The external_id of the device published for a location. */
function deviceIdOf(gladys, location) {
  return deviceIds(gladys, 'drought-zone', location.id).device;
}

test('onPoll publishes the overall level, the text and every water type', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  await droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON));

  const byFeature = new Map(gladys.published.map((p) => [p.featureExternalId, p]));
  const ids = deviceIds(gladys, 'drought-zone', MAISON.id);

  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL)).state, 3);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_SUP)).state, 2);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_SOU)).state, 3);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_AEP)).state, 1);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_TEXT)).text, 'Alerte renforcée');
});

test('onPoll only publishes the states of the device it was asked about', async () => {
  const gladys = createFakeGladys();
  const twoLocations = configWith(MAISON, JARDIN);
  stubVigieau(zonesFixture());
  await droughtZone.onPoll(gladys, twoLocations, deviceIdOf(gladys, JARDIN));

  const jardin = deviceIdOf(gladys, JARDIN);
  for (const { featureExternalId } of gladys.published) {
    assert.ok(featureExternalId.startsWith(jardin), `${featureExternalId} is not Jardin's`);
  }
});

test('onPoll queries the coordinates of the location it was asked about', async () => {
  const gladys = createFakeGladys();
  const twoLocations = configWith(MAISON, JARDIN);
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(new URL(url).searchParams.get('lat'));
    return { ok: true, status: 200, json: async () => zonesFixture() };
  };
  await droughtZone.onPoll(gladys, twoLocations, deviceIdOf(gladys, JARDIN));
  assert.deepEqual(seen, ['45.764'], 'the other location must not be queried');
});

test('onPoll refuses a device no location watches', async () => {
  const gladys = createFakeGladys();
  await assert.rejects(
    () => droughtZone.onPoll(gladys, config, 'drought-zone:loc-gone'),
    /No location watches/,
  );
});

test('a crise is published as 3, never as a value Gladys renders "Inconnu"', async () => {
  const gladys = createFakeGladys();
  stubVigieau([{ type: 'SUP', niveauGravite: 'crise' }]);
  await droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON));

  const ids = deviceIds(gladys, 'drought-zone', MAISON.id);
  const byFeature = new Map(gladys.published.map((p) => [p.featureExternalId, p]));
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL)).state, 3);
  // The exact wording survives where it matters.
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_TEXT)).text, 'Crise');
});

test('onPoll publishes a clear "no restriction" when nothing is in force', async () => {
  const gladys = createFakeGladys();
  stubVigieau([], 404);
  await droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON));

  const ids = deviceIds(gladys, 'drought-zone', MAISON.id);
  const byFeature = new Map(gladys.published.map((p) => [p.featureExternalId, p]));
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL)).state, 0);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_TEXT)).text, 'Pas de restriction');
});

test('onPoll leaves the level untouched rather than publishing a false all-clear', async () => {
  const gladys = createFakeGladys();
  // The surface-water zone exists but carries a severity we cannot read: the
  // overall level is unknown, so it must NOT be published as "no restriction".
  stubVigieau([{ type: 'SUP', niveauGravite: 'niveau_martien' }]);
  await droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON));

  const ids = deviceIds(gladys, 'drought-zone', MAISON.id);
  const publishedIds = gladys.published.map((p) => p.featureExternalId);
  assert.ok(!publishedIds.includes(ids.feature(FEATURE.LEVEL)), 'a stale value beats a wrong one');
  assert.ok(!publishedIds.includes(ids.feature(FEATURE.LEVEL_SUP)));
  // The water types genuinely not covered by any zone are still reported.
  assert.ok(publishedIds.includes(ids.feature(FEATURE.LEVEL_SOU)));
  assert.ok(publishedIds.includes(ids.feature(FEATURE.LEVEL_AEP)));
});

test('onPoll fails loudly when no severity at all could be read', async () => {
  const gladys = createFakeGladys();
  stubVigieau([
    { type: 'SUP', niveauGravite: 'niveau_martien' },
    { type: 'SOU', niveauGravite: 'niveau_martien' },
    { type: 'AEP', niveauGravite: 'niveau_martien' },
  ]);
  await assert.rejects(
    () => droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON)),
    /no severity we could understand/,
  );
  assert.equal(gladys.published.length, 0);
});

test('onPoll propagates an API outage so Gladys keeps the last known values', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 503);
  await assert.rejects(
    () => droughtZone.onPoll(gladys, config, deviceIdOf(gladys, MAISON)),
    /VigiEau HTTP 503/,
  );
  assert.equal(gladys.published.length, 0);
});

// --- Manifest actions --------------------------------------------------------

test('manifest action keys are unique across blueprints', () => {
  const keys = DEVICE_BLUEPRINTS.flatMap((bp) => Object.keys(bp.actions ?? {}));
  assert.equal(new Set(keys).size, keys.length, 'no two blueprints may register the same action');
});

test('the test_vigieau action returns a multi-language message with the level', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  const message = await droughtZone.actions.test_vigieau(gladys, { fields: {}, config });
  assert.match(message.fr, /Alerte renforcée/);
  assert.match(message.en, /Reinforced alert/);
  assert.match(message.fr, /SOU: 3/);
  assert.match(message.fr, /Maison/);
});

test('test_vigieau covers every location when none is named', async () => {
  const gladys = createFakeGladys();
  stubVigieauByLatitude({
    48.8566: { payload: zonesFixture() },
    45.764: { payload: [{ type: 'SUP', niveauGravite: 'vigilance' }] },
  });
  const message = await droughtZone.actions.test_vigieau(gladys, {
    fields: {},
    config: configWith(MAISON, JARDIN),
  });
  assert.match(message.fr, /Maison/);
  assert.match(message.fr, /Jardin/);
});

test('test_vigieau ignores the selection and reports on every location', async () => {
  const gladys = createFakeGladys();
  const twoLocations = { ...configWith(MAISON, JARDIN), selectedId: 'loc-jardin' };
  stubVigieauByLatitude({
    48.8566: { payload: [{ type: 'SUP', niveauGravite: 'alerte' }] },
    45.764: { payload: [{ type: 'SUP', niveauGravite: 'vigilance' }] },
  });
  const message = await droughtZone.actions.test_vigieau(gladys, {
    fields: {},
    config: twoLocations,
  });
  // "Is VigiEau answering?" is a question about the install, not about one
  // entry of a list: one click has to answer it for every watched location,
  // without the select-then-reload round trip the editing actions need.
  assert.match(message.fr, /Maison/);
  assert.match(message.fr, /Jardin/);
});

test('a location without usable coordinates is left out of the report', async () => {
  const gladys = createFakeGladys();
  stubVigieauByLatitude({ 48.8566: { payload: [{ type: 'SUP', niveauGravite: 'alerte' }] } });
  const message = await droughtZone.actions.test_vigieau(gladys, {
    fields: {},
    config: configWith(MAISON, { id: 'loc-vide', name: 'Chalet' }),
  });
  assert.match(message.fr, /Maison/);
  assert.doesNotMatch(message.fr, /Chalet/, 'nothing to query, nothing to say');
});

test('test_vigieau says so when there is nothing to test yet', async () => {
  const gladys = createFakeGladys();
  const message = await droughtZone.actions.test_vigieau(gladys, {
    fields: {},
    config: normalizeConfig(),
  });
  assert.match(message.fr, /Aucun lieu/);
  assert.match(message.en, /No location/);
});

test('the show_restrictions action lists the restricted usages and the decree', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  const message = await droughtZone.actions.show_restrictions(gladys, { fields: {}, config });
  assert.match(message.fr, /Remplissage des piscines/);
  assert.match(message.fr, /arrete\/4502\.pdf/);
  assert.ok(message.en, 'the message is multi-language');
});

test('the show_restrictions action says so when nothing is restricted', async () => {
  const gladys = createFakeGladys();
  stubVigieau([], 404);
  const message = await droughtZone.actions.show_restrictions(gladys, { fields: {}, config });
  assert.match(message.fr, /aucun usage restreint/i);
  assert.match(message.en, /no restricted usage/i);
});

// --- Self-driven refresh -----------------------------------------------------

/** Let the pending microtasks (and the awaited fetch stub) settle. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('startPolling refreshes straight away, without waiting a full interval', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  const stop = droughtZone.startPolling(gladys, config);
  try {
    await settle();
    assert.ok(gladys.published.length > 0, 'a freshly added device must not stay empty');
    assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  } finally {
    stop();
  }
});

test('a refresh cycle covers every location', async () => {
  const gladys = createFakeGladys();
  stubVigieauByLatitude({
    48.8566: { payload: zonesFixture() },
    45.764: { payload: [{ type: 'SUP', niveauGravite: 'vigilance' }] },
  });
  await droughtZone.refresh(gladys, configWith(MAISON, JARDIN));

  const published = gladys.published.map((p) => p.featureExternalId);
  assert.ok(published.some((id) => id.startsWith(deviceIdOf(gladys, MAISON))));
  assert.ok(published.some((id) => id.startsWith(deviceIdOf(gladys, JARDIN))));
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
});

test('one failing location does not silence the others', async () => {
  // A badly geocoded garden must not stop the house from reporting.
  const gladys = createFakeGladys();
  stubVigieauByLatitude({
    48.8566: { payload: zonesFixture() },
    45.764: { payload: null, status: 503 },
  });
  await droughtZone.refresh(gladys, configWith(MAISON, JARDIN));

  const published = gladys.published.map((p) => p.featureExternalId);
  assert.ok(published.some((id) => id.startsWith(deviceIdOf(gladys, MAISON))));
  const { connected, message } = gladys.connectionStatuses.at(-1);
  assert.equal(connected, false, 'the failure is still reported');
  assert.match(message.fr, /Jardin/, 'and it names the location that failed');
});

test('the status names how many other locations are failing', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 503);
  await droughtZone.refresh(gladys, configWith(MAISON, JARDIN));
  const { message } = gladys.connectionStatuses.at(-1);
  assert.match(message.fr, /\+1 autre/);
  assert.match(message.en, /\+1 other/);
});

test('startPolling stops refreshing once its cleanup is called', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const stop = droughtZone.startPolling(gladys, config);
    await settle();
    const afterFirstRefresh = gladys.published.length;

    mock.timers.tick(config.poll_frequency * 1000);
    await settle();
    assert.ok(gladys.published.length > afterFirstRefresh, 'the timer refreshes again');

    const beforeStop = gladys.published.length;
    stop();
    mock.timers.tick(config.poll_frequency * 10 * 1000);
    await settle();
    assert.equal(gladys.published.length, beforeStop, 'nothing is published after cleanup');
  } finally {
    mock.timers.reset();
  }
});

test('startPolling never refreshes faster than the floor, whatever the config says', () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    // VigiEau is a free public service: an over-eager configuration must not
    // turn every Gladys install into a hammer.
    const stop = droughtZone.startPolling(
      gladys,
      normalizeConfig({ locations: [MAISON], poll_frequency: 1 }),
    );
    const before = gladys.published.length;
    mock.timers.tick(MIN_REFRESH_SECONDS * 1000 - 1);
    assert.equal(gladys.published.length, before, 'no second refresh before the floor');
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('refresh reports success and never throws on an outage', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 503);
  // Called from a timer callback and from onDeviceCreated: a rejection here
  // would become an unhandled rejection and take the container down.
  await droughtZone.refresh(gladys, config);
  assert.equal(gladys.published.length, 0);
  assert.equal(gladys.connectionStatuses.at(-1).connected, false);

  stubVigieau(zonesFixture());
  await droughtZone.refresh(gladys, config);
  assert.ok(gladys.published.length > 0);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
});

test('an ambiguous commune is reported as a fixable configuration gap', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 409);
  await droughtZone.refresh(gladys, config);

  const { connected, message } = gladys.connectionStatuses.at(-1);
  assert.equal(connected, false);
  // "VigiEau HTTP 409" tells nobody what to do; the coordinates do.
  assert.match(message.fr, /adresse plus précise/);
  assert.match(message.en, /more precise address/);
  assert.doesNotMatch(message.fr, /409/);
  assert.match(message.fr, /Maison/, 'and it says WHICH location to fix');
});

test('a VigiEau outage neither kills the timer nor crashes the container', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 503);
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const stop = droughtZone.startPolling(gladys, config);
    await settle();
    // The failure is reported, not thrown: an unhandled rejection would take
    // the whole integration down.
    const status = gladys.connectionStatuses.at(-1);
    assert.equal(status.connected, false);
    assert.match(status.message.fr, /503/);

    // And the next tick still runs, so the sensor recovers on its own.
    stubVigieau(zonesFixture());
    mock.timers.tick(config.poll_frequency * 1000);
    await settle();
    assert.ok(gladys.published.length > 0, 'the timer survived the outage');
    assert.equal(gladys.connectionStatuses.at(-1).connected, true);
    stop();
  } finally {
    mock.timers.reset();
  }
});

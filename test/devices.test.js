import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  DEVICE_BLUEPRINTS,
  buildDiscoveredDevices,
  findBlueprintByDevice,
} from '../src/devices/index.js';
import { FEATURE, MIN_REFRESH_SECONDS } from '../src/devices/droughtZone.js';
import { normalizeConfig } from '../src/config.js';
import { createFakeGladys, zonesFixture } from './helpers/fakeGladys.js';

const config = normalizeConfig({ commune: '75056' });
const realFetch = globalThis.fetch;

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

const droughtZone = DEVICE_BLUEPRINTS.find((bp) => bp.key === 'drought-zone');

test('every blueprint exposes the required shape', () => {
  for (const bp of DEVICE_BLUEPRINTS) {
    assert.equal(typeof bp.key, 'string', 'key must be a string');
    assert.equal(typeof bp.deviceExternalId, 'function', 'deviceExternalId must be a function');
    assert.equal(typeof bp.buildDevice, 'function', 'buildDevice must be a function');
  }
});

test('buildDiscoveredDevices returns one payload per blueprint', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, config);
  assert.equal(devices.length, DEVICE_BLUEPRINTS.length);
  for (const device of devices) {
    assert.equal(typeof device.name, 'string');
    assert.ok(device.external_id, 'each device has an external_id');
    assert.ok(Array.isArray(device.features) && device.features.length > 0);
  }
});

test('device external_ids are unique across the catalog', () => {
  const gladys = createFakeGladys();
  const ids = buildDiscoveredDevices(gladys, config).map((d) => d.external_id);
  assert.equal(new Set(ids).size, ids.length, 'no two devices may share an external_id');
});

test('feature external_ids are unique inside a device', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const ids = device.features.map((f) => f.external_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the device name carries the configured location', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(
    gladys,
    normalizeConfig({ commune: '75056', location_name: 'Jardin' }),
  );
  assert.match(device.name, /Jardin/);
});

test('the device declares no poll_frequency', () => {
  // Gladys only accepts a fixed enum of intervals, in MILLISECONDS, whose
  // slowest value is one minute — anything else is rejected with
  // "invalid poll frequency" and the whole batch is refused. A drought decree
  // changes once a day, so the integration runs its own timer instead.
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(
    gladys,
    normalizeConfig({ commune: '75056', poll_frequency: 7200 }),
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
  for (const bp of DEVICE_BLUEPRINTS) {
    const external_id = bp.deviceExternalId(gladys, config);
    assert.equal(findBlueprintByDevice(gladys, { external_id }, config), bp);
  }
});

test('findBlueprintByDevice returns undefined for a device of another location', () => {
  const gladys = createFakeGladys();
  const otherLocation = normalizeConfig({ commune: '69123' });
  const staleId = droughtZone.deviceExternalId(gladys, otherLocation);
  assert.equal(findBlueprintByDevice(gladys, { external_id: staleId }, config), undefined);
});

test('every severity feature is a read-only 0-4 risk index', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const severities = device.features.filter((f) => f.category === DEVICE_FEATURE_CATEGORIES.RISK);
  assert.equal(severities.length, 4, 'overall level + one per water type');
  for (const feature of severities) {
    assert.equal(feature.type, DEVICE_FEATURE_TYPES.RISK.INTEGER);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 4);
    assert.equal(feature.read_only, true);
  }
});

test('the device carries a text level and a binary "restrictions in force"', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, config);
  const text = device.features.find((f) => f.external_id.endsWith(FEATURE.LEVEL_TEXT));
  const binary = device.features.find((f) => f.external_id.endsWith(FEATURE.RESTRICTED));
  assert.equal(text.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.equal(text.type, DEVICE_FEATURE_TYPES.TEXT.TEXT);
  assert.equal(binary.category, DEVICE_FEATURE_CATEGORIES.INPUT);
  assert.equal(binary.type, DEVICE_FEATURE_TYPES.INPUT.BINARY);
  assert.equal(binary.read_only, true);
});

// --- Polling -----------------------------------------------------------------

test('onPoll publishes the overall level, the text and every water type', async () => {
  const gladys = createFakeGladys();
  stubVigieau(zonesFixture());
  await droughtZone.onPoll(gladys, config);

  const byFeature = new Map(gladys.published.map((p) => [p.featureExternalId, p]));
  const ids = gladys.externalIds('drought-zone', 'commune-75056');

  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL)).state, 3);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_SUP)).state, 2);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_SOU)).state, 3);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_AEP)).state, 1);
  assert.equal(byFeature.get(ids.feature(FEATURE.RESTRICTED)).state, 1);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_TEXT)).text, 'Alerte renforcée');
});

test('onPoll publishes a clear "no restriction" when nothing is in force', async () => {
  const gladys = createFakeGladys();
  stubVigieau([], 404);
  await droughtZone.onPoll(gladys, config);

  const ids = gladys.externalIds('drought-zone', 'commune-75056');
  const byFeature = new Map(gladys.published.map((p) => [p.featureExternalId, p]));
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL)).state, 0);
  assert.equal(byFeature.get(ids.feature(FEATURE.RESTRICTED)).state, 0);
  assert.equal(byFeature.get(ids.feature(FEATURE.LEVEL_TEXT)).text, 'Pas de restriction');
});

test('onPoll leaves the level untouched rather than publishing a false all-clear', async () => {
  const gladys = createFakeGladys();
  // The surface-water zone exists but carries a severity we cannot read: the
  // overall level is unknown, so it must NOT be published as "no restriction".
  stubVigieau([{ type: 'SUP', niveauGravite: 'niveau_martien' }]);
  await droughtZone.onPoll(gladys, config);

  const ids = gladys.externalIds('drought-zone', 'commune-75056');
  const publishedIds = gladys.published.map((p) => p.featureExternalId);
  assert.ok(!publishedIds.includes(ids.feature(FEATURE.LEVEL)), 'a stale value beats a wrong one');
  assert.ok(!publishedIds.includes(ids.feature(FEATURE.RESTRICTED)));
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
  await assert.rejects(() => droughtZone.onPoll(gladys, config), /no severity we could understand/);
  assert.equal(gladys.published.length, 0);
});

test('onPoll propagates an API outage so Gladys keeps the last known values', async () => {
  const gladys = createFakeGladys();
  stubVigieau(null, 503);
  await assert.rejects(() => droughtZone.onPoll(gladys, config), /VigiEau HTTP 503/);
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
  assert.match(message.fr, /Aucun usage/);
  assert.match(message.en, /No water usage/);
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
      normalizeConfig({ commune: '75056', poll_frequency: 1 }),
    );
    const before = gladys.published.length;
    mock.timers.tick(MIN_REFRESH_SECONDS * 1000 - 1);
    assert.equal(gladys.published.length, before, 'no second refresh before the floor');
    stop();
  } finally {
    mock.timers.reset();
  }
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

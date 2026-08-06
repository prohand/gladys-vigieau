// -----------------------------------------------------------------------------
// The device identity, i.e. WHICH external_id survives a location change.
//
// The bug these tests pin: the external_id used to carry the coordinates, so
// changing the address made Gladys discover a second device and the first one
// had to be deleted, history included. It is now built on the location's own
// id, generated once and never derived from anything the user can edit.
// -----------------------------------------------------------------------------

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STABLE_PLATFORM_ID,
  adoptExistingDevices,
  adoptedDeviceId,
  deviceIds,
  forgetAdoptedDevices,
  forgetDeletedDevice,
} from '../src/devices/identity.js';
import { legacyLocationId, normalizeConfig } from '../src/config.js';
import { FIRST_LOCATION_ID } from '../src/locations.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const TYPE = 'drought-zone';

const PARIS = { latitude: '48.8566', longitude: '2.3522' };
const LYON = { latitude: '45.764', longitude: '4.8357' };

/** A configuration whose first (migrated) location sits at `point`. */
function configAt(point, extra = []) {
  return normalizeConfig({
    locations: [{ id: FIRST_LOCATION_ID, name: 'Maison', ...point }, ...extra],
  });
}

const paris = configAt(PARIS);
const lyon = configAt(LYON);

/** The external_id a version <= 1.1.1 published for a point. */
function legacyDeviceId(gladys, point) {
  return gladys.externalIds(
    TYPE,
    legacyLocationId({ latitude: Number(point.latitude), longitude: Number(point.longitude) }),
  ).device;
}

beforeEach(() => {
  // The adoptions are module state, shared by every test of this file.
  forgetAdoptedDevices();
});

test('the device id is the location id, not the coordinates', () => {
  const gladys = createFakeGladys();
  assert.equal(
    deviceIds(gladys, TYPE, FIRST_LOCATION_ID).device,
    gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device,
    'the migrated location keeps the id its device was published under',
  );
  assert.notEqual(deviceIds(gladys, TYPE, FIRST_LOCATION_ID).device, legacyDeviceId(gladys, PARIS));
});

test('the device id does not change when the location moves', () => {
  // Nothing in deviceIds takes coordinates: moving is a configuration change,
  // and the device the user added to a room follows it.
  const gladys = createFakeGladys();
  const before = deviceIds(gladys, TYPE, paris.locations[0].id).device;
  const after = deviceIds(gladys, TYPE, lyon.locations[0].id).device;
  assert.equal(after, before);
});

test('two locations publish two distinct devices', () => {
  const gladys = createFakeGladys();
  assert.notEqual(
    deviceIds(gladys, TYPE, 'loc-aaaa').device,
    deviceIds(gladys, TYPE, 'loc-bbbb').device,
  );
});

test('feature ids follow the device id, exactly as the SDK builds them', () => {
  const gladys = createFakeGladys();
  const ids = deviceIds(gladys, TYPE, FIRST_LOCATION_ID);
  assert.equal(ids.feature('level'), `${ids.device}:level`);
});

test('a fresh install adopts nothing', async () => {
  const gladys = createFakeGladys({ devices: [] });
  await adoptExistingDevices(gladys, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
  assert.equal(
    deviceIds(gladys, TYPE, FIRST_LOCATION_ID).device,
    gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device,
  );
});

test('the device created by an older version keeps its identity', async () => {
  // Upgrading must not orphan the device already in a room, with its history.
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), existing);

  const ids = deviceIds(upgraded, TYPE, FIRST_LOCATION_ID);
  assert.equal(ids.device, existing);
  assert.equal(ids.feature('level'), `${existing}:level`, 'its features already exist under it');
});

test('an adopted device keeps its identity when the address changes', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);

  // The user moves to Lyon: same device, new point.
  assert.equal(deviceIds(upgraded, TYPE, lyon.locations[0].id).device, existing);
  assert.notEqual(
    deviceIds(upgraded, TYPE, lyon.locations[0].id).device,
    legacyDeviceId(upgraded, LYON),
  );
});

test('only the FIRST location can inherit an identity', async () => {
  // The versions that keyed the id on the coordinates published exactly one
  // device; a location added afterwards has no history to inherit.
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  const twoLocations = configAt(PARIS, [{ id: 'loc-second', name: 'Jardin', ...LYON }]);

  await adoptExistingDevices(upgraded, [TYPE], twoLocations);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), existing);
  assert.equal(adoptedDeviceId(TYPE, 'loc-second'), null);
  assert.equal(
    deviceIds(upgraded, TYPE, 'loc-second').device,
    upgraded.externalIds(TYPE, 'loc-second').device,
  );
});

test('a device already on the location id is left alone', async () => {
  const gladys = createFakeGladys();
  const stable = gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device;
  const migrated = createFakeGladys({
    // The leftover of a previous location still sits there, un-deleted.
    devices: [{ external_id: stable }, { external_id: legacyDeviceId(gladys, LYON) }],
  });

  await adoptExistingDevices(migrated, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
  assert.equal(deviceIds(migrated, TYPE, FIRST_LOCATION_ID).device, stable);
});

test('the device of a second location is never mistaken for a leftover', async () => {
  const gladys = createFakeGladys();
  const twoLocations = configAt(PARIS, [{ id: 'loc-second', name: 'Jardin', ...LYON }]);
  const running = createFakeGladys({
    devices: [{ external_id: gladys.externalIds(TYPE, 'loc-second').device }],
  });

  await adoptExistingDevices(running, [TYPE], twoLocations);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null, 'it belongs to another location');
});

test('with several leftovers, the one matching the first location wins', async () => {
  const gladys = createFakeGladys();
  const current = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({
    devices: [{ external_id: legacyDeviceId(gladys, LYON) }, { external_id: current }],
  });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(
    adoptedDeviceId(TYPE, FIRST_LOCATION_ID),
    current,
    'its history is the one about this point',
  );
});

test('several leftovers and none matching: no history is picked at random', async () => {
  const gladys = createFakeGladys();
  const upgraded = createFakeGladys({
    devices: [
      { external_id: legacyDeviceId(gladys, LYON) },
      { external_id: gladys.externalIds(TYPE, 'latlon-43.6045_1.4440').device },
    ],
  });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
});

test('devices of other types and other integrations are never adopted', async () => {
  const gladys = createFakeGladys({
    devices: [
      { external_id: 'other-type:latlon-48.8566_2.3522' },
      { external_id: 'mqtt:sensor:1' },
      { external_id: null },
      {},
    ],
  });
  await adoptExistingDevices(gladys, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
});

test('nothing is adopted when no location is configured at all', async () => {
  const gladys = createFakeGladys();
  const orphan = createFakeGladys({ devices: [{ external_id: legacyDeviceId(gladys, PARIS) }] });
  await adoptExistingDevices(orphan, [TYPE], normalizeConfig());
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
});

test('an unreadable device list falls back to the stable identity, without throwing', async () => {
  const gladys = createFakeGladys({ getDevicesError: new Error('host API down') });
  // Called during the startup sequence: a rejection here would abort the whole
  // initialization over a list we can do without.
  await adoptExistingDevices(gladys, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
});

test('an adoption is re-decided on every connection', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), existing);

  // The user deleted it while we were disconnected: the adoption must not
  // outlive the device it points at.
  const emptied = createFakeGladys({ devices: [] });
  await adoptExistingDevices(emptied, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE, FIRST_LOCATION_ID), null);
});

test('deleting the adopted device brings the stable identity back', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, PARIS);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);

  assert.equal(forgetDeletedDevice('some-other-device'), null, 'only ours matter');
  assert.deepEqual(forgetDeletedDevice(existing), { type: TYPE, locationId: FIRST_LOCATION_ID });
  assert.equal(
    deviceIds(upgraded, TYPE, FIRST_LOCATION_ID).device,
    upgraded.externalIds(TYPE, STABLE_PLATFORM_ID).device,
  );
});

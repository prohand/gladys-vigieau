// -----------------------------------------------------------------------------
// The device identity, i.e. WHICH external_id survives a location change.
//
// The bug these tests pin: the external_id used to carry the coordinates, so
// changing the address made Gladys discover a second device and the first one
// had to be deleted, history included.
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
import { createFakeGladys } from './helpers/fakeGladys.js';

const TYPE = 'drought-zone';
const paris = normalizeConfig({ latitude: 48.8566, longitude: 2.3522 });
const lyon = normalizeConfig({ latitude: 45.764, longitude: 4.8357 });

/** The external_id a version <= 1.1.1 published for a location. */
function legacyDeviceId(gladys, config) {
  return gladys.externalIds(TYPE, legacyLocationId(config)).device;
}

beforeEach(() => {
  // The adoptions are module state, shared by every test of this file.
  forgetAdoptedDevices();
});

test('the device id does not change when the location does', () => {
  const gladys = createFakeGladys();
  assert.equal(
    deviceIds(gladys, TYPE).device,
    gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device,
    'the identity is a constant, not the coordinates',
  );
  // Nothing in deviceIds takes a config: moving is a configuration change, and
  // the device the user added to a room follows it.
  assert.equal(deviceIds(gladys, TYPE).device, deviceIds(gladys, TYPE).device);
  assert.notEqual(deviceIds(gladys, TYPE).device, legacyDeviceId(gladys, paris));
});

test('feature ids follow the device id, exactly as the SDK builds them', () => {
  const gladys = createFakeGladys();
  const ids = deviceIds(gladys, TYPE);
  assert.equal(ids.feature('level'), `${ids.device}:level`);
});

test('a fresh install adopts nothing', async () => {
  const gladys = createFakeGladys({ devices: [] });
  await adoptExistingDevices(gladys, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), null);
  assert.equal(deviceIds(gladys, TYPE).device, gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device);
});

test('the device created by an older version keeps its identity', async () => {
  // Upgrading must not orphan the device already in a room, with its history.
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, paris);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), existing);

  const ids = deviceIds(upgraded, TYPE);
  assert.equal(ids.device, existing);
  assert.equal(ids.feature('level'), `${existing}:level`, 'its features already exist under it');
});

test('an adopted device keeps its identity when the address changes', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, paris);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);

  // The user moves to Lyon: same device, new point.
  assert.equal(deviceIds(upgraded, TYPE).device, existing);
  assert.notEqual(deviceIds(upgraded, TYPE).device, legacyDeviceId(upgraded, lyon));
});

test('a device already on the stable identity is left alone', async () => {
  const gladys = createFakeGladys();
  const stable = gladys.externalIds(TYPE, STABLE_PLATFORM_ID).device;
  const migrated = createFakeGladys({
    // The leftover of a previous location still sits there, un-deleted.
    devices: [{ external_id: stable }, { external_id: legacyDeviceId(gladys, lyon) }],
  });

  await adoptExistingDevices(migrated, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), null);
  assert.equal(deviceIds(migrated, TYPE).device, stable);
});

test('with several leftovers, the one matching the configured location wins', async () => {
  const gladys = createFakeGladys();
  const current = legacyDeviceId(gladys, paris);
  const upgraded = createFakeGladys({
    devices: [{ external_id: legacyDeviceId(gladys, lyon) }, { external_id: current }],
  });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), current, 'its history is the one about this point');
});

test('several leftovers and none matching: no history is picked at random', async () => {
  const gladys = createFakeGladys();
  const upgraded = createFakeGladys({
    devices: [
      { external_id: legacyDeviceId(gladys, lyon) },
      { external_id: gladys.externalIds(TYPE, 'latlon-43.6045_1.4440').device },
    ],
  });

  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), null);
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
  assert.equal(adoptedDeviceId(TYPE), null);
});

test('an unreadable device list falls back to the stable identity, without throwing', async () => {
  const gladys = createFakeGladys({ getDevicesError: new Error('host API down') });
  // Called during the startup sequence: a rejection here would abort the whole
  // initialization over a list we can do without.
  await adoptExistingDevices(gladys, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), null);
});

test('an adoption is re-decided on every connection', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, paris);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), existing);

  // The user deleted it while we were disconnected: the adoption must not
  // outlive the device it points at.
  const emptied = createFakeGladys({ devices: [] });
  await adoptExistingDevices(emptied, [TYPE], paris);
  assert.equal(adoptedDeviceId(TYPE), null);
});

test('deleting the adopted device brings the stable identity back', async () => {
  const gladys = createFakeGladys();
  const existing = legacyDeviceId(gladys, paris);
  const upgraded = createFakeGladys({ devices: [{ external_id: existing }] });
  await adoptExistingDevices(upgraded, [TYPE], paris);

  assert.equal(forgetDeletedDevice('some-other-device'), null, 'only ours matter');
  assert.equal(forgetDeletedDevice(existing), TYPE);
  assert.equal(
    deviceIds(upgraded, TYPE).device,
    upgraded.externalIds(TYPE, STABLE_PLATFORM_ID).device,
  );
});

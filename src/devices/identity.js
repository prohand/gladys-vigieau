// -----------------------------------------------------------------------------
// Device identity: the external_id a device keeps for its whole life.
//
// Gladys matches devices, features and states by `external_id`. Up to 1.1.1
// that id carried the coordinates (`ext:vigieau:drought-zone:latlon-48.8566_2.3522`),
// so changing the watched address changed the device's IDENTITY: the Discovery
// screen offered a brand new device, the one already added to a room went
// silent (`onPoll ignored: ... does not match the current location`), and the
// only way out was to delete it and add the new one — losing its history.
//
// The location is configuration, not identity. This integration watches ONE
// location, so its device IS "the place watched here", never "the point
// 48.8566/2.3522": the platform id is a constant, and moving the address only
// moves where that same device looks.
//
// A constant alone would orphan every device created by an earlier version,
// whose external_id carries its coordinates. Hence the adoption below: on
// connection we read the devices the user actually created and, when one of
// them belongs to a device type of ours, we keep publishing under ITS
// external_id. Nothing to delete, nothing to re-add, history preserved.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, legacyLocationId } from '../config.js';

const logger = createLogger({ name: 'device-identity' });

// Platform id of the single device each type publishes. A hard-coded label is
// exactly what the SDK warns against for a platform that has many devices; here
// the "platform" is the user's own configuration and there is only ever one
// device per type, so the constant IS the stable id.
export const STABLE_PLATFORM_ID = 'location';

// Device type -> external_id of a device the user already created under an
// older, coordinate-based identity. Empty on a fresh install.
const adoptedIds = new Map();

/**
 * The external ids to publish under for a device type, in the shape the SDK
 * returns (`{ device, feature(key) }`).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} type - device type, e.g. 'drought-zone'
 */
export function deviceIds(gladys, type) {
  const inherited = adoptedIds.get(type);
  if (!inherited) {
    return gladys.externalIds(type, STABLE_PLATFORM_ID);
  }
  // Same shape the SDK builds: `<device external_id>:<feature key>`. The
  // features of the adopted device already exist under those ids.
  return { device: inherited, feature: (key) => `${inherited}:${key}` };
}

/** The adopted external_id of a device type, or null when on the stable one. */
export function adoptedDeviceId(type) {
  return adoptedIds.get(type) ?? null;
}

/** Drop every adoption (reconnection, tests). */
export function forgetAdoptedDevices() {
  adoptedIds.clear();
}

/**
 * Forget a device the user just deleted in Gladys. Without this we would keep
 * publishing states to an external_id that no longer exists, and the Discovery
 * screen would keep offering the deleted identity instead of the stable one.
 * @param {string} externalId
 * @returns {string | null} the device type that was adopted under that id
 */
export function forgetDeletedDevice(externalId) {
  for (const [type, id] of adoptedIds) {
    if (id === externalId) {
      adoptedIds.delete(type);
      return type;
    }
  }
  return null;
}

/**
 * Pick, among the devices the user created, the one whose identity this type
 * must keep using — or null to publish under the stable identity.
 */
function chooseExistingDevice(gladys, type, devices, config) {
  const stableId = gladys.externalIds(type, STABLE_PLATFORM_ID).device;
  // `ext:<selector>:<type>:` — every device of this type, whatever platform id
  // the version that published it used.
  const prefix = gladys.externalIds(type, '').device;
  const candidates = devices
    .map((device) => device?.external_id)
    .filter((externalId) => typeof externalId === 'string' && externalId.startsWith(prefix));

  if (candidates.length === 0 || candidates.includes(stableId)) {
    // Fresh install, or already migrated: the stable identity is the right one.
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Several devices left over from the times when each address created its own:
  // the one matching the configured location is the one whose history belongs
  // to the point we are about to report on.
  const currentId = isConfigured(config)
    ? gladys.externalIds(type, legacyLocationId(config)).device
    : null;
  const current = candidates.find((externalId) => externalId === currentId);
  if (current) {
    logger.warn(
      `${candidates.length} devices of type ${type} exist; keeping the one matching the ` +
        'configured location. The others are leftovers you can delete in Gladys.',
    );
    return current;
  }
  // None of them matches: adopting one at random would silently pick whose
  // history survives, so we publish the stable identity and say why.
  logger.warn(
    `${candidates.length} devices of type ${type} exist, none matching the configured ` +
      'location. Publishing a new device: delete the old ones in Gladys.',
  );
  return null;
}

/**
 * Inherit the identity of the devices the user already created, so that a
 * location change updates them instead of discovering new ones.
 *
 * Called on every (re)connection, before publishing the catalog.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string[]} types - device types of the registry
 * @param {ReturnType<typeof import('../config.js').normalizeConfig>} config
 */
export async function adoptExistingDevices(gladys, types, config) {
  let devices;
  try {
    devices = await gladys.getDevices();
  } catch (err) {
    // Not fatal: publishing under the stable identity is right on a fresh
    // install, and merely offers a new device on an upgraded one. Retried on
    // the next reconnection rather than blocking the whole startup.
    logger.warn('Could not read the devices already created, keeping the stable identity', err);
    return;
  }

  for (const type of types) {
    // Re-decided from scratch every time: a device deleted while we were
    // disconnected must not keep its adoption alive.
    adoptedIds.delete(type);
    const existing = chooseExistingDevice(gladys, type, devices ?? [], config);
    if (existing) {
      adoptedIds.set(type, existing);
      logger.info(`Keeping the existing identity of ${type}: ${existing}`);
    }
  }
}

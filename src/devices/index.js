// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device types here. Each device lives in its own file and
// exposes the same shape:
//   - key                             : short identifier (used in logs)
//   - deviceExternalIds(gladys, cfg)  : every external_id it publishes, one per
//     watched location; they do NOT depend on the coordinates, see ./identity.js
//   - buildDevices(gladys, config)    : the discovery payloads sent to Gladys
//   - onPoll(gladys, config, id)       (optional): periodic read of ONE device
//   - actions                          (optional): manifest action handlers,
//     keyed by the action `key` declared in gladys-assistant-integration.json
//
// VigiEau is a read-only public API: this integration declares no `onSetValue`,
// no camera and no transport badge — see the official template if you need them.
// -----------------------------------------------------------------------------

import { droughtZone } from './droughtZone.js';
import { adoptExistingDevices as adoptIdentities, deviceIds } from './identity.js';

export const DEVICE_BLUEPRINTS = [droughtZone];

// Re-exported so index.js keeps talking to the registry only.
export { forgetDeletedDevice } from './identity.js';

/**
 * Inherit the identity of the device the user already created, so the devices
 * created by versions <= 1.1.1, whose external_id carried the coordinates,
 * keep working after the upgrade. See ./identity.js.
 */
export function adoptExistingDevices(gladys, config) {
  return adoptIdentities(
    gladys,
    DEVICE_BLUEPRINTS.map((bp) => bp.key),
    config,
  );
}

/**
 * Build the discovery payload for Gladys: every device type, for every watched
 * location.
 */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.flatMap((bp) => bp.buildDevices(gladys, config));
}

/**
 * The external_ids every blueprint publishes for ONE location.
 *
 * Used to answer "has the user already created this location's device?", which
 * decides what the delete action can promise: an integration may stop OFFERING
 * a device, but the host API gives it no way to delete one the user created.
 */
export function locationDeviceIds(gladys, locationId) {
  return DEVICE_BLUEPRINTS.map((bp) => deviceIds(gladys, bp.key, locationId).device);
}

/**
 * Find the blueprint that owns a given device, from its external_id
 * (used to route onPoll to the right device).
 */
export function findBlueprintByDevice(gladys, device, config) {
  return DEVICE_BLUEPRINTS.find((bp) =>
    bp.deviceExternalIds(gladys, config).includes(device.external_id),
  );
}

// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device types here. Each device lives in its own file and
// exposes the same shape:
//   - key                             : short identifier (used in logs)
//   - deviceExternalId(gladys)        : the device external_id (for dispatch);
//     it does NOT depend on the configuration, see ./identity.js
//   - buildDevice(gladys, config)     : the discovery payload sent to Gladys
//   - onPoll(gladys, config)           (optional): periodic read
//   - actions                          (optional): manifest action handlers,
//     keyed by the action `key` declared in gladys-assistant-integration.json
//
// VigiEau is a read-only public API: this integration declares no `onSetValue`,
// no camera and no transport badge — see the official template if you need them.
// -----------------------------------------------------------------------------

import { droughtZone } from './droughtZone.js';
import { adoptExistingDevices as adoptIdentities } from './identity.js';

export const DEVICE_BLUEPRINTS = [droughtZone];

// Re-exported so index.js keeps talking to the registry only.
export { forgetDeletedDevice } from './identity.js';

/**
 * Inherit the identity of the devices the user already created, so an address
 * change updates the existing device instead of discovering a new one — and so
 * the devices created by versions <= 1.1.1, whose external_id carried the
 * coordinates, keep working after the upgrade. See ./identity.js.
 */
export function adoptExistingDevices(gladys, config) {
  return adoptIdentities(
    gladys,
    DEVICE_BLUEPRINTS.map((bp) => bp.key),
    config,
  );
}

/**
 * Build the discovery payload for Gladys (all devices).
 */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.map((bp) => bp.buildDevice(gladys, config));
}

/**
 * Find the blueprint that owns a given device, from its external_id
 * (used to route onPoll to the right device).
 */
export function findBlueprintByDevice(gladys, device, config) {
  return DEVICE_BLUEPRINTS.find((bp) => bp.deviceExternalId(gladys, config) === device.external_id);
}

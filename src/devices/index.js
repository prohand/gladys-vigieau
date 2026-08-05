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
import { adoptExistingDevices as adoptIdentities } from './identity.js';

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
 * Find the blueprint that owns a given device, from its external_id
 * (used to route onPoll to the right device).
 */
export function findBlueprintByDevice(gladys, device, config) {
  return DEVICE_BLUEPRINTS.find((bp) =>
    bp.deviceExternalIds(gladys, config).includes(device.external_id),
  );
}

/**
 * The watched location a device external_id belongs to. Used by the actions
 * whose form carries a `select` fed by the core's `devices` source: their value
 * is a device external_id, and what the handler needs is the location behind it.
 * @returns {object | undefined}
 */
export function findLocationByDevice(gladys, externalId, config) {
  for (const bp of DEVICE_BLUEPRINTS) {
    const location = bp.locationForDevice?.(gladys, config, externalId);
    if (location) {
      return location;
    }
  }
  return undefined;
}

// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device types here. Each device lives in its own file and
// exposes the same shape:
//   - key                             : short identifier (used in logs)
//   - deviceExternalId(gladys, config): the device external_id (for dispatch)
//   - buildDevice(gladys, config)     : the discovery payload sent to Gladys
//   - onPoll(gladys, config)           (optional): periodic read
//   - actions                          (optional): manifest action handlers,
//     keyed by the action `key` declared in gladys-assistant-integration.json
//
// VigiEau is a read-only public API: this integration declares no `onSetValue`,
// no camera and no transport badge — see the official template if you need them.
// -----------------------------------------------------------------------------

import { droughtZone } from './droughtZone.js';

export const DEVICE_BLUEPRINTS = [droughtZone];

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

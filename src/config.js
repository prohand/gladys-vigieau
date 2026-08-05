// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// Two halves live in there, and they are not stored the same way:
//   - the GLOBAL settings (`profil`, `poll_frequency`), which are ordinary
//     config_schema fields, rendered by the Configuration screen;
//   - the WATCHED LOCATIONS, a list the user builds at runtime, which no
//     static config_schema can hold — it lives under the off-schema
//     `locations` key and is managed by the manifest actions. See
//     `src/locations.js` for the full reasoning.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined` or with a number that
// arrived as a string from an HTML form.
// -----------------------------------------------------------------------------

import { legacyLocations, normalizeLocations, usableLocations } from './locations.js';

// Re-exported so the callers that only need to read or write a coordinate do
// not have to know which module holds the parsing rules.
export { formatCoordinate, toCoordinate } from './coordinates.js';

// The four user profiles VigiEau knows about. Restrictions are not the same for
// a household and for a farm, so the profile changes which `usages` the API
// returns — and, for the AEP zones, which level applies.
export const PROFILES = ['particulier', 'entreprise', 'collectivite', 'exploitation'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (a unit test enforces it).
//
// There is no default location, and there must never be one: a default pair of
// coordinates would silently watch Paris on a fresh install.
export const DEFAULT_CONFIG = {
  profil: 'particulier',
  poll_frequency: 3600, // seconds — drought decrees change once a day at most
};

/**
 * Merge the user configuration with the defaults and force the types.
 * @param {Record<string, unknown>} raw configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const profil = String(raw.profil ?? DEFAULT_CONFIG.profil);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // Guard against a profile the manifest no longer offers.
    profil: PROFILES.includes(profil) ? profil : DEFAULT_CONFIG.profil,
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    // An install made before 1.3.0 has no `locations` key at all: its single
    // location is rebuilt from the config fields that held it, so the device
    // keeps reporting before the migration is even written back (index.js
    // persists it on connection). An EMPTY array is left empty on purpose —
    // it means the user deleted every location, and resurrecting their old
    // address on the next restart would be a bug, not a migration.
    locations: Array.isArray(raw.locations)
      ? normalizeLocations(raw.locations)
      : legacyLocations(raw),
  };
}

/**
 * Whether the integration knows where to look at all. Anything less than one
 * usable point means `publishDevices()` publishes nothing and says why — a
 * device pinned to an empty location is worse than no device.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return usableLocations(config.locations).length > 0;
}

/**
 * Identifier of a location as versions up to 1.1.1 built the device
 * `external_id` from.
 *
 * It is NOT the device identity any more, and that was the bug: the location is
 * configuration, so deriving the identity from it turned every address change
 * into a brand new device — the old one had to be deleted, its history with it
 * (see `src/devices/identity.js`). It survives for one job only: recognizing
 * the device those versions created, so its identity can be inherited instead
 * of orphaned.
 *
 * Rounded to ~10 m, as it was then, so the recognition matches what was
 * actually published.
 * @param {{ latitude: number, longitude: number }} location
 */
export function legacyLocationId(location) {
  return `latlon-${Number(location.latitude).toFixed(4)}_${Number(location.longitude).toFixed(4)}`;
}

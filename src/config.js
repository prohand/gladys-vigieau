// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// Three halves live in there, and they are not stored the same way:
//   - the GLOBAL settings (`profil`, `poll_frequency`), ordinary config_schema
//     fields, rendered by the Configuration screen;
//   - the WATCHED LOCATIONS, a list the user builds at runtime, which no static
//     config_schema can hold — it lives under the off-schema `locations` key,
//     next to `selected_location`. See `src/locations.js`;
//   - the DETAIL FIELDS (`location_name`, `address_label`, `latitude`,
//     `longitude`), config_schema fields that MIRROR the selected location:
//     the integration writes the selected location into them, the user edits
//     them and Saves, and the edit goes back into the list. See
//     `src/locationEditor.js`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined` or with a number that
// arrived as a string from an HTML form.
// -----------------------------------------------------------------------------

import {
  clampPosition,
  legacyLocations,
  locationAtPosition,
  normalizeLocations,
  SELECTION_FIELD,
  usableLocations,
} from './locations.js';

// Re-exported so the callers that only need to read or write a coordinate do
// not have to know which module holds the parsing rules.
export { formatCoordinate, toCoordinate } from './coordinates.js';

// The four user profiles VigiEau knows about. Restrictions are not the same for
// a household and for a farm, so the profile changes which `usages` the API
// returns — and, for the AEP zones, which level applies.
export const PROFILES = ['particulier', 'entreprise', 'collectivite', 'exploitation'];

// The config_schema fields that mirror the selected location. Their names are
// the ones the single-location versions used, on purpose: an install upgraded
// from <= 1.2.0 finds its address exactly where it left it, and `legacyLocations`
// reads the very same keys to build the first entry of the list.
export const DETAIL_FIELDS = ['location_name', 'address_label', 'latitude', 'longitude'];

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
  // An install made before 1.3.0 has no `locations` key at all: its single
  // location is rebuilt from the config fields that held it, so the device
  // keeps reporting before the migration is even written back (index.js
  // persists it on connection). An EMPTY array is left empty on purpose — it
  // means the user deleted every location, and resurrecting their old address
  // on the next restart would be a bug, not a migration.
  const locations = Array.isArray(raw.locations)
    ? normalizeLocations(raw.locations)
    : legacyLocations(raw);
  // The `lieu` select of the "Le lieu à surveiller" section IS the selection:
  // its value is a position in the list, kept inside it whatever was stored.
  const selectedPosition = clampPosition(locations, raw[SELECTION_FIELD]);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    // Guard against a profile the manifest no longer offers.
    profil: PROFILES.includes(profil) ? profil : DEFAULT_CONFIG.profil,
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    locations,
    selectedPosition,
    // Never an id that is not in the list: the mirror fields describe this
    // location, and one pointing at nothing would silently edit the wrong one.
    selectedId: locationAtPosition(locations, selectedPosition)?.id ?? '',
  };
}

/**
 * The detail fields of a raw configuration, as TEXT — the exact shape the
 * Configuration screen sends back and the integration writes.
 *
 * Everything is a string, `null`/`undefined` included, so two snapshots can be
 * compared key by key without a special case (see src/locationEditor.js).
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, string>}
 */
export function readDetailFields(raw = {}) {
  const fields = {};
  for (const key of DETAIL_FIELDS) {
    fields[key] = String(raw?.[key] ?? '').trim();
  }
  return fields;
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
 * Coordinates stored as numbers by a version of this integration that declared
 * them `number`, rewritten as text.
 *
 * Without this, the first Save on the Configuration screen of an upgraded
 * install fails as a whole: the front sends back the untouched stored value,
 * the core validates it against the schema, and a number under a `string` field
 * is a 422. The fields still exist — they mirror the selected location now —
 * so the patch is still needed.
 * @param {Record<string, unknown>} raw configuration returned by the SDK
 * @returns {Record<string, string>} the patch to write back, empty if none
 */
export function legacyCoordinatePatch(raw = {}) {
  const patch = {};
  for (const key of ['latitude', 'longitude']) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      patch[key] = String(value);
    }
  }
  return patch;
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

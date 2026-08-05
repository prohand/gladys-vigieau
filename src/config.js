// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined` or with a number that
// arrived as a string from an HTML form.
// -----------------------------------------------------------------------------

// The four user profiles VigiEau knows about. Restrictions are not the same for
// a household and for a farm, so the profile changes which `usages` the API
// returns — and, for the AEP zones, which level applies.
export const PROFILES = ['particulier', 'entreprise', 'collectivite', 'exploitation'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (a unit test enforces it).
//
// The location is a pair of WGS-84 coordinates, geocoded from the address the
// user types. They have no default — `null` means "not configured yet", and a
// default would silently watch Paris.
export const DEFAULT_CONFIG = {
  location_name: 'Maison',
  // Purely informational: the address the coordinates below were geocoded from,
  // so the user can see WHERE the device is actually looking without decoding
  // a pair of decimals. Never used to query anything.
  address_label: '',
  latitude: null,
  longitude: null,
  profil: 'particulier',
  poll_frequency: 3600, // seconds — drought decrees change once a day at most
};

/**
 * A number that the user may legitimately leave empty. An empty form field
 * arrives as '' (or undefined), which `Number()` would silently turn into 0 —
 * a perfectly valid latitude in the Gulf of Guinea. Hence the explicit null.
 * @param {unknown} value
 * @returns {number | null}
 */
function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Merge the user configuration with the defaults and force the types.
 * @param {Record<string, unknown>} raw configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const profil = String(raw.profil ?? DEFAULT_CONFIG.profil);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    location_name: String(raw.location_name ?? DEFAULT_CONFIG.location_name).trim(),
    address_label: String(raw.address_label ?? DEFAULT_CONFIG.address_label).trim(),
    latitude: toOptionalNumber(raw.latitude),
    longitude: toOptionalNumber(raw.longitude),
    // Guard against a profile the manifest no longer offers.
    profil: PROFILES.includes(profil) ? profil : DEFAULT_CONFIG.profil,
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
  };
}

/**
 * Whether the user filled in BOTH coordinates. A single one is not usable, so
 * it is treated as "no coordinates" rather than as a half-configured query.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function hasCoordinates(config) {
  return config.latitude !== null && config.longitude !== null;
}

/**
 * Whether the integration knows where to look at all. The coordinates ARE the
 * location, so this is exactly `hasCoordinates` — kept under its own name
 * because that is the question index.js asks.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return hasCoordinates(config);
}

/**
 * Stable identifier of the observed location, used to build the device
 * `external_id`. It must NOT change when the user only renames the location,
 * otherwise Gladys would see a brand new device and the history would be lost.
 *
 * Rounded to ~10 m: re-running the address search on the same street must not
 * orphan the device the user already added to a room over a metre of jitter.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function locationId(config) {
  return `latlon-${Number(config.latitude).toFixed(4)}_${Number(config.longitude).toFixed(4)}`;
}

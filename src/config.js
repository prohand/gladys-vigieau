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
// The INSEE commune code is the mandatory input; the coordinates are an
// OPTIONAL refinement for the large communes covered by several zones, and
// therefore have no default — `null` means "the user left them empty".
export const DEFAULT_CONFIG = {
  location_name: 'Maison',
  commune: '', // INSEE code, required in the manifest
  latitude: null, // optional; when both are filled in they win over the commune
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
    // An INSEE code is a 5-character string ('01001', '2A004'): keep it as a
    // string, never as a number, or the leading zero is lost. Upper-cased so
    // the Corsican '2a004' typed in lowercase still matches.
    commune: String(raw.commune ?? DEFAULT_CONFIG.commune)
      .trim()
      .toUpperCase(),
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
 * Whether the integration knows where to look at all.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return Boolean(config.commune) || hasCoordinates(config);
}

/**
 * Stable identifier of the observed location, used to build the device
 * `external_id`. It must NOT change when the user only renames the location,
 * otherwise Gladys would see a brand new device and the history would be lost.
 *
 * It follows the same precedence as the query itself: the coordinates when
 * they are provided, the commune otherwise. Two locations answered by the same
 * query must share the same id, and only that.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function locationId(config) {
  if (hasCoordinates(config)) {
    // Round to ~10 m: a one-metre jitter in the coordinates must not orphan the
    // device the user already added to a room.
    return `latlon-${config.latitude.toFixed(4)}_${config.longitude.toFixed(4)}`;
  }
  return `commune-${config.commune.toLowerCase()}`;
}

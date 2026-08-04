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
export const DEFAULT_CONFIG = {
  location_name: 'Maison',
  commune: '', // optional INSEE code; when set it wins over the coordinates
  latitude: 48.8566, // Paris
  longitude: 2.3522,
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
    location_name: String(raw.location_name ?? DEFAULT_CONFIG.location_name).trim(),
    // An INSEE code is a 5-character string ('01001', '2A004'): keep it as a
    // string, never as a number, or the leading zero is lost.
    commune: String(raw.commune ?? DEFAULT_CONFIG.commune).trim(),
    latitude: Number(raw.latitude ?? DEFAULT_CONFIG.latitude),
    longitude: Number(raw.longitude ?? DEFAULT_CONFIG.longitude),
    // Guard against a profile the manifest no longer offers.
    profil: PROFILES.includes(profil) ? profil : DEFAULT_CONFIG.profil,
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
  };
}

/**
 * Stable identifier of the observed location, used to build the device
 * `external_id`. It must NOT change when the user only renames the location,
 * otherwise Gladys would see a brand new device and the history would be lost.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function locationId(config) {
  if (config.commune) {
    return `commune-${config.commune.toLowerCase()}`;
  }
  // Round to ~10 m: a one-metre jitter in the coordinates must not orphan the
  // device the user already added to a room.
  return `latlon-${config.latitude.toFixed(4)}_${config.longitude.toFixed(4)}`;
}

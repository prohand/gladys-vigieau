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
//
// They are STORED AS TEXT and parsed here, on purpose: see `toCoordinate`.
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

// Range of a WGS-84 coordinate. The core enforced it for us as long as the
// fields were declared `number` (`min`/`max` are number-only in the store
// schema); now that they are text fields, checking it is ours to do.
const COORDINATE_LIMITS = { latitude: 90, longitude: 180 };

/**
 * Parse a coordinate typed by the user, accepting BOTH decimal separators.
 *
 * The latitude/longitude fields are declared `string` in the manifest, not
 * `number`, and this is the reason why: a `number` field is rendered as an
 * `<input type="number">`, whose `value` the browser sanitizes against ITS OWN
 * locale. On a French browser, "48.8566" is not a number — the input hands the
 * front an empty string, and the Configuration screen then simply drops the key
 * from the payload it saves (`Number('')` is NaN, and a NaN is not sent), so
 * the coordinate silently keeps its previous value and nothing says why. A text
 * field hands us exactly what was typed, and both "48,8566" and "48.8566" end
 * up as the same number here.
 *
 * Anything that is not a usable coordinate — letters, a latitude of 300 — is
 * `null`, i.e. "not configured", which `isConfigured` turns into a visible
 * message instead of a query to a point that does not exist.
 * @param {unknown} value
 * @param {'latitude' | 'longitude'} key - which limit applies
 * @returns {number | null}
 */
export function toCoordinate(value, key) {
  // The comma is the French decimal separator; `\s` also covers the non-breaking
  // spaces a copy-paste from a web page brings along.
  const cleaned = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const parsed = toOptionalNumber(cleaned);
  if (parsed === null || Math.abs(parsed) > COORDINATE_LIMITS[key]) {
    return null;
  }
  return parsed;
}

/**
 * A coordinate in the form it is STORED in: text, dot-separated, which is what
 * the core accepts for a `string` field and what `toCoordinate` reads back.
 * @param {number} value
 * @returns {string}
 */
export function formatCoordinate(value) {
  return String(value);
}

/**
 * Coordinates stored as numbers by a version of this integration that declared
 * them `number`, rewritten as text.
 *
 * Without this, the first Save on the Configuration screen of an upgraded
 * install fails as a whole: the front sends back the untouched stored value,
 * the core validates it against the schema, and a number under a `string` field
 * is a 422.
 * @param {Record<string, unknown>} raw configuration returned by the SDK
 * @returns {Record<string, string>} the patch to write back, empty if none
 */
export function legacyCoordinatePatch(raw = {}) {
  const patch = {};
  for (const key of ['latitude', 'longitude']) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      patch[key] = formatCoordinate(value);
    }
  }
  return patch;
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
    latitude: toCoordinate(raw.latitude, 'latitude'),
    longitude: toCoordinate(raw.longitude, 'longitude'),
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
 * Identifier of the observed location as versions up to 1.1.1 built the device
 * `external_id` from.
 *
 * It is NOT the device identity any more, and that was the bug: the location is
 * configuration, so deriving the identity from it turned every address change
 * into a brand new device — the old one had to be deleted, its history with it
 * (see `src/devices/identity.js`). It survives for one job only: recognizing
 * the devices those versions created, so their identity can be inherited
 * instead of orphaned.
 *
 * Rounded to ~10 m, as it was then, so the recognition matches what was
 * actually published.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function legacyLocationId(config) {
  return `latlon-${Number(config.latitude).toFixed(4)}_${Number(config.longitude).toFixed(4)}`;
}

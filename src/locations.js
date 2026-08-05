// -----------------------------------------------------------------------------
// The watched locations.
//
// Up to 1.2.0 this integration watched ONE point, held by the `latitude` /
// `longitude` / `location_name` config fields. It now watches a list, and each
// location publishes its own device — a house, a second home, an allotment
// garden are rarely under the same prefectoral decree.
//
// WHERE THE LIST IS STORED, and why it is not a config_schema field.
// The Configuration screen is generated from the manifest, which is static: a
// `select` only takes the options written in the manifest or the core's own
// `devices` source (see externalIntegration.validateConfigValue), and there is
// no repeatable field type at all. A list the user builds at runtime simply
// cannot be a config_schema entry.
//
// It goes where the core explicitly leaves room for it: a key OUTSIDE the
// schema. `setIntegrationConfig` validates the keys the schema declares and
// treats the others as "a free internal storage of the integration, never
// displayed in the UI" — stored JSON-encoded and handed back parsed by
// `getConfig()`. So the list travels as an array under `locations`, and the
// user manipulates it through the manifest actions (add / edit / delete),
// whose forms the core DOES render dynamically.
//
// Coordinates are stored as TEXT here, exactly as the config fields stored
// them, for one reason that has not changed: `Number('')` is `0`, a valid
// latitude in the Gulf of Guinea, and a French browser turns "48.8566" into an
// empty string. `toCoordinate()` parses, `formatCoordinate()` writes back.
// -----------------------------------------------------------------------------

import { formatCoordinate, toCoordinate } from './coordinates.js';

// Config key holding the list. Deliberately absent from the manifest
// `config_schema`: see the header.
export const LOCATIONS_KEY = 'locations';

// Identifier of the location an install created before 1.3.0. It is the
// platform id the single device was published under, so keeping it as the id
// of the migrated first location means its external_id does not move and the
// device the user added to a room keeps its history. Never reuse it for a
// location the user adds.
export const FIRST_LOCATION_ID = 'location';

// One VigiEau request per location and per refresh cycle. VigiEau is a free
// public service, and nobody watches fifty drought zones: the cap keeps an
// accidental loop in the actions from turning an install into a crawler.
export const MAX_LOCATIONS = 10;

// Long enough that two locations never collide, short enough that
// `ext:vigieau:drought-zone:loc-3f8a2b1c` stays readable in a log line.
const ID_LENGTH = 8;

/**
 * A brand new location id, unique among the ones already in use.
 *
 * Random rather than a counter on purpose: an integration cannot delete a
 * Gladys device, so a device whose location was removed here may still exist
 * there. A reused id would silently hand that device's history to the next
 * location the user creates.
 * @param {Array<{ id: string }>} existing
 * @returns {string}
 */
export function newLocationId(existing = []) {
  const taken = new Set(existing.map((location) => location?.id));
  for (;;) {
    const id = `loc-${Math.random()
      .toString(36)
      .slice(2, 2 + ID_LENGTH)
      .padEnd(ID_LENGTH, '0')}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/**
 * One location, with its coordinates parsed into numbers.
 *
 * `latitude`/`longitude` are `null` when unusable — the location is kept in
 * the list rather than dropped (losing a location because a stored value was
 * malformed would be worse than showing it as unconfigured), and
 * `hasCoordinates` decides whether it can be published and queried.
 * @param {object} raw
 * @param {string} fallbackId - id to use when the stored entry has none
 */
function normalizeLocation(raw, fallbackId) {
  return {
    id: String(raw?.id ?? fallbackId),
    name: String(raw?.name ?? '').trim() || 'Lieu',
    // Purely informational: the address the coordinates were geocoded from, so
    // the user can see WHERE the device looks without decoding two decimals.
    address_label: String(raw?.address_label ?? '').trim(),
    latitude: toCoordinate(raw?.latitude, 'latitude'),
    longitude: toCoordinate(raw?.longitude, 'longitude'),
  };
}

/**
 * The stored list, normalized: valid entries only, ids unique, capped.
 * @param {unknown} raw - the `locations` value returned by `getConfig()`
 * @returns {Array<object>}
 */
export function normalizeLocations(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const locations = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const location = normalizeLocation(entry, newLocationId(locations));
    // A duplicated id would publish two devices under one external_id, and the
    // second would silently overwrite the first's states.
    if (!locations.some((existing) => existing.id === location.id)) {
      locations.push(location);
    }
    if (locations.length >= MAX_LOCATIONS) {
      break;
    }
  }
  return locations;
}

/**
 * The list in the shape it is STORED in: coordinates back to text, so what we
 * write is what `normalizeLocations` reads back.
 * @param {Array<object>} locations
 */
export function serializeLocations(locations = []) {
  return locations.map((location) => ({
    id: location.id,
    name: location.name,
    address_label: location.address_label ?? '',
    latitude: location.latitude === null ? '' : formatCoordinate(location.latitude),
    longitude: location.longitude === null ? '' : formatCoordinate(location.longitude),
  }));
}

/**
 * Whether a location knows where to look. A single coordinate is not a point,
 * so it counts as "not configured" rather than as half a query.
 *
 * `Number.isFinite` rather than `!== null`: a normalized location always holds
 * `number | null`, but this also guards the raw objects the drivers are handed,
 * where a missing coordinate is `undefined` — which would sail through a null
 * check and end up in a query as the string "undefined".
 * @param {{ latitude: number|null, longitude: number|null }} location
 */
export function hasCoordinates(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

/** The locations we can actually publish a device for. */
export function usableLocations(locations = []) {
  return locations.filter(hasCoordinates);
}

/** @returns {object | undefined} */
export function findLocationById(locations = [], id) {
  return locations.find((location) => location.id === id);
}

/**
 * Lookup by name, case- and accent-insensitive: the name is what the user
 * typed in the action form, not something they copied.
 * @returns {object | undefined}
 */
export function findLocationByName(locations = [], name) {
  const wanted = foldName(name);
  if (wanted === '') {
    return undefined;
  }
  return locations.find((location) => foldName(location.name) === wanted);
}

/**
 * The names of the watched locations, comma-separated.
 *
 * The actions designate a location BY NAME (nothing in a manifest can offer a
 * picker that works, see the header of locationActions.js), so a name that
 * matches nothing must show the user the ones that do exist.
 * @param {Array<object>} locations
 */
export function locationNames(locations = []) {
  return locations.map((location) => location.name).join(', ');
}

function foldName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // drop the accents
    .trim()
    .toLowerCase();
}

/**
 * Add a location, or update the one that already carries `id`.
 * @param {Array<object>} locations
 * @param {object} patch - the fields to write, `id` selecting an existing one
 * @returns {Array<object>} a new list — the caller stores it, nothing mutates
 */
export function upsertLocation(locations = [], patch = {}) {
  const existing = patch.id ? findLocationById(locations, patch.id) : undefined;
  if (!existing) {
    const location = normalizeLocation(patch, patch.id ?? newLocationId(locations));
    return [...locations, location];
  }
  // Only the keys actually present in the patch are touched: renaming a
  // location must not blank the address it was geocoded from.
  const merged = normalizeLocation({ ...serializeOne(existing), ...patch }, existing.id);
  return locations.map((location) => (location.id === existing.id ? merged : location));
}

function serializeOne(location) {
  return serializeLocations([location])[0];
}

/**
 * Remove a location. The Gladys device that was published for it is NOT
 * deleted — an integration cannot delete a device, only stop offering it — so
 * the caller tells the user to delete it in Gladys.
 * @returns {Array<object>} a new list
 */
export function removeLocation(locations = [], id) {
  return locations.filter((location) => location.id !== id);
}

/**
 * The list an install created before 1.3.0 carried in its config fields.
 *
 * Used ONLY when no `locations` key exists yet: an empty array is a user who
 * deleted every location, and resurrecting their old address on the next
 * restart would be a bug, not a migration.
 * @param {Record<string, unknown>} raw - the raw config returned by getConfig()
 * @returns {Array<object>} one location, or none when nothing was configured
 */
export function legacyLocations(raw = {}) {
  const latitude = toCoordinate(raw.latitude, 'latitude');
  const longitude = toCoordinate(raw.longitude, 'longitude');
  if (latitude === null || longitude === null) {
    return [];
  }
  return [
    normalizeLocation(
      {
        // The very id the single device was published under, so the migration
        // moves no external_id and loses no history.
        id: FIRST_LOCATION_ID,
        name: raw.location_name,
        address_label: raw.address_label,
        latitude,
        longitude,
      },
      FIRST_LOCATION_ID,
    ),
  ];
}

/**
 * What the VigiEau driver needs to query ONE location: the point, plus the
 * profile, which is a global setting (the restrictions that apply to a
 * household are the same in every garden they own).
 * @param {{ profil: string }} config
 * @param {object} location
 */
export function locationQuery(config, location) {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    profil: config.profil,
  };
}

/**
 * One-line description, for the messages shown under the action buttons.
 * @param {object} location
 */
export function describeLocation(location) {
  const point = hasCoordinates(location)
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : '—';
  return location.address_label
    ? `${location.name} — ${location.address_label} (${point})`
    : `${location.name} — ${point}`;
}

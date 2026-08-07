// -----------------------------------------------------------------------------
// The watched locations.
//
// Up to 1.2.0 this integration watched ONE point, held by the `latitude` /
// `longitude` / `location_name` config fields. It now watches a list, and each
// location publishes its own device — a house, a second home and an allotment
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
// user sees and manipulates it through the manifest ACTIONS only: the message
// an action resolves to is the one place the Configuration screen displays
// anything this integration has to say (see `describeLocations`).
//
// Coordinates are stored as TEXT here, exactly as the config fields store
// them, for one reason that has not changed: `Number('')` is `0`, a valid
// latitude in the Gulf of Guinea, and a French browser turns "48.8566" into an
// empty string. `toCoordinate()` parses, `formatCoordinate()` writes back.
// -----------------------------------------------------------------------------

import { formatCoordinate, toCoordinate } from './coordinates.js';
import { boldLabel } from './richText.js';

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
//
// It is ALSO the number of options the delete action's dropdown offers — they
// are positions in this list, and a static manifest cannot offer more of them
// (a test keeps the two in sync).
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
 * The location already watching a point, if there is one.
 *
 * Compared at five decimals — about a metre, the precision the listing prints
 * and far below anything VigiEau tells apart, its zones being cut along
 * catchment basins. It is what keeps "Ajouter mes maisons Gladys" idempotent:
 * clicking it twice must not publish a second device for the same roof, and a
 * house is recognized by WHERE it is, its Gladys id being no business of a
 * location (a location outlives the house it was imported from).
 * @param {Array<object>} locations
 * @param {{ latitude: number, longitude: number }} point
 * @returns {object | undefined}
 */
export function findLocationAtPoint(locations = [], point) {
  if (!hasCoordinates(point)) {
    return undefined;
  }
  return usableLocations(locations).find(
    (location) =>
      location.latitude.toFixed(5) === point.latitude.toFixed(5) &&
      location.longitude.toFixed(5) === point.longitude.toFixed(5),
  );
}

/**
 * The location a 1-based POSITION designates — what the `lieu` select of the
 * delete action carries.
 *
 * The options of a `select` are static (the manifest is a file), so they can
 * only be positions: "Lieu 1", "Lieu 2"... The "Afficher les lieux" action is
 * what maps a position to a name, hence `describeLocations` below.
 * @param {Array<object>} locations
 * @param {unknown} position - "1".."10", as the form sends it
 * @returns {object | null}
 */
export function locationAtPosition(locations = [], position) {
  const index = Number.parseInt(String(position ?? ''), 10) - 1;
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  return locations[index] ?? null;
}

/**
 * The 1-based position of a location, or 0 when it is not in the list. It is
 * the number "Afficher les lieux" prints and the delete dropdown offers.
 */
export function positionOf(locations = [], id) {
  return locations.findIndex((location) => location.id === id) + 1;
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
 * Those fields have left the config_schema — the list lives under its own key
 * and is manipulated through the actions — but their VALUES are still there:
 * `getIntegrationConfig` hands the integration every stored key, schema or not.
 * Hence a plain read of the raw config, coordinates included — they may still be the numbers a version older
 * than 1.2.0 wrote, which `toCoordinate` reads just as well as text.
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
 * WHERE a location is, with no name: what the listing prints after the dash.
 *
 * Five decimals is about a metre: enough to recognize the point that was
 * geocoded, short enough to keep the line readable when ten of them follow one
 * another under a button. A location with no usable point shows a dash rather
 * than nothing: it is neither published nor queried, and this is what says so.
 * @param {object} location
 */
export function locationDetail(location) {
  const point = hasCoordinates(location)
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : '—';
  return location.address_label ? `${location.address_label} (${point})` : point;
}

/**
 * One-line description, for the messages shown under the action buttons — the
 * only place the Configuration screen displays anything an integration says.
 *
 * Used INSIDE a sentence ("Lieu 2 « Jardin » ajouté : ..."), where the location
 * is already named and numbered by the sentence itself; a line of a LIST is
 * built by `locationLine` instead.
 * @param {object} location
 */
export function describeLocation(location) {
  return `${location.name} — ${locationDetail(location)}`;
}

// One entry per line — see describeLocations for what the Configuration screen
// currently does with it.
export const LOCATION_LINE_SEPARATOR = '\n';

// What OPENS every entry of every list this integration prints — the listing
// here, the per-location reports of src/devices/droughtZone.js.
//
// It exists because the line break does not survive the Configuration screen,
// and it is the only part of "one entry per line" that reaches the user today:
// `ActionsCard.jsx` renders an action's answer as the text of a plain
// `<div class="alert">`, whose default `white-space: normal` collapses a
// newline into a space. Re-checked against the Gladys sources on master, not
// only at v4.84.4: the message is still a plain text child (so any markup is
// escaped), no `white-space` rule exists anywhere in the front's CSS, and
// U+2028 / U+2029 were measured in Chromium — they collapse too. There is
// nothing an integration can send that renders as a break.
//
// A bare number does not survive that collapse: addresses are full of digits
// and dots, so "... 69600 Oullins (45.71611, 4.80877) 2. Paris ..." reads as
// one run-on sentence. A bullet cannot occur inside an address, which makes it
// the visible boundary between two entries whether the newline lives or dies.
export const LOCATION_LINE_MARKER = '• ';

/**
 * ONE entry of ANY list this integration prints, in the single format the three
 * reporting actions share: `• n. name — detail`.
 *
 * The listing puts the address and the point in `detail`, "Tester la connexion"
 * puts the severity there and "Afficher les restrictions" the restricted usages
 * — so the three answers read as the same list of the same locations, and the
 * number is the one the delete dropdown offers in all three.
 *
 * The number and the name are the only thing shown in bold: they are the label
 * the eye scans to find a location among ten lines, and emphasis costs
 * something (see src/richText.js) that the detail must not pay.
 * @param {number} position - 1-based, as `positionOf` counts
 * @param {string} name
 * @param {string} detail - what this list says about the location
 */
export function locationLine(position, name, detail) {
  return `${LOCATION_LINE_MARKER}${boldLabel(`${position}. ${name}`)} — ${detail}`;
}

/**
 * The whole list, numbered, ONE LOCATION PER LINE, as the "Afficher les lieux"
 * action prints it.
 *
 * Numbered because those numbers ARE the ones the delete dropdown offers: a
 * `select` only holds the static options the manifest declares, so this listing
 * is what tells the user which location "Lieu 2" is.
 *
 * The separator is a real newline — it is what the container logs show, and
 * what the screen will show the day it stops collapsing it — and every entry
 * opens with `LOCATION_LINE_MARKER` plus its number, which is what keeps the
 * entries apart on today's screen (see the marker's own comment).
 *
 * EVERY location is listed, including one whose coordinates are unusable: it is
 * neither published nor queried, and this line is the only thing that says why.
 * @param {Array<object>} locations
 */
export function describeLocations(locations = []) {
  if (locations.length === 0) {
    return 'aucun lieu configuré';
  }
  return locations
    .map((location, index) => locationLine(index + 1, location.name, locationDetail(location)))
    .join(LOCATION_LINE_SEPARATOR);
}

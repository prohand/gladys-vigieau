// -----------------------------------------------------------------------------
// The houses the user configured in Gladys.
//
// WHAT IT IS FOR. Somebody who runs Gladys has already told it where they live —
// that is what the map in "Réglages > Maisons" is. Asking them to type their own
// address again, in another form, to watch the drought restrictions that apply
// to that very garden is asking twice for something the core will hand over.
// This module is the one place that reads it, and "Ajouter mes maisons Gladys"
// is the button that turns it into watched locations.
//
// WHY IT IS NOT THE SDK. `GET /house` was opened by Gladys 4.85.0 and the
// JavaScript SDK does not wrap it yet (0.11.0), so the call is made by hand with
// the credentials the supervisor injects into the container — the two variables
// the SDK itself reads, and nothing more.
//
// WHY IT NEEDS A LINE IN THE MANIFEST. Where somebody lives is sensitive personal
// data, so the core treats the access as an AUTHORIZATION CONTRACT rather than an
// endpoint: `"location": true` in the manifest is shown on the install screen as
// a request the user accepts, and it is enforced server-side. An integration that
// did not declare it gets a 403 — which is why that status is told apart from
// every other failure below: it is not an outage, it is a permission the install
// never granted, and the only thing that fixes it is re-installing the
// integration.
//
// WHAT COMES BACK is deliberately narrow: `{ id, name, selector, latitude,
// longitude }`, in the order the core sorted them. Never the alarm mode, the code
// or the delay. And `latitude`/`longitude` are NULL for a house the user never
// placed on the map, which is a case with its own message rather than a point at
// (0, 0).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { toCoordinate } from './coordinates.js';

const logger = createLogger({ name: 'houses' });

/** Path of the endpoint on the host API, prefix included. */
export const HOUSE_API_PATH = '/api/integration/v1/house';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Marker carried by the error raised when the core refuses the read.
 *
 * A 403 here means one thing only: the manifest of the INSTALLED version did not
 * declare `location: true`. The caller turns it into "re-install to grant it",
 * which no generic "HTTP 403" message would ever say.
 */
export const HOUSE_ACCESS_DENIED = 'HOUSE_ACCESS_DENIED';

/** The name a house with no name of its own is listed under. */
const UNNAMED_HOUSE = 'Maison';

/**
 * @typedef {object} House
 * @property {string} id
 * @property {string} name
 * @property {string} selector
 * @property {number|null} latitude
 * @property {number|null} longitude
 */

/**
 * One house of the answer, with its coordinates parsed.
 *
 * `toCoordinate` rather than `Number`: a house the user never placed on the map
 * comes back with `latitude: null`, and `Number(null)` is 0 — a valid latitude,
 * in the Gulf of Guinea. Null in, null out, and the caller says so.
 * @param {object} raw
 * @returns {House}
 */
export function normalizeHouse(raw) {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? '').trim() || UNNAMED_HOUSE,
    selector: String(raw?.selector ?? ''),
    latitude: toCoordinate(raw?.latitude, 'latitude'),
    longitude: toCoordinate(raw?.longitude, 'longitude'),
  };
}

/**
 * The base URL of the host API, without its trailing slash — the SDK builds its
 * own URLs the same way, and `.../api` doubled by a slash is a 404 nobody enjoys
 * reading.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

/**
 * Read the houses configured in Gladys.
 *
 * Throws rather than returns on failure — every case here is either a
 * misconfiguration or an outage, i.e. exactly the "unexpected" the location
 * manager turns into one message. The 403 carries `code = HOUSE_ACCESS_DENIED`
 * so the caller can name the one fix that works.
 * @param {object} [options] - injected in tests; the defaults are the variables
 *   the supervisor puts in the container
 * @param {string} [options.hostApiUrl]
 * @param {string} [options.token]
 * @returns {Promise<House[]>} in the order the core sorted them
 */
export async function fetchHouses({
  hostApiUrl = process.env.GLADYS_HOST_API_URL,
  token = process.env.GLADYS_INTEGRATION_TOKEN,
} = {}) {
  const baseUrl = normalizeBaseUrl(hostApiUrl);
  if (baseUrl === '' || !token) {
    // Only reachable outside a Gladys container: the supervisor always injects
    // both, and the SDK would not have connected without them.
    throw new Error('GLADYS_HOST_API_URL and GLADYS_INTEGRATION_TOKEN are required');
  }

  const url = `${baseUrl}${HOUSE_API_PATH}`;
  logger.debug('House lookup ->', url);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 403) {
    const denied = new Error('Gladys refused the access to the house coordinates (HTTP 403)');
    denied.code = HOUSE_ACCESS_DENIED;
    throw denied;
  }
  if (!response.ok) {
    throw new Error(`Gladys host API HTTP ${response.status}`);
  }

  const payload = await response.json();
  const houses = (Array.isArray(payload) ? payload : []).map(normalizeHouse);
  logger.info(`House lookup -> ${houses.length} house(s)`);
  return houses;
}

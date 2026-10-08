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
// THROUGH THE SDK. `GET /house` was opened by Gladys 4.85.0, and SDK 0.14 wraps
// it as `gladys.getHouses()`: same endpoint, same token, same timeout as every
// other host API call. This module used to call it by hand with the variables
// the supervisor injects, which duplicated the SDK's transport for no gain.
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
 * Read the houses configured in Gladys.
 *
 * Throws rather than returns on failure — every case here is either a
 * misconfiguration or an outage, i.e. exactly the "unexpected" the location
 * manager turns into one message. The 403 carries `code = HOUSE_ACCESS_DENIED`
 * so the caller can name the one fix that works.
 *
 * The SDK raises a `GladysApiError` for every non-2xx answer, the HTTP status
 * in `status`; its own `code` is the core's error code ("FORBIDDEN"...), which
 * is why the 403 is recognized by its status and re-thrown under our marker.
 * @param {{ getHouses: () => Promise<unknown> }} gladys - the SDK instance
 * @returns {Promise<House[]>} in the order the core sorted them
 */
export async function fetchHouses(gladys) {
  let payload;
  try {
    payload = await gladys.getHouses();
  } catch (err) {
    if (err?.status === 403) {
      const denied = new Error('Gladys refused the access to the house coordinates (HTTP 403)', {
        cause: err,
      });
      denied.code = HOUSE_ACCESS_DENIED;
      throw denied;
    }
    throw err;
  }
  const houses = (Array.isArray(payload) ? payload : []).map(normalizeHouse);
  logger.info(`House lookup -> ${houses.length} house(s)`);
  return houses;
}

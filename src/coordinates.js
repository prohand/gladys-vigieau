// -----------------------------------------------------------------------------
// Reading and writing a WGS-84 coordinate.
//
// Its own module so that `src/locations.js` can parse the coordinates of a
// location without importing `src/config.js`, which needs the location list to
// normalize a configuration — a cycle nothing here is worth.
//
// The rules below are the whole reason coordinates are handled by hand instead
// of being read straight off the form; each one cost a real bug.
// -----------------------------------------------------------------------------

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
// coordinates were `number` config fields (`min`/`max` are number-only in the
// store schema); they are text now, and checked here.
const COORDINATE_LIMITS = { latitude: 90, longitude: 180 };

/**
 * Parse a coordinate typed by the user, accepting BOTH decimal separators.
 *
 * Coordinates are text everywhere in this integration — in the stored location
 * list and in the action forms that fill it — and this is the reason why: a
 * `number` field is rendered as an `<input type="number">`, whose `value` the
 * browser sanitizes against ITS OWN locale. On a French browser, "48.8566" is
 * not a number — the input hands the front an empty string, and the front then
 * simply drops the key from the payload it sends (`Number('')` is NaN, and a
 * NaN is not sent), so the coordinate silently keeps its previous value and
 * nothing says why. A text field hands us exactly what was typed, and both
 * "48,8566" and "48.8566" end up as the same number here.
 *
 * Anything that is not a usable coordinate — letters, a latitude of 300 — is
 * `null`, i.e. "not configured", which the caller turns into a visible message
 * instead of a query to a point that does not exist.
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
 * `toCoordinate` reads back.
 * @param {number} value
 * @returns {string}
 */
export function formatCoordinate(value) {
  return String(value);
}

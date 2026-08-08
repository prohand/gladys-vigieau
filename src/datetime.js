// -----------------------------------------------------------------------------
// Rendering a date, and a date with a time, for the two freshness features.
//
// They are TEXT features because Gladys has NO date/time feature category —
// `DEVICE_FEATURE_CATEGORIES` holds no `TIMESTAMP`, no `DATE`, no `CLOCK` (see
// device-constants.js in the SDK), and a `number` feature would be rendered as
// a bare epoch. So the wording is entirely ours, and it is built here rather
// than inline so it stays consistent and testable.
//
// TWO deliberate choices, both of which caused bugs elsewhere when guessed:
//
// - **Europe/Paris, always.** The container's own timezone is whatever the
//   Docker host gives it, which is UTC by default: a refresh at 09:26 in France
//   would read "07:26" on the dashboard in summer. VigiEau is a French service
//   covering France only, and a prefectoral decree is dated on French time, so
//   the timestamp is rendered in the timezone the user's decree is written in.
//
// - **The string is assembled from `formatToParts`, not from a locale.**
//   `toLocaleString('fr-FR')` needs the French locale data, which a Node built
//   with small-icu does NOT have — and it does not throw, it silently falls
//   back to en-US, which prints "6/1/2026" where the user expects "01/06/2026".
//   Numeric parts and time zones work in every build, so the order and the
//   separators are ours. `en-CA` is only asked for so the parts come out
//   numeric; none of its formatting survives.
// -----------------------------------------------------------------------------

// The timezone every published date/time is rendered in (see above).
export const DISPLAY_TIME_ZONE = 'Europe/Paris';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  // `hour12: false` is NOT the same thing: some ICU versions render midnight as
  // "24:00" under it. h23 is the 00-23 clock the reader expects.
  hourCycle: 'h23',
});

/** The `formatToParts` output as a plain `{ year, month, day, hour, minute }`. */
function partsOf(date) {
  const parts = {};
  for (const { type, value } of PARTS.formatToParts(date)) {
    parts[type] = value;
  }
  return parts;
}

/**
 * A moment, as `JJ/MM/AAAA HH:MM` in Europe/Paris.
 * @param {Date} [date] - defaults to now, which is what the caller always wants
 * @returns {string}
 */
export function formatDateTime(date = new Date()) {
  const { day, month, year, hour, minute } = partsOf(date);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

// A date VigiEau published, e.g. "2026-06-15". The API types the field as a
// Date, but JSON only carries the string.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * A day, as `JJ/MM/AAAA`.
 *
 * A `YYYY-MM-DD` is re-ordered textually, never parsed: `new Date('2026-06-15')`
 * is midnight UTC, which is the 14th at 21:00 in Papeete and the 15th at 02:00
 * in Paris — rendering a date-only value through a timezone is how a decree
 * ends up looking a day older than the one the user is reading.
 *
 * @param {unknown} value - a `YYYY-MM-DD` string, a full ISO timestamp, or a Date
 * @returns {string | null} null when there is no readable date
 */
export function formatDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const iso = ISO_DATE.exec(String(value));
  if (iso) {
    const [, year, month, day] = iso;
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const { day, month, year } = partsOf(parsed);
  return `${day}/${month}/${year}`;
}

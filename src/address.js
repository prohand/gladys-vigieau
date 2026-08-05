// -----------------------------------------------------------------------------
// Address geocoding, so the user never has to find a code or coordinates.
//
// Source: the official "Base Adresse Nationale" geocoder operated by the French
// state — https://api-adresse.data.gouv.fr. Free, public, no account, no key.
// It is the same service vigieau.gouv.fr itself uses to locate an address.
//
// Why an address rather than an INSEE commune code: VigiEau answers `409`
// ("la commune comporte plusieurs zones d'alerte de même type") whenever a
// commune spans several zones of one water type — the commune code simply
// cannot say which one applies, which is why the website asks for a street.
// A geocoded point never has that problem, so the integration stores WGS-84
// coordinates and queries VigiEau by point.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'address' });

// Overridable for local development / tests; the default is the public API.
const API_BASE_URL = process.env.ADDRESS_API_URL ?? 'https://api-adresse.data.gouv.fr';

const REQUEST_TIMEOUT_MS = 15_000;

// Enough alternatives to disambiguate a vague query without flooding the
// message displayed under the button.
const SEARCH_LIMIT = 10;

// The geocoder ranks its answers with a relevance score between 0 and 1.
// Below this, the match is too weak to fill the coordinates in on the user's
// behalf: we show the candidates and let them pick.
export const MIN_SCORE = 0.5;

/**
 * Geocode a free-text address.
 *
 * @param {string} query - anything from "Montauban" to "12 rue des Lilas, 82000"
 * @returns {Promise<Array<{
 *   label: string, latitude: number, longitude: number,
 *   score: number, city: string, postcode: string, citycode: string,
 *   context: string, type: string,
 * }>>} the matches, best first
 */
export async function searchAddresses(query) {
  const q = String(query ?? '').trim();
  if (q.length < 3) {
    throw new Error('Type at least three characters of an address');
  }

  const params = new URLSearchParams({ q, limit: String(SEARCH_LIMIT) });
  const url = `${API_BASE_URL}/search/?${params.toString()}`;
  logger.debug('Base Adresse Nationale request ->', url);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Base Adresse Nationale HTTP ${response.status}`);
  }

  const body = await response.json();
  return (Array.isArray(body?.features) ? body.features : [])
    .map((feature) => {
      // GeoJSON order: [longitude, latitude]. Swapping them silently moves the
      // location a few hundred kilometres, so this is the one line to read
      // twice — the VigiEau front-end reads them in the same order.
      const [longitude, latitude] = feature?.geometry?.coordinates ?? [];
      const properties = feature?.properties ?? {};
      return {
        label: String(properties.label ?? ''),
        latitude: Number(latitude),
        longitude: Number(longitude),
        score: Number(properties.score ?? 0),
        city: String(properties.city ?? ''),
        postcode: String(properties.postcode ?? ''),
        citycode: String(properties.citycode ?? ''),
        context: String(properties.context ?? ''),
        type: String(properties.type ?? ''),
      };
    })
    .filter((match) => Number.isFinite(match.latitude) && Number.isFinite(match.longitude));
}

/**
 * The match to use, or null when the answer is too weak to pick one alone.
 *
 * A postal code covers several communes and a town name often exists a dozen
 * times over, so a vague query must end in the user choosing — never in a coin
 * flip that would silently watch another town's drought level.
 *
 * @param {Array<{ score: number }>} matches
 */
export function pickAddress(matches = []) {
  const [best] = matches;
  if (!best) {
    return null;
  }
  return best.score >= MIN_SCORE ? best : null;
}

/**
 * One-line description of a match, for the message shown under the button.
 * @param {{ label: string, context?: string }} match
 */
export function describeAddress(match) {
  return match.context ? `${match.label} (${match.context})` : match.label;
}

/**
 * Geocode, then either resolve to one point or hand the candidates back.
 * @param {string} query
 * @returns {Promise<{ match: object | null, candidates: Array<object> }>}
 */
export async function resolveAddress(query) {
  const candidates = await searchAddresses(query);
  return { match: pickAddress(candidates), candidates };
}

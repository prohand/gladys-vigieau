// -----------------------------------------------------------------------------
// Driver for the VigiEau API — the French government service that publishes the
// drought alert level ("vigilance sécheresse") and the water restrictions in
// force at a given address.
//
//   https://vigieau.gouv.fr          — the public site
//   https://api.vigieau.beta.gouv.fr — the open API, no account, no API key
//
// The endpoint we use is `GET /api/zones`. A location is covered by ONE zone
// per water type ("SUP" surface water, "SOU" groundwater, "AEP" drinking
// water), each with its own severity level, because a prefectoral decree can
// restrict groundwater without restricting the tap.
//
// This module is split in two on purpose:
//   - `fetchZones()` does the HTTP call (the only impure part);
//   - `summarize()` is a pure function turning the raw zones into the values we
//     publish, so all the mapping logic is unit-testable without the network.
//
// Node 20+ provides `fetch` natively: no HTTP dependency needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'vigieau' });

// Overridable for local development / tests; the default is the public API.
const API_BASE_URL = process.env.VIGIEAU_API_URL ?? 'https://api.vigieau.beta.gouv.fr';

const REQUEST_TIMEOUT_MS = 15_000;

// The three water types VigiEau reports, in the order we display them.
export const ZONE_TYPES = ['SUP', 'SOU', 'AEP'];

// The severity scale, from "nothing to report" to the most severe decree.
// Values are the ones the API returns in `niveauGravite`.
export const SEVERITY_LEVELS = {
  pas_restriction: 0,
  vigilance: 1,
  alerte: 2,
  alerte_renforcee: 3,
  crise: 4,
};

// Human-readable labels, indexed by numeric level. The French wording is the
// official one used by the prefectoral decrees, so we publish it as-is in the
// text feature; the English one is only used in the action messages.
export const SEVERITY_LABELS = {
  fr: ['Pas de restriction', 'Vigilance', 'Alerte', 'Alerte renforcée', 'Crise'],
  en: ['No restriction', 'Watch', 'Alert', 'Reinforced alert', 'Crisis'],
};

/**
 * Turn a raw `niveauGravite` into its numeric level.
 * Accents, spaces and dashes are tolerated ("Alerte renforcée" ===
 * "alerte_renforcee"), so a cosmetic change on the API side does not break us.
 * @param {unknown} raw
 * @returns {number | null} the level, or null when the value is unknown
 */
export function toSeverityLevel(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const normalized = String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // drop the accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized in SEVERITY_LEVELS) {
    return SEVERITY_LEVELS[normalized];
  }
  // Wording used by some responses for the lowest level.
  if (normalized === 'pas_de_restriction' || normalized === 'aucune_restriction') {
    return SEVERITY_LEVELS.pas_restriction;
  }
  return null;
}

/**
 * Build the query string of `GET /api/zones`.
 * The API takes EITHER an INSEE commune code OR WGS-84 coordinates; when the
 * user filled in a commune we use it, as it is the unambiguous option.
 * @param {{ commune: string, latitude: number, longitude: number, profil: string }} config
 */
export function buildZonesUrl(config) {
  const params = new URLSearchParams();
  if (config.commune) {
    params.set('commune', config.commune);
  } else {
    params.set('lat', String(config.latitude));
    params.set('lon', String(config.longitude));
  }
  params.set('profil', config.profil);
  return `${API_BASE_URL}/api/zones?${params.toString()}`;
}

/**
 * Fetch the zones covering the configured location.
 *
 * A location outside any restriction zone answers 404: that is not an error,
 * it is the normal "nothing in force here" answer, so we return an empty list.
 * Any other non-2xx is propagated — the caller decides whether to keep the last
 * known values or to report the integration as disconnected.
 *
 * @param {{ commune: string, latitude: number, longitude: number, profil: string }} config
 * @returns {Promise<Array<object>>} the raw zones, as returned by the API
 */
export async function fetchZones(config) {
  const url = buildZonesUrl(config);
  logger.debug('VigiEau request ->', url);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    logger.info('VigiEau: no restriction zone covers this location');
    return [];
  }
  if (!response.ok) {
    throw new Error(`VigiEau HTTP ${response.status}`);
  }

  const body = await response.json();
  // The endpoint answers an array; a single object is tolerated defensively.
  if (Array.isArray(body)) {
    return body;
  }
  return body && typeof body === 'object' ? [body] : [];
}

/**
 * Aggregate the raw zones into the values published to Gladys. Pure function.
 *
 * `null` is used for "we do not know", and is never published: it happens when
 * the API returns a severity wording we do not recognise. Reporting a stale
 * value is much safer than publishing a false "no restriction" that would let
 * an automation water the garden during a crisis.
 *
 * @param {Array<object>} zones
 * @returns {{
 *   level: number | null,
 *   levelsByType: Record<string, number | null>,
 *   zoneNames: Record<string, string>,
 *   worstZone: object | null,
 *   restrictedUsages: Array<object>,
 *   arrete: object | null,
 * }}
 */
export function summarize(zones = []) {
  const levelsByType = {};
  const zoneNames = {};

  for (const type of ZONE_TYPES) {
    const zonesOfType = zones.filter((zone) => zone?.type === type);
    if (zonesOfType.length === 0) {
      // No zone of that water type covers the location: nothing restricts it.
      levelsByType[type] = 0;
      zoneNames[type] = '';
      continue;
    }
    const levels = zonesOfType
      .map((zone) => toSeverityLevel(zone.niveauGravite))
      .filter((level) => level !== null);
    if (levels.length === 0) {
      logger.warn(
        `VigiEau returned an unknown severity for the ${type} zone: ` +
          `${JSON.stringify(zonesOfType.map((z) => z.niveauGravite))}`,
      );
      levelsByType[type] = null;
    } else {
      levelsByType[type] = Math.max(...levels);
    }
    zoneNames[type] = zonesOfType.map((zone) => zone.nom).filter(Boolean)[0] ?? '';
  }

  // One unknown water type is enough to make the overall level unknown: the
  // zone we failed to read could well be the worst one.
  const perType = ZONE_TYPES.map((type) => levelsByType[type]);
  const level = perType.includes(null) ? null : Math.max(...perType);

  // The zone that carries the worst level: its decree is the one to show.
  const worstZone =
    level === null
      ? null
      : (zones.find((zone) => toSeverityLevel(zone.niveauGravite) === level) ?? null);

  return {
    level,
    levelsByType,
    zoneNames,
    worstZone,
    restrictedUsages: collectUsages(zones),
    arrete: worstZone?.arrete ?? null,
  };
}

/**
 * The distinct restricted usages across every zone, de-duplicated by name.
 * The API already filters them for the configured `profil`.
 * @param {Array<object>} zones
 */
export function collectUsages(zones = []) {
  const byName = new Map();
  for (const zone of zones) {
    for (const usage of zone?.usages ?? []) {
      if (usage?.nom && !byName.has(usage.nom)) {
        byName.set(usage.nom, usage);
      }
    }
  }
  return [...byName.values()];
}

/**
 * Human-readable label of a numeric level.
 * @param {number | null} level
 * @param {'fr' | 'en'} language
 */
export function severityLabel(level, language = 'fr') {
  const labels = SEVERITY_LABELS[language] ?? SEVERITY_LABELS.fr;
  const unknown = language === 'en' ? 'Unknown' : 'Inconnu';
  return level === null || level === undefined ? unknown : (labels[level] ?? unknown);
}

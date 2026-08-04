// -----------------------------------------------------------------------------
// Commune lookup, so the user never has to hunt for an INSEE code by hand.
//
// Source: the official "API Découpage administratif" (API Géo) operated by the
// French state — https://geo.api.gouv.fr. Free, public, no account, no key.
// It is the authoritative mapping between a commune name / postal code and its
// INSEE code (the `code` field of the answer).
//
// Why a search rather than a real dropdown: a Gladys `config_schema` select can
// only carry static `options` from the manifest, or the core-defined
// `source: "devices"`. There is no core-side source for communes, and the 34 000
// French communes cannot be inlined in a manifest. So the "selector" is an
// action: the user types a name, we resolve it and write the INSEE code into
// the configuration ourselves through `setConfig`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'communes' });

// Overridable for local development / tests; the default is the public API.
const API_BASE_URL = process.env.GEO_API_URL ?? 'https://geo.api.gouv.fr';

const REQUEST_TIMEOUT_MS = 15_000;

// Enough to show the user every "Sainte-Marie" of France without flooding the
// message displayed under the button.
const SEARCH_LIMIT = 15;

/** A French postal code: 5 digits ('33000'), never letters. */
const POSTAL_CODE_PATTERN = /^\d{5}$/;

/**
 * Lower-case, accent-free, punctuation-free form of a name, so "Saint-Étienne",
 * "saint etienne" and "SAINT-ETIENNE" all compare equal.
 * @param {unknown} value
 */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Search the communes matching a name and/or a postal code.
 *
 * The postal code alone is a perfectly good entry point — it is what people
 * have on their mail — even though it is NOT the INSEE code and may cover
 * several communes; that is exactly why the answer stays a list.
 *
 * @param {{ nom?: string, codePostal?: string }} query
 * @returns {Promise<Array<{ code: string, nom: string, departement: string, codesPostaux: string[] }>>}
 */
export async function searchCommunes({ nom = '', codePostal = '' } = {}) {
  const name = String(nom).trim();
  const postalCode = String(codePostal).trim();

  if (!name && !postalCode) {
    throw new Error('Type at least a commune name or a postal code');
  }
  if (postalCode && !POSTAL_CODE_PATTERN.test(postalCode)) {
    throw new Error(`"${postalCode}" is not a 5-digit postal code`);
  }

  const params = new URLSearchParams({
    fields: 'nom,code,codesPostaux,departement',
    limit: String(SEARCH_LIMIT),
  });
  // Searching by postal code is exact, so it is the more selective of the two;
  // the name then only narrows the result down locally.
  if (postalCode) {
    params.set('codePostal', postalCode);
  } else {
    params.set('nom', name);
    // Rank the big cities first: typing "Paris" should not surface a hamlet.
    params.set('boost', 'population');
  }

  const url = `${API_BASE_URL}/communes?${params.toString()}`;
  logger.debug('API Géo request ->', url);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`API Géo HTTP ${response.status}`);
  }

  const body = await response.json();
  const communes = (Array.isArray(body) ? body : []).map((commune) => ({
    code: String(commune.code ?? ''),
    nom: String(commune.nom ?? ''),
    departement: commune.departement?.nom ?? commune.departement?.code ?? '',
    codesPostaux: Array.isArray(commune.codesPostaux) ? commune.codesPostaux : [],
  }));

  // When both criteria are given, the name filters the postal-code answer.
  if (postalCode && name) {
    const wanted = normalizeName(name);
    const narrowed = communes.filter((commune) => normalizeName(commune.nom).includes(wanted));
    if (narrowed.length > 0) {
      return narrowed;
    }
  }
  return communes.filter((commune) => commune.code);
}

/**
 * Pick THE commune the user meant, or null when it is genuinely ambiguous.
 *
 * Being wrong here means silently watching the drought level of another town,
 * so the rule is deliberately strict: a single result, or a single exact name
 * match. "Sainte-Marie" (which exists a dozen times) resolves to nothing and
 * the user is shown the list instead of a coin flip.
 *
 * @param {Array<{ code: string, nom: string }>} communes
 * @param {{ nom?: string }} query
 */
export function pickCommune(communes = [], { nom = '' } = {}) {
  if (communes.length === 1) {
    return communes[0];
  }
  const wanted = normalizeName(nom);
  if (!wanted) {
    return null;
  }
  const exact = communes.filter((commune) => normalizeName(commune.nom) === wanted);
  return exact.length === 1 ? exact[0] : null;
}

/**
 * One-line description of a commune, for the message shown under the button.
 * @param {{ code: string, nom: string, departement?: string, codesPostaux?: string[] }} commune
 */
export function describeCommune(commune) {
  const departement = commune.departement ? ` (${commune.departement})` : '';
  const postalCode = commune.codesPostaux?.length ? ` — ${commune.codesPostaux[0]}` : '';
  return `${commune.nom}${departement}${postalCode} : ${commune.code}`;
}

/**
 * Resolve what the user typed into either a single INSEE code, or the list of
 * candidates to disambiguate. Pure orchestration on top of the two functions
 * above, kept here so the action handler stays a handful of lines.
 *
 * @param {{ nom?: string, codePostal?: string }} query
 * @returns {Promise<{ commune: object | null, candidates: Array<object> }>}
 */
export async function resolveCommune(query) {
  const candidates = await searchCommunes(query);
  return { commune: pickCommune(candidates, query), candidates };
}

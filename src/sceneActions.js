// -----------------------------------------------------------------------------
// Scene actions (Gladys >= 5.1.0, manifest `scene_actions`).
//
// An action is an OPERATION a scene runs, with parameters and a result — the
// outputs the following actions of the scene read (`{{…}}`) and its conditions
// test. Two here, both questions asked of VigiEau right now:
//
//   - `lire_niveau`    : the level of one location, per water type, with its
//     decree — to put in a notification, or to gate a scene on.
//   - `verifier_usage` : is a given water use restricted at this location? The
//     question a watering scene asks before opening the valve.
//
// Both read VigiEau LIVE and publish NOTHING: no state, no scene event. A
// scene action that fired an event could start a scene bound to that event,
// which would loop through the integration (the SDK's "no loops" rule); the
// refresh cycle stays the only thing that moves the devices and the triggers.
//
// The location is the `lieu` field, a dropdown of the integration's devices
// (`source: "devices"`): its value is a device external_id, mapped back to the
// location it watches.
// -----------------------------------------------------------------------------

import { formatDate } from './datetime.js';
import { hasCoordinates } from './locations.js';
import { severityLabel } from './vigieau.js';

// The scene action keys declared in the manifest. Keys are forever: a scene
// stores them.
export const SCENE_ACTION = {
  READ_LEVEL: 'lire_niveau',
  CHECK_USAGE: 'verifier_usage',
};

/**
 * Lowercase, accents and punctuation folded to spaces: "Arrosage des
 * pelouses" is found by "arrosage", "pelouse" or "ARROSÉ" alike.
 */
export function foldText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The decree's URL, or an empty string: an output is a scalar, never absent. */
function decreeUrl(arrete) {
  const url = arrete?.cheminFichier;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : '';
}

/**
 * The outputs of `lire_niveau`. Pure.
 *
 * `niveau_code` is VigiEau's 0-4 scale, NOT the 0-3 of the risk feature: a
 * scene condition can tell `crise` (4) from `alerte renforcée` (3) here. An
 * unknown level leaves it out (null is dropped by the core) rather than
 * reporting a 0 that would read as "no restriction".
 * @param {{ name: string }} location
 * @param {ReturnType<typeof import('./vigieau.js').summarize>} summary
 */
export function levelOutputs(location, summary) {
  const { level, levelsByType, restrictedUsages, arrete } = summary;
  return {
    nom_lieu: location.name,
    niveau_texte: severityLabel(level, 'fr'),
    niveau_code: level,
    eau_superficielle: severityLabel(levelsByType.SUP, 'fr'),
    eau_souterraine: severityLabel(levelsByType.SOU, 'fr'),
    eau_potable: severityLabel(levelsByType.AEP, 'fr'),
    nb_usages_restreints: restrictedUsages.length,
    usages_restreints: restrictedUsages.map((usage) => usage.nom).join(', '),
    arrete_depuis: formatDate(arrete?.dateDebutValidite) ?? '',
    url_arrete: decreeUrl(arrete),
  };
}

/**
 * The outputs of `verifier_usage`. Pure.
 *
 * A usage matches when every word searched appears in its name or its theme —
 * not in its description, which is prose and mentions everything ("arrosage"
 * appears in the car-wash rule of half the decrees).
 * @param {ReturnType<typeof import('./vigieau.js').summarize>} summary
 * @param {string} search
 */
export function usageOutputs(summary, search) {
  const words = foldText(search).split(' ').filter(Boolean);
  const matches = summary.restrictedUsages.filter((usage) => {
    const haystack = ` ${foldText(`${usage.nom ?? ''} ${usage.thematique ?? ''}`)} `;
    return words.every((word) => haystack.includes(word));
  });
  return {
    restreint: matches.length > 0,
    nb_usages: matches.length,
    usages: matches.map((usage) => usage.nom).join(', '),
    details: matches
      .map((usage) => (usage.description ? `${usage.nom} : ${usage.description}` : usage.nom))
      .join(' | '),
    niveau_texte: severityLabel(summary.level, 'fr'),
    url_arrete: decreeUrl(summary.arrete),
  };
}

/**
 * The scene action handlers, keyed like the manifest. Every dependency is
 * injected, so they run offline in the tests.
 * @param {object} deps
 * @param {() => object} deps.getConfig - the current normalized configuration
 * @param {(config: object, deviceExternalId: unknown) => object | undefined} deps.resolveLocation
 * @param {(config: object, location: object) => Promise<object>} deps.read -
 *   a live VigiEau read that publishes nothing
 */
export function createSceneActions({ getConfig, resolveLocation, read }) {
  /**
   * The location a `lieu` field designates. A throw fails this action only —
   * the scene logs the message and goes on — so the message says what to fix.
   */
  function locationOf(config, fields) {
    const location = resolveLocation(config, fields?.lieu);
    if (!location || !hasCoordinates(location)) {
      throw new Error(
        "Ce lieu n'est plus surveillé par l'intégration VigiEau : choisissez-en un autre dans la scène.",
      );
    }
    return location;
  }

  return {
    async [SCENE_ACTION.READ_LEVEL](fields) {
      const config = getConfig();
      const location = locationOf(config, fields);
      return levelOutputs(location, await read(config, location));
    },

    async [SCENE_ACTION.CHECK_USAGE](fields) {
      const search = String(fields?.usage ?? '').trim();
      if (foldText(search) === '') {
        throw new Error("Indiquez l'usage à vérifier, par exemple « arrosage ».");
      }
      const config = getConfig();
      const location = locationOf(config, fields);
      return usageOutputs(await read(config, location), search);
    },
  };
}

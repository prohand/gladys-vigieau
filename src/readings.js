// -----------------------------------------------------------------------------
// What the last read of each location said — and what CHANGED since.
//
// Two memories, for two consumers, and they are not kept the same way:
//
//   - the LATEST reading (the whole summary plus when it was read), in memory
//     only. It is what the dashboard widgets render: a widget is pulled on
//     every dashboard mount, and answering from the last refresh cycle instead
//     of calling VigiEau each time keeps a free public API out of the
//     dashboard's hot path. Lost on restart, refilled by the first cycle.
//
//   - the BASELINE (level + decrees in force), PERSISTED under the off-schema
//     `last_readings` config key. It is what the scene triggers compare a new
//     read against. It has to survive a restart: an integration update or a
//     Gladys reboot restarts the container, and a decree published while it
//     was down would otherwise never fire — which is the one event a drought
//     scene exists for.
//
// A scene trigger is an EVENT ("the level went up", "a new decree came out"),
// never a state: the level itself is already a device feature, and the core's
// own device triggers handle thresholds on it. Hence the rule that runs through
// this file: the FIRST read of a location sets its baseline and fires nothing.
// An install, a location just added, an upgrade to the first version that
// keeps a baseline — none of them is something that happened to the water.
// -----------------------------------------------------------------------------

import { formatDate } from './datetime.js';
import { SEVERITY_CODES, decreeKey, severityLabel } from './vigieau.js';

// Config key holding the baselines. Off-schema, like `locations`: free internal
// storage of the integration, never displayed (see src/locations.js).
export const READINGS_KEY = 'last_readings';

// The scene triggers declared in the manifest `scene_triggers`. Keys are
// forever: a scene stores them, and a renamed key is a removed key for every
// scene using it.
export const SCENE_TRIGGER = {
  LEVEL_CHANGED: 'niveau_change',
  NEW_DECREE: 'nouvel_arrete',
};

// The two values the `sens` filter offers.
export const DIRECTION = { UP: 'hausse', DOWN: 'baisse' };

// locationId -> { summary, readAt }
const latest = new Map();
// locationId -> { level, decrees: string[] }
const baselines = new Map();

/** The last successful read of a location, or null. */
export function latestReading(locationId) {
  return latest.get(locationId) ?? null;
}

/** The baseline the next read of a location is compared against, or null. */
export function baselineOf(locationId) {
  return baselines.get(locationId) ?? null;
}

/** Drop both memories (tests). */
export function forgetReadings() {
  latest.clear();
  baselines.clear();
}

/**
 * A stored baseline, or null when it is unusable. A level outside the scale
 * would fire a change against a value that never existed.
 * @param {unknown} raw
 */
function normalizeBaseline(raw) {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const level = Number(raw.level);
  if (!Number.isInteger(level) || level < 0 || level >= SEVERITY_CODES.length) {
    return null;
  }
  const decrees = Array.isArray(raw.decrees) ? raw.decrees.map(String) : [];
  return { level, decrees };
}

/**
 * Load the persisted baselines, on (re)connection.
 *
 * Only the locations with no baseline in memory yet are filled: after a mere
 * WebSocket drop the memory is at least as recent as what was written, since
 * every write is made from it.
 * @param {unknown} raw - the `last_readings` value returned by getConfig()
 */
export function seedBaselines(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return;
  }
  for (const [locationId, stored] of Object.entries(raw)) {
    const baseline = normalizeBaseline(stored);
    if (baseline && !baselines.has(locationId)) {
      baselines.set(locationId, baseline);
    }
  }
}

/**
 * The baselines in the shape they are stored in, restricted to the locations
 * still watched: a deleted location's baseline leaves the store on the next
 * write instead of piling up.
 * @param {Array<{ id: string }>} locations
 */
export function serializeBaselines(locations = []) {
  const stored = {};
  for (const { id } of locations) {
    const baseline = baselines.get(id);
    if (baseline) {
      stored[id] = { level: baseline.level, decrees: [...baseline.decrees] };
    }
  }
  return stored;
}

/**
 * Remember a successful read, and move the baseline forward.
 *
 * A read whose overall level is unknown refreshes the widgets' memory but not
 * the baseline: comparing against a level we could not read would fire a
 * change that did not happen — or hide one that did.
 * @param {string} locationId
 * @param {ReturnType<typeof import('./vigieau.js').summarize>} summary
 * @param {Date} [readAt]
 * @returns {{ previous: { level: number, decrees: string[] } | null, changed: boolean }}
 *   the baseline BEFORE this read, and whether this read moved it (i.e. whether
 *   it has to be persisted again)
 */
export function recordReading(locationId, summary, readAt = new Date()) {
  latest.set(locationId, { summary, readAt });
  const previous = baselines.get(locationId) ?? null;
  if (summary.level === null) {
    return { previous, changed: false };
  }
  const next = {
    level: summary.level,
    decrees: (summary.decrees ?? []).map(decreeKey).filter((key) => key !== null),
  };
  const changed =
    previous === null ||
    previous.level !== next.level ||
    previous.decrees.length !== next.decrees.length ||
    next.decrees.some((key) => !previous.decrees.includes(key));
  baselines.set(locationId, next);
  return { previous, changed };
}

/** A decree's URL, when it is one a scene can hand to a notification. */
function decreeUrl(arrete) {
  const url = arrete?.cheminFichier;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
}

/**
 * The scene events a read produces, compared with the baseline before it.
 * Pure: the caller publishes them.
 *
 * `lieu` is the device external_id — what the `lieu` filter of the scene
 * editor stores, since it lists the integration's devices (`source:
 * "devices"`). `niveau` is the VigiEau code, which still tells `crise` from
 * `alerte_renforcee`. Everything else is a variable for the scene's actions,
 * in French: it ends up in a notification.
 *
 * @param {object} params
 * @param {{ name: string }} params.location
 * @param {string} params.deviceId - the location device's external_id
 * @param {{ level: number, decrees: string[] } | null} params.previous
 * @param {ReturnType<typeof import('./vigieau.js').summarize>} params.summary
 * @returns {Array<{ key: string, data: Record<string, string|number|null> }>}
 */
export function sceneEvents({ location, deviceId, previous, summary }) {
  if (previous === null || summary.level === null) {
    return [];
  }
  const common = {
    lieu: deviceId,
    nom_lieu: location.name,
    niveau_texte: severityLabel(summary.level, 'fr'),
    niveau_code: summary.level,
    nb_usages_restreints: summary.restrictedUsages.length,
  };
  const events = [];

  if (summary.level !== previous.level) {
    events.push({
      key: SCENE_TRIGGER.LEVEL_CHANGED,
      data: {
        ...common,
        niveau: SEVERITY_CODES[summary.level],
        sens: summary.level > previous.level ? DIRECTION.UP : DIRECTION.DOWN,
        niveau_precedent_texte: severityLabel(previous.level, 'fr'),
        url_arrete: decreeUrl(summary.arrete),
      },
    });
  }

  const fresh = (summary.decrees ?? []).filter(
    (arrete) => !previous.decrees.includes(decreeKey(arrete)),
  );
  if (fresh.length > 0) {
    // One event per read, not per decree: the three water types of one
    // prefecture are usually signed together, and three notifications for one
    // decision is noise. The worst zone's decree is the one worth naming when
    // it is among the new ones.
    const worst = decreeKey(summary.arrete);
    const arrete = fresh.find((candidate) => decreeKey(candidate) === worst) ?? fresh[0];
    events.push({
      key: SCENE_TRIGGER.NEW_DECREE,
      data: {
        ...common,
        date_debut: formatDate(arrete?.dateDebutValidite),
        date_fin: formatDate(arrete?.dateFinValidite),
        url_arrete: decreeUrl(arrete),
      },
    });
  }
  return events;
}

// -----------------------------------------------------------------------------
// Device type: DROUGHT ZONE ("vigilance sécheresse")
//
// One virtual device per observed location, carrying read-only sensors
// refreshed by polling:
//   - the overall severity level (0 to 3), the one to use in scenes;
//   - the same level for each water type (surface, groundwater, drinking water);
//   - the official French wording of the level, for dashboards and notifications.
//
// There is no hardware here: the "work" is an HTTP call to the VigiEau API,
// isolated in `src/vigieau.js`.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { deviceIds } from './identity.js';
import {
  AMBIGUOUS_COMMUNE,
  fetchZones,
  GLADYS_RISK_MAX,
  severityLabel,
  summarize,
  toGladysRisk,
  ZONE_TYPES,
} from '../vigieau.js';

const DEVICE_TYPE = 'drought-zone';

// Named logger from the SDK: every line is prefixed with [drought-zone].
const logger = createLogger({ name: DEVICE_TYPE });

// Floor on the refresh interval, whatever the configuration says. VigiEau is a
// free public service: hammering it for a value that changes once a day would
// be rude, and buys nothing.
export const MIN_REFRESH_SECONDS = 300;

// Feature keys, kept in one place so discovery and polling always agree.
export const FEATURE = {
  LEVEL: 'level',
  LEVEL_TEXT: 'level-text',
  LEVEL_SUP: 'level-sup',
  LEVEL_SOU: 'level-sou',
  LEVEL_AEP: 'level-aep',
};

// The per-water-type features, in the order they appear on the device.
const TYPE_FEATURES = {
  SUP: { key: FEATURE.LEVEL_SUP, name: 'Niveau eau superficielle' },
  SOU: { key: FEATURE.LEVEL_SOU, name: 'Niveau eau souterraine' },
  AEP: { key: FEATURE.LEVEL_AEP, name: 'Niveau eau potable' },
};

// Shared shape of the four severity features: a read-only risk index on the
// 0-3 scale Gladys knows how to label (see toGladysRisk).
function severityFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.RISK,
    type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
    min: 0,
    max: GLADYS_RISK_MAX,
    read_only: true, // sensor: no action possible
    has_feedback: false,
    keep_history: true, // keep history to draw the season on a chart
  };
}

/**
 * Why the last refresh failed, in the user's language.
 *
 * The ambiguous-zone case gets its own wording: it is not a transient outage
 * but a location that is not precise enough, and "VigiEau HTTP 409" tells
 * nobody that a street address is the way out.
 * @param {unknown} err
 */
function failureMessage(err) {
  if (err?.code === AMBIGUOUS_COMMUNE) {
    return {
      en: 'VigiEau cannot tell which zone applies here. Search again with a more precise address (street and number).',
      fr: "VigiEau n'arrive pas à déterminer la zone applicable ici. Relancez la recherche avec une adresse plus précise (rue et numéro).",
    };
  }
  const reason = String(err?.message ?? err).slice(0, 150);
  return {
    en: `VigiEau refresh failed: ${reason}`,
    fr: `Le rafraîchissement VigiEau a échoué : ${reason}`,
  };
}

export const droughtZone = {
  key: DEVICE_TYPE,

  // The identity does NOT depend on the configuration: the same device follows
  // the user from one address to the next, keeping its history and its place in
  // the rooms and scenes (see src/devices/identity.js).
  deviceExternalId(gladys) {
    return deviceIds(gladys, DEVICE_TYPE).device;
  },

  buildDevice(gladys, config) {
    const ids = deviceIds(gladys, DEVICE_TYPE);
    return {
      name: `Vigilance sécheresse — ${config.location_name}`,
      external_id: ids.device,
      // NO poll_frequency on purpose: Gladys only accepts a fixed enum of
      // intervals, in milliseconds, capped at one minute (60000). Polling a
      // public government API 1440 times a day for a decree that changes at
      // most once a day would be absurd, so this integration drives its own
      // refresh instead — see startPolling below.
      features: [
        severityFeature(ids.feature(FEATURE.LEVEL), 'Niveau de vigilance sécheresse'),
        {
          name: 'Niveau (texte)',
          external_id: ids.feature(FEATURE.LEVEL_TEXT),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          // Meaningless for a label, but the core column is NOT NULL and has
          // no default: a feature without min/max is refused at creation time.
          min: 0,
          max: 0,
          read_only: true,
          has_feedback: false,
          keep_history: false, // a label, not a measure: nothing to chart
        },
        ...ZONE_TYPES.map((type) =>
          severityFeature(ids.feature(TYPE_FEATURES[type].key), TYPE_FEATURES[type].name),
        ),
      ],
    };
  },

  // Manifest actions owned by this device type (see the `actions` field of
  // `gladys-assistant-integration.json`). Each key is rendered as a button in
  // the Configuration screen; the resolved message (string or multi-language
  // object) is displayed under the button, a thrown error is displayed too.
  actions: {
    async test_vigieau(gladys, { config }) {
      logger.info('Action test_vigieau -> live request to the VigiEau API');
      const { level, levelsByType } = summarize(await fetchZones(config));
      const detail = ZONE_TYPES.map((type) => `${type}: ${levelsByType[type] ?? '?'}`).join(', ');
      return {
        en: `VigiEau OK — current level: ${severityLabel(level, 'en')} (${detail}).`,
        fr: `VigiEau OK — niveau actuel : ${severityLabel(level, 'fr')} (${detail}).`,
      };
    },

    async show_restrictions(gladys, { config }) {
      logger.info('Action show_restrictions -> live request to the VigiEau API');
      const { restrictedUsages, arrete } = summarize(await fetchZones(config));
      if (restrictedUsages.length === 0) {
        return {
          en: 'No water usage is restricted at this location right now.',
          fr: "Aucun usage de l'eau n'est restreint à cette adresse actuellement.",
        };
      }
      // The message is displayed under the button: keep it short, and point at
      // the decree for the exact wording.
      const names = restrictedUsages
        .slice(0, 8)
        .map((usage) => usage.nom)
        .join(', ');
      const more = restrictedUsages.length > 8 ? `, +${restrictedUsages.length - 8}` : '';
      const decree = arrete?.cheminFichier ? ` — ${arrete.cheminFichier}` : '';
      return {
        en: `${restrictedUsages.length} restricted usage(s): ${names}${more}.${decree}`,
        fr: `${restrictedUsages.length} usage(s) restreint(s) : ${names}${more}.${decree}`,
      };
    },
  },

  async onPoll(gladys, config) {
    const ids = deviceIds(gladys, DEVICE_TYPE);
    logger.info(`Polling VigiEau for ${config.location_name}...`);

    // ------------------------------------------------------------------ //
    // DO THE WORK: read the current drought status from the VigiEau API.
    // ------------------------------------------------------------------ //
    const zones = await fetchZones(config);
    const { level, levelsByType, restrictedUsages } = summarize(zones);

    logger.info(
      `Read: level=${level ?? 'unknown'} (${ZONE_TYPES.map(
        (type) => `${type}=${levelsByType[type] ?? '?'}`,
      ).join(' ')}), ${restrictedUsages.length} restricted usage(s)`,
    );

    // An unknown level is never published: keeping the last known value beats
    // telling a watering scene that everything is fine when we simply could
    // not read the severity.
    const states = [];
    if (level !== null) {
      states.push(
        { device_feature_external_id: ids.feature(FEATURE.LEVEL), state: toGladysRisk(level) },
        // The text keeps the exact official wording, "Crise" included, which
        // the squeezed numeric scale can no longer tell from "Alerte renforcée".
        { device_feature_external_id: ids.feature(FEATURE.LEVEL_TEXT), text: severityLabel(level) },
      );
    }
    for (const type of ZONE_TYPES) {
      if (levelsByType[type] !== null) {
        states.push({
          device_feature_external_id: ids.feature(TYPE_FEATURES[type].key),
          state: toGladysRisk(levelsByType[type]),
        });
      }
    }

    if (states.length === 0) {
      throw new Error('VigiEau answered with no severity we could understand');
    }

    // Publish every value in a single request (batch, up to 100).
    await gladys.publishStates(states);
  },

  /**
   * Drive the refresh ourselves, the way the template's push sensors do.
   *
   * Gladys' own polling is not usable here: `poll_frequency` is a fixed enum
   * of intervals in milliseconds whose slowest value is one minute, while a
   * prefectoral decree changes once a day at most. So the device declares no
   * poll_frequency and we run our own timer at the configured interval.
   *
   * @returns {() => void} cleanup, to stop the timer on disconnection
   */
  startPolling(gladys, config) {
    const intervalMs = Math.max(MIN_REFRESH_SECONDS, config.poll_frequency) * 1000;
    logger.info(`Refreshing VigiEau every ${Math.round(intervalMs / 1000)} s`);

    // Refresh straight away: waiting a full hour for the first value would
    // leave the freshly added device empty on the dashboard.
    droughtZone.refresh(gladys, config);
    const timer = setInterval(() => droughtZone.refresh(gladys, config), intervalMs);
    return () => clearInterval(timer);
  },

  /**
   * One refresh cycle that NEVER throws: an outage inside a timer callback
   * would become an unhandled rejection and take the container down. The
   * outcome is reported in the Configuration screen instead, and the next
   * cycle simply tries again.
   */
  async refresh(gladys, config) {
    try {
      await droughtZone.onPoll(gladys, config);
      await gladys.setConnectionStatus(true);
    } catch (err) {
      logger.error('VigiEau refresh failed', err);
      await gladys.setConnectionStatus(false, failureMessage(err)).catch(() => {});
    }
  },
};

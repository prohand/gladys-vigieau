// -----------------------------------------------------------------------------
// Device type: DROUGHT ZONE ("vigilance sécheresse")
//
// One virtual device per observed location, carrying read-only sensors
// refreshed by polling:
//   - the overall severity level (0 to 4), the one to use in scenes;
//   - the same level for each water type (surface, groundwater, drinking water);
//   - a binary "restrictions in force", handy as a scene trigger;
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
import { locationId } from '../config.js';
import { fetchZones, severityLabel, summarize, ZONE_TYPES } from '../vigieau.js';

const DEVICE_TYPE = 'drought-zone';

// Named logger from the SDK: every line is prefixed with [drought-zone].
const logger = createLogger({ name: DEVICE_TYPE });

// Feature keys, kept in one place so discovery and polling always agree.
export const FEATURE = {
  LEVEL: 'level',
  LEVEL_TEXT: 'level-text',
  RESTRICTED: 'restricted',
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

// Shared shape of the four severity features: a read-only 0-4 risk index.
function severityFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.RISK,
    type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
    min: 0,
    max: 4,
    read_only: true, // sensor: no action possible
    has_feedback: false,
    keep_history: true, // keep history to draw the season on a chart
  };
}

export const droughtZone = {
  key: DEVICE_TYPE,

  deviceExternalId(gladys, config) {
    return gladys.externalIds(DEVICE_TYPE, locationId(config)).device;
  },

  buildDevice(gladys, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, locationId(config));
    return {
      name: `Vigilance sécheresse — ${config.location_name}`,
      external_id: ids.device,
      // Gladys calls onPoll at this interval (in seconds).
      poll_frequency: config.poll_frequency,
      features: [
        severityFeature(ids.feature(FEATURE.LEVEL), 'Niveau de vigilance sécheresse'),
        {
          name: 'Niveau (texte)',
          external_id: ids.feature(FEATURE.LEVEL_TEXT),
          category: DEVICE_FEATURE_CATEGORIES.TEXT,
          type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
          read_only: true,
          has_feedback: false,
          keep_history: false, // a label, not a measure: nothing to chart
        },
        {
          name: 'Restrictions en cours',
          external_id: ids.feature(FEATURE.RESTRICTED),
          category: DEVICE_FEATURE_CATEGORIES.INPUT,
          type: DEVICE_FEATURE_TYPES.INPUT.BINARY,
          read_only: true,
          has_feedback: false,
          keep_history: true,
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
    const ids = gladys.externalIds(DEVICE_TYPE, locationId(config));
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
        { device_feature_external_id: ids.feature(FEATURE.LEVEL), state: level },
        { device_feature_external_id: ids.feature(FEATURE.RESTRICTED), state: level > 0 ? 1 : 0 },
        { device_feature_external_id: ids.feature(FEATURE.LEVEL_TEXT), text: severityLabel(level) },
      );
    }
    for (const type of ZONE_TYPES) {
      if (levelsByType[type] !== null) {
        states.push({
          device_feature_external_id: ids.feature(TYPE_FEATURES[type].key),
          state: levelsByType[type],
        });
      }
    }

    if (states.length === 0) {
      throw new Error('VigiEau answered with no severity we could understand');
    }

    // Publish every value in a single request (batch, up to 100).
    await gladys.publishStates(states);
  },
};

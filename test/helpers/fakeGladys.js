// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - getDevices()                   -> the devices the user created
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishChangedStates / forgetPublishedStates -> the SDK's dedup, same
//     rules (exact match, heartbeat, remembered only once accepted, 100 per
//     request), on top of publishStates so a test replacing it still sees
//     what goes out
//   - setConnectionStatus            -> record calls so tests can assert them
//   - setConfig                      -> record the patches written
//   - publishSceneEvent              -> record the scene events fired
//   - requestWidgetRefresh           -> record the widget nudges
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {Array<{ external_id: string }>} [options.devices] devices already
 *   created by the user, as `GET /device` returns them
 * @param {Error} [options.getDevicesError] make getDevices fail, to test the
 *   degraded path
 */
export function createFakeGladys({ devices = [], getDevicesError = null } = {}) {
  const published = [];
  const connectionStatuses = [];
  const configWrites = [];
  const sceneEvents = [];
  const widgetNudges = [];
  // Last value Gladys accepted per feature, as the SDK remembers it.
  const publishedStates = new Map();

  return {
    published,
    connectionStatuses,
    configWrites,
    sceneEvents,
    widgetNudges,

    async getDevices() {
      if (getDevicesError) {
        throw getDevicesError;
      }
      return devices;
    },

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state,
          text: s.text,
        });
      }
    },

    async publishChangedStates(states, { heartbeat } = {}) {
      const now = Date.now();
      const previous = new Map();
      const changed = states.filter((state) => {
        const id = state.device_feature_external_id;
        const last = previous.has(id) ? previous.get(id) : publishedStates.get(id);
        previous.set(id, { state: state.state, text: state.text, at: now });
        return (
          last === undefined ||
          last.state !== state.state ||
          last.text !== state.text ||
          (heartbeat !== undefined && now - last.at >= heartbeat)
        );
      });
      for (let start = 0; start < changed.length; start += 100) {
        const batch = changed.slice(start, start + 100);
        batch.forEach(({ device_feature_external_id: id, state, text }) => {
          publishedStates.set(id, { state, text, at: now });
        });
        try {
          await this.publishStates(batch);
        } catch (err) {
          batch.forEach(({ device_feature_external_id: id }) => publishedStates.delete(id));
          throw err;
        }
      }
      return { success: true, count: changed.length };
    },

    forgetPublishedStates(externalId) {
      if (externalId === undefined) {
        publishedStates.clear();
        return;
      }
      for (const id of [...publishedStates.keys()]) {
        if (id === externalId || id.startsWith(`${externalId}:`)) {
          publishedStates.delete(id);
        }
      }
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },

    async setConfig(patch) {
      configWrites.push(patch);
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    requestWidgetRefresh(key) {
      widgetNudges.push(key);
    },
  };
}

/**
 * A realistic `GET /api/zones` payload: one zone per water type, the
 * groundwater one being the most severe.
 */
export function zonesFixture() {
  return [
    {
      id: 1201,
      code: 'SUP_75_01',
      nom: 'Seine parisienne',
      type: 'SUP',
      niveauGravite: 'alerte',
      departement: '75',
      arrete: {
        id: 4501,
        dateDebutValidite: '2026-06-01',
        dateFinValidite: '2026-10-31',
        cheminFichier: 'https://vigieau.gouv.fr/arrete/4501.pdf',
        cheminFichierArreteCadre: 'https://vigieau.gouv.fr/arrete-cadre/22.pdf',
      },
      usages: [
        {
          nom: 'Arrosage des pelouses',
          thematique: 'Espaces verts',
          description: 'Interdit de 8h a 20h.',
          concerneParticulier: true,
        },
        {
          nom: 'Lavage des vehicules',
          thematique: 'Vehicules',
          description: 'Interdit hors station professionnelle.',
          concerneParticulier: true,
        },
      ],
    },
    {
      id: 1202,
      code: 'SOU_75_01',
      nom: 'Nappe de la Beauce',
      type: 'SOU',
      niveauGravite: 'alerte_renforcee',
      departement: '75',
      arrete: {
        id: 4502,
        dateDebutValidite: '2026-06-15',
        dateFinValidite: '2026-10-31',
        cheminFichier: 'https://vigieau.gouv.fr/arrete/4502.pdf',
      },
      usages: [
        {
          nom: 'Remplissage des piscines',
          thematique: 'Piscines',
          description: 'Interdit sauf premiere mise en eau.',
          concerneParticulier: true,
        },
        // Duplicated on purpose: usages are de-duplicated by name.
        {
          nom: 'Arrosage des pelouses',
          thematique: 'Espaces verts',
          description: 'Interdit toute la journee.',
          concerneParticulier: true,
        },
      ],
    },
    {
      id: 1203,
      code: 'AEP_75_01',
      nom: 'Eau potable Paris',
      type: 'AEP',
      niveauGravite: 'vigilance',
      departement: '75',
      arrete: null,
      usages: [],
    },
  ];
}

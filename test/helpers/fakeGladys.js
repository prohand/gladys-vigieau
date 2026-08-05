// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - getDevices()                   -> the devices the user created
//   - publishState / publishStates   -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
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

  return {
    published,
    connectionStatuses,

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

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
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

// -----------------------------------------------------------------------------
// The manifest actions that EDIT the watched location list.
//
// They live here rather than in a device blueprint because they write the
// configuration back and re-publish the whole catalog — that is the registry's
// business, not a device's — and rather than in `index.js` because that file is
// wiring only, and this is the logic a user actually exercises: adding, moving,
// renaming and removing the places the integration watches.
//
// Everything the outside world provides is injected (`getConfig`,
// `saveLocations`, `resolveDevice`), so the whole set is testable without a
// Gladys server: see `test/locationActions.test.js`.
//
// Every handler resolves to a multi-language object, which the core displays
// under the button that ran it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { toCoordinate } from './coordinates.js';
import { describeAddress, resolveAddress } from './address.js';
import {
  describeLocation,
  findLocationById,
  findLocationByName,
  hasCoordinates,
  MAX_LOCATIONS,
  newLocationId,
  removeLocation,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

/**
 * Where an editing action wants to put a location: either the coordinates the
 * user typed, or the point their address geocodes to.
 *
 * Returns `{ message }` instead of `{ point }` whenever the answer is not a
 * single obvious place — a vague address is never resolved by a coin flip,
 * which would silently watch another town's drought level.
 * @param {{ adresse?: string, latitude?: string, longitude?: string }} fields
 * @returns {Promise<{ point?: object, message?: object }>}
 */
async function resolveFieldsToPoint(fields) {
  const typedLatitude = toCoordinate(fields.latitude, 'latitude');
  const typedLongitude = toCoordinate(fields.longitude, 'longitude');
  if (typedLatitude !== null && typedLongitude !== null) {
    // Typed by hand: the fields are text on purpose, so both separators work.
    // The label is cleared — it described the previous point, not this one.
    return { point: { latitude: typedLatitude, longitude: typedLongitude, address_label: '' } };
  }
  if (fields.latitude || fields.longitude) {
    return {
      message: {
        en: 'Latitude and longitude must BOTH be filled in, between -90/90 and -180/180.',
        fr: 'La latitude ET la longitude doivent être renseignées, entre -90/90 et -180/180.',
      },
    };
  }
  if (!fields.adresse) {
    return {
      message: {
        en: 'Give an address, or a latitude and a longitude.',
        fr: 'Indiquez une adresse, ou une latitude et une longitude.',
      },
    };
  }

  const { match, candidates } = await resolveAddress(fields.adresse);
  if (candidates.length === 0) {
    return {
      message: {
        en: 'No address found. Try adding the postal code or the town.',
        fr: 'Aucune adresse trouvée. Essayez d’ajouter le code postal ou la commune.',
      },
    };
  }
  if (!match) {
    // Too vague to pick one — a postal code covers several communes, and a
    // town name often exists a dozen times over.
    const list = candidates.slice(0, 6).map(describeAddress).join(' | ');
    return {
      message: {
        en: `Several addresses match, none clearly. Be more precise: ${list}`,
        fr: `Plusieurs adresses correspondent, sans évidence. Précisez : ${list}`,
      },
    };
  }
  return {
    point: {
      latitude: match.latitude,
      longitude: match.longitude,
      address_label: match.label,
    },
  };
}

/**
 * Build the four location-editing action handlers.
 * @param {object} deps
 * @param {() => object} deps.getConfig - the current normalized configuration
 * @param {(locations: Array<object>) => Promise<void>} deps.saveLocations - store
 *   the new list, re-publish the catalog and restart the refresh
 * @param {(externalId: string) => object | undefined} deps.resolveDevice - the
 *   location behind a device external_id, as the `devices` select returns it
 * @returns {Record<string, (fields: object) => Promise<object>>} handlers by key
 */
export function createLocationActions({ getConfig, saveLocations, resolveDevice }) {
  return {
    async ajouter_lieu(fields = {}) {
      logger.info(`Action ajouter_lieu <- ${fields.nom ?? ''} / ${fields.adresse ?? ''}`);
      const name = String(fields.nom ?? '').trim();
      if (name === '') {
        return { en: 'Give the location a name.', fr: 'Donnez un nom au lieu.' };
      }

      // A name that already exists UPDATES that location rather than adding a
      // twin: it is how a user fixes an address they got wrong before creating
      // the device, since the selector of the other actions only lists devices
      // that have actually been created.
      const locations = getConfig().locations;
      const existing = findLocationByName(locations, name);
      if (!existing && locations.length >= MAX_LOCATIONS) {
        return {
          en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
          fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d’abord.`,
        };
      }

      const { point, message } = await resolveFieldsToPoint(fields);
      if (!point) {
        return message;
      }

      const id = existing?.id ?? newLocationId(locations);
      await saveLocations(upsertLocation(locations, { id, name, ...point }));

      const saved = findLocationById(getConfig().locations, id);
      if (existing) {
        return {
          en: `Location "${name}" updated: ${describeLocation(saved)}. Its device now watches this address.`,
          fr: `Lieu « ${name} » mis à jour : ${describeLocation(saved)}. Son appareil suit désormais cette adresse.`,
        };
      }
      return {
        en: `Location "${name}" added: ${describeLocation(saved)}. Add its device from the Discovery tab.`,
        fr: `Lieu « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l’onglet Découverte.`,
      };
    },

    async modifier_lieu(fields = {}) {
      logger.info(`Action modifier_lieu <- ${fields.appareil ?? ''}`);
      const location = fields.appareil ? resolveDevice(fields.appareil) : undefined;
      if (!location) {
        return {
          en: 'Pick the device of the location to edit.',
          fr: 'Choisissez l’appareil du lieu à modifier.',
        };
      }

      const patch = { id: location.id };
      const name = String(fields.nom ?? '').trim();
      if (name !== '') {
        patch.name = name;
      }
      // Moving is optional: renaming a location must not blank its address.
      if (fields.adresse || fields.latitude || fields.longitude) {
        const { point, message } = await resolveFieldsToPoint(fields);
        if (!point) {
          return message;
        }
        Object.assign(patch, point);
      } else if (name === '') {
        return {
          en: 'Nothing to change: give a new name, or a new address or coordinates.',
          fr: 'Rien à modifier : indiquez un nouveau nom, ou une nouvelle adresse ou des coordonnées.',
        };
      }

      await saveLocations(upsertLocation(getConfig().locations, patch));
      const saved = findLocationById(getConfig().locations, location.id);
      // The device keeps its identity across a move, so it simply follows the
      // new address — nothing to delete, nothing to re-add.
      return {
        en: `Location updated: ${describeLocation(saved)}. Its device keeps its history.`,
        fr: `Lieu mis à jour : ${describeLocation(saved)}. Son appareil conserve son historique.`,
      };
    },

    async supprimer_lieu(fields = {}) {
      logger.info(`Action supprimer_lieu <- ${fields.appareil ?? ''} / ${fields.nom ?? ''}`);
      // Either the device selector, or the name: a location whose device has
      // never been created is not in the dropdown (the core fills it with the
      // devices that exist), and must still be removable.
      const locations = getConfig().locations;
      const location = fields.appareil
        ? resolveDevice(fields.appareil)
        : findLocationByName(locations, fields.nom);
      if (!location) {
        return {
          en: 'Pick the device of the location to delete, or type its exact name.',
          fr: 'Choisissez l’appareil du lieu à supprimer, ou saisissez son nom exact.',
        };
      }

      await saveLocations(removeLocation(locations, location.id));
      // An integration can only stop OFFERING a device; deleting it is the
      // user's move, and saying so beats leaving a sensor that never updates.
      return {
        en: `Location "${location.name}" removed. Delete its device in Gladys too: an integration cannot delete it for you.`,
        fr: `Lieu « ${location.name} » supprimé. Supprimez aussi son appareil dans Gladys : une intégration ne peut pas le faire à votre place.`,
      };
    },

    async lister_lieux() {
      logger.info('Action lister_lieux');
      const locations = getConfig().locations;
      if (locations.length === 0) {
        return {
          en: 'No location yet. Add one with "Add a location".',
          fr: 'Aucun lieu pour l’instant. Ajoutez-en un avec « Ajouter un lieu ».',
        };
      }
      const list = locations.map(describeLocation).join(' | ');
      const incomplete = locations.filter((location) => !hasCoordinates(location));
      const warning = incomplete.length
        ? {
            en: ` — ${incomplete.length} without usable coordinates, no device is published for them.`,
            fr: ` — ${incomplete.length} sans coordonnées utilisables, aucun appareil n’est publié pour eux.`,
          }
        : { en: '', fr: '' };
      return {
        en: `${locations.length}/${MAX_LOCATIONS} location(s): ${list}${warning.en}`,
        fr: `${locations.length}/${MAX_LOCATIONS} lieu(x) : ${list}${warning.fr}`,
      };
    },
  };
}

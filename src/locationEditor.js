// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES. The "Informations sur les lieux" section is a TABLE: one
// line per watched location — Nom | Adresse | Latitude | Longitude — written by
// this module and read by nobody. It is read-only in spirit: a location is not
// edited, it is added with "Ajouter un lieu" and removed with "Supprimer un
// lieu". Whatever the user types over a line is overwritten by the stored value
// on the next Save.
//
// WHY A TABLE, AND WHY THAT SHAPE. The Configuration screen is generated from
// the manifest, which is a static file, and every field it renders that is not
// a `section` is an `<input>`: no read-only widget, no multi-line one, no
// repeatable one (see ConfigSchemaForm.jsx). One line per position, in a
// `string` field the integration fills in, is therefore the only table the
// screen can draw — hence ten lines whatever the list holds, the unused ones
// left EMPTY so only the configured locations show.
//
// WHY NOTHING IS EDITABLE ANY MORE. Editing a location meant pointing those
// fields at ONE entry of the list with a dropdown, and a `select` in a manifest
// has STATIC options: `externalIntegration.validateConfigValue` reads the valid
// values straight from the manifest file, so the dropdown could only ever offer
// POSITIONS, never the location names. Worse, the core pushes nothing to a
// Configuration screen that is already open and `POST /config` answers with the
// values read BEFORE the integration's own write, so the fields kept showing
// the PREVIOUS location after every selection and saving them wrote its address
// onto the newly selected one. The guard that made that safe was more machinery
// than the feature was worth. Adding and deleting need no selection at all, and
// they are enough: a location is a point, and a point that moved is another
// location.
//
// WHY A SAVE STILL CANNOT ANSWER. The Configuration screen displays NOTHING an
// integration says about a Save: `setConnectionStatus` is rendered on the
// Supervision page and inside an `oauth2` field, nowhere else, and only an
// ACTION's result message is shown under its button. Everything the user has to
// be told therefore happens under a button — which is exactly where adding and
// deleting live.
//
// Everything the outside world provides is injected (`getConfig`, `setConfig`,
// `resolveAddress`), so the whole set is testable without a Gladys server nor a
// network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { describeAddress, resolveAddress as geocodeAddress } from './address.js';
import {
  describeLocation,
  describeLocations,
  findLocationById,
  LOCATIONS_KEY,
  locationAtPosition,
  locationRows,
  MAX_LOCATIONS,
  newLocationId,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

/**
 * Build the location manager.
 * @param {object} deps
 * @param {() => object} deps.getConfig - the current normalized configuration
 * @param {(patch: Record<string, unknown>) => Promise<void>} deps.setConfig -
 *   persist a partial configuration and refresh the in-memory one
 * @param {() => Promise<void>} deps.onLocationsChanged - re-publish the catalog
 *   and restart the refresh timers on the new list
 * @param {(location: object) => Promise<object|null>} [deps.findCreatedDevice] -
 *   the Gladys device a location has already been given, if any
 * @param {typeof geocodeAddress} [deps.resolveAddress] - injected in tests
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  findCreatedDevice = async () => null,
  resolveAddress = geocodeAddress,
}) {
  /**
   * Persist a new list and redraw the table under it.
   * @param {Array<object>} locations - the new list
   */
  async function commit(locations) {
    await setConfig({
      [LOCATIONS_KEY]: serializeLocations(locations),
      ...locationRows(locations),
    });
    await onLocationsChanged();
  }

  /**
   * Turn an address into a point, or say why it could not be one.
   * @param {string} address
   * @returns {Promise<{ point?: object, problem?: { en: string, fr: string } }>}
   */
  async function geocode(address) {
    const { match, candidates } = await resolveAddress(address);
    if (candidates.length === 0) {
      return {
        problem: {
          en: `No address found for "${address}". Try adding the postal code or the town.`,
          fr: `Aucune adresse trouvée pour « ${address} ». Essayez d’ajouter le code postal ou la commune.`,
        },
      };
    }
    if (!match) {
      // Too vague to pick one — a postal code covers several communes, and a
      // town name often exists a dozen times over. Guessing here would
      // silently watch another town's drought level.
      const list = candidates.slice(0, 6).map(describeAddress).join(' | ');
      return {
        problem: {
          en: `Several addresses match "${address}", none clearly. Be more precise: ${list}`,
          fr: `Plusieurs adresses correspondent à « ${address} », sans évidence. Précisez : ${list}`,
        },
      };
    }
    return {
      point: {
        latitude: match.latitude,
        longitude: match.longitude,
        address_label: match.label,
      },
      match,
    };
  }

  /**
   * The device a location has already been given, or null.
   *
   * Never fatal: failing to read the device list must not stop a deletion the
   * user asked for — at worst the message is the vaguer of the two.
   */
  async function createdDeviceOf(location) {
    try {
      return await findCreatedDevice(location);
    } catch (err) {
      logger.warn('Could not tell whether the location had a device', err);
      return null;
    }
  }

  return {
    /**
     * Redraw the table from the stored list, and only when it is out of step.
     *
     * Called on every connection and after every configuration the user saves:
     * the lines are config fields, so the form sends them back as it last
     * loaded them, and the core stores whatever it was handed — a location
     * added or deleted since that page load would otherwise stay on screen for
     * good. Nothing here touches the list itself: the table is a display, and
     * what it displays is authoritative.
     * @returns {Promise<boolean>} whether anything had to be rewritten
     */
    async sync() {
      const config = getConfig();
      const rows = locationRows(config.locations);
      const patch = {};
      for (const [key, value] of Object.entries(rows)) {
        if (String(config[key] ?? '') !== value) {
          patch[key] = value;
        }
      }
      if (Object.keys(patch).length === 0) {
        return false;
      }
      await setConfig(patch);
      return true;
    },

    // --- Manifest actions ---------------------------------------------------
    actions: {
      /**
       * Add a location from an address. Unchanged in spirit since 1.0: type an
       * address, the Base Adresse Nationale geocodes it, the device follows.
       */
      async rechercher_adresse(fields = {}) {
        const address = String(fields.adresse ?? '').trim();
        logger.info(`Action rechercher_adresse <- ${fields.nom ?? ''} / ${address}`);
        if (address === '') {
          return {
            en: 'Type the address of the location to add.',
            fr: 'Saisissez l’adresse du lieu à ajouter.',
          };
        }

        const { locations } = getConfig();
        if (locations.length >= MAX_LOCATIONS) {
          return {
            en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
            fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d’abord.`,
          };
        }

        const { point, match, problem } = await geocode(address);
        if (!point) {
          return problem;
        }

        // A location the user did not name is named after the town it is in —
        // "Vigilance sécheresse — Montauban" beats an empty device name.
        const name = String(fields.nom ?? '').trim() || match.city || match.label;
        const id = newLocationId(locations);
        await commit(upsertLocation(locations, { id, name, ...point }));

        const saved = findLocationById(getConfig().locations, id);
        const position = positionOf(getConfig().locations, id);
        return {
          en: `Location ${position} "${name}" added: ${describeLocation(saved)}. Add its device from the Discovery tab, and reload this page (F5) to see it in "Watched locations".`,
          fr: `Lieu ${position} « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l’onglet Découverte, et rechargez cette page (F5) pour le voir dans « Informations sur les lieux ».`,
        };
      },

      /**
       * Remove the location this action's dropdown names — by its POSITION in
       * the table, which is all a static `select` can offer.
       */
      async supprimer_lieu(fields = {}) {
        logger.info(
          `Action supprimer_lieu <- ${fields.lieu ?? ''} confirmation=${fields.confirmation ?? false}`,
        );
        const { locations } = getConfig();
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: 'Aucun lieu pour l’instant. Ajoutez-en un avec « Ajouter un lieu ».',
          };
        }

        const location = locationAtPosition(locations, fields.lieu);
        if (!location) {
          return {
            en: `There is no location ${fields.lieu}. Watched: ${describeLocations(locations)}`,
            fr: `Il n’y a pas de lieu ${fields.lieu}. Surveillés : ${describeLocations(locations)}`,
          };
        }
        if (fields.confirmation !== true) {
          // One click away from losing a location, in a screen full of
          // buttons: the checkbox is what makes it deliberate.
          return {
            en: `Tick "I confirm" to delete location ${fields.lieu} "${location.name}" (${describeLocation(location)}).`,
            fr: `Cochez « Je confirme » pour supprimer le lieu ${fields.lieu} « ${location.name} » (${describeLocation(location)}).`,
          };
        }

        // Asked BEFORE the re-publish, while the location still has an
        // external_id to look for: a device the user has already created is the
        // one case an integration cannot clean up, and it must say so precisely
        // rather than leave a sensor that never updates again.
        const created = await createdDeviceOf(location);
        await commit(removeLocation(locations, location.id));

        // Deleting the third of four locations moves the fourth up a line, and
        // the numbers of the table are what this very dropdown offers.
        const renumbered =
          positionOf(locations, location.id) < locations.length
            ? {
                en: ' The locations after it moved up one line: reload this page (F5).',
                fr: ' Les lieux suivants remontent d’une ligne : rechargez cette page (F5).',
              }
            : { en: '', fr: '' };

        if (!created) {
          // Never created: re-publishing the catalog without it is enough, the
          // Discovery screen stops offering it on the spot.
          return {
            en: `Location "${location.name}" removed, and it is no longer offered in the Discovery tab.${renumbered.en}`,
            fr: `Lieu « ${location.name} » supprimé, et il n’est plus proposé dans l’onglet Découverte.${renumbered.fr}`,
          };
        }
        // An integration can only stop OFFERING a device; deleting one the user
        // created is not something the host API lets it do, at any version.
        return {
          en: `Location "${location.name}" removed. Its device "${created.name}" still exists in Gladys and will stop updating: delete it yourself from the integration's Devices tab — an integration is not allowed to delete a device.${renumbered.en}`,
          fr: `Lieu « ${location.name} » supprimé. Son appareil « ${created.name} » existe toujours dans Gladys et ne se mettra plus à jour : supprimez-le vous-même depuis l’onglet Appareils de l’intégration — une intégration n’a pas le droit de supprimer un appareil.${renumbered.fr}`,
        };
      },
    },
  };
}

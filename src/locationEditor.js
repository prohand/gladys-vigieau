// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES: three buttons and nothing else. The watched locations are
// added with "Ajouter un lieu", listed by "Afficher les lieux" and removed with
// "Supprimer un lieu". The Configuration screen holds NO field about them.
//
// WHY EVERYTHING HAPPENS UNDER A BUTTON. The screen is generated from the
// manifest, which is a static file, and every field it renders that is not a
// `section` is an `<input>`: no read-only widget, no multi-line one, no
// repeatable one (see ConfigSchemaForm.jsx). A list built at runtime is
// therefore not something that screen can show as fields — the ten `lieu_N`
// lines this integration used to write were a table only in spirit, they could
// not be refreshed without an F5, and typing over one had to be undone on every
// save. An ACTION's result message, on the other hand, is displayed under its
// button, live, and is the ONLY thing the screen shows of what an integration
// has to say: `setConnectionStatus` is rendered on the Supervision page and
// inside an `oauth2` field, nowhere else. So the listing is an action too.
//
// WHY NOTHING IS EDITABLE. Editing a location meant designating ONE entry of the
// list with a dropdown, and a `select` in a manifest has STATIC options:
// `externalIntegration.validateConfigValue` reads the valid values straight from
// the manifest file, so the dropdown could only ever offer POSITIONS, never the
// location names. Worse, the core pushes nothing to a Configuration screen that
// is already open and `POST /config` answers with the values read BEFORE the
// integration's own write, so the fields kept showing the PREVIOUS location
// after every selection and saving them wrote its address onto the newly
// selected one. Adding and deleting need no selection at all, and they are
// enough: a location is a point, and a point that moved is another location.
//
// Everything the outside world provides is injected (`getConfig`, `setConfig`,
// `resolveAddress`), so the whole set is testable without a Gladys server nor a
// network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  describeAddress,
  resolveAddress as geocodeAddress,
  reverseAddress as reverseGeocodeAddress,
} from './address.js';
import { toCoordinate } from './coordinates.js';
import {
  describeLocation,
  describeLocations,
  findLocationById,
  LOCATION_LINE_SEPARATOR,
  LOCATIONS_KEY,
  locationAtPosition,
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
 * @param {typeof reverseGeocodeAddress} [deps.reverseAddress] - injected in tests
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  findCreatedDevice = async () => null,
  resolveAddress = geocodeAddress,
  reverseAddress = reverseGeocodeAddress,
}) {
  /**
   * Persist a new list, then re-publish the catalog on it.
   * @param {Array<object>} locations - the new list
   */
  async function commit(locations) {
    await setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
    await onLocationsChanged();
  }

  /**
   * The point typed by hand in the add form, when there is one.
   *
   * Both coordinates or neither: a lone latitude is not a point, and taking it
   * with a longitude of 0 would silently watch the Gulf of Guinea. They are
   * `string` fields — an <input type="number"> hands the front an empty value
   * for "48.8566" on a French browser, and the key is then dropped from the
   * payload — so `toCoordinate` is what parses them, comma included, and what
   * rejects a latitude of 300.
   * @param {object} fields
   * @returns {{ point?: object, problem?: { en: string, fr: string } }} both
   *   absent when the user typed no coordinate at all
   */
  function typedPoint(fields) {
    const rawLatitude = String(fields.latitude ?? '').trim();
    const rawLongitude = String(fields.longitude ?? '').trim();
    if (rawLatitude === '' && rawLongitude === '') {
      return {};
    }
    const latitude = toCoordinate(rawLatitude, 'latitude');
    const longitude = toCoordinate(rawLongitude, 'longitude');
    if (latitude === null || longitude === null) {
      return {
        problem: {
          en: `Latitude and longitude go together, in WGS-84 decimal degrees (latitude -90 to 90, longitude -180 to 180): "48.8566" and "2.3522". Received "${rawLatitude}" and "${rawLongitude}".`,
          fr: `La latitude et la longitude vont ensemble, en degrés décimaux WGS-84 (latitude de -90 à 90, longitude de -180 à 180) : « 48,8566 » et « 2,3522 ». Reçu « ${rawLatitude} » et « ${rawLongitude} ».`,
        },
      };
    }
    return { point: { latitude, longitude } };
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
   * The address a typed point falls on, or null.
   *
   * NEVER fatal, and never a reason to refuse the location: the point is what
   * is watched, the address is only the label the listing shows. A geocoder
   * outage — or a plot the Base Adresse Nationale knows no street for — must
   * not stop a user from adding coordinates they read off a map.
   * @param {{ latitude: number, longitude: number }} point
   */
  async function addressOfPoint(point) {
    try {
      return await reverseAddress(point.latitude, point.longitude);
    } catch (err) {
      logger.warn('Could not find the address of the typed point', err);
      return null;
    }
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
    // --- Manifest actions ---------------------------------------------------
    actions: {
      /**
       * Add a location, from an address or straight from a point.
       *
       * The address is still the normal way in — the Base Adresse Nationale
       * geocodes it, and nobody knows their garden's coordinates by heart. The
       * two coordinate fields are the way out of the cases geocoding cannot
       * serve: an address the BAN does not know, a plot with no street, or a
       * point read off a map because the commune spans several restriction
       * zones. Given both, they WIN over the address, which is then only kept
       * as the label of the location.
       */
      async rechercher_adresse(fields = {}) {
        const address = String(fields.adresse ?? '').trim();
        logger.info(
          `Action rechercher_adresse <- ${fields.nom ?? ''} / ${address} / ` +
            `${fields.latitude ?? ''},${fields.longitude ?? ''}`,
        );

        const typed = typedPoint(fields);
        if (typed.problem) {
          return typed.problem;
        }
        if (!typed.point && address === '') {
          return {
            en: 'Type the address of the location to add, or its latitude and its longitude.',
            fr: 'Saisissez l’adresse du lieu à ajouter, ou sa latitude et sa longitude.',
          };
        }

        const { locations } = getConfig();
        if (locations.length >= MAX_LOCATIONS) {
          return {
            en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
            fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d’abord.`,
          };
        }

        // A typed point is used as it is: the user gave the answer geocoding
        // would only have guessed at.
        const geocoded = typed.point ? null : await geocode(address);
        if (geocoded && !geocoded.point) {
          return geocoded.problem;
        }

        // Where the label of a typed point comes from. An address typed
        // alongside the coordinates is the user's own wording and is kept as
        // it is; with none, the point is looked up on the Base Adresse
        // Nationale so the location shows the real address it sits on instead
        // of repeating its own coordinates. Either way the POINT is untouched —
        // this only names it.
        const reverse = typed.point && address === '' ? await addressOfPoint(typed.point) : null;
        const point = typed.point
          ? { ...typed.point, address_label: address || reverse?.label || '' }
          : geocoded.point;
        const match = geocoded?.match ?? reverse;

        // A location the user did not name is named after the town it is in —
        // "Vigilance sécheresse — Montauban" beats an empty device name. A
        // typed point whose address could not be found has no town: the address
        // typed with it, then the point itself.
        const name =
          String(fields.nom ?? '').trim() ||
          match?.city ||
          match?.label ||
          address ||
          `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
        const id = newLocationId(locations);
        await commit(upsertLocation(locations, { id, name, ...point }));

        const saved = findLocationById(getConfig().locations, id);
        const position = positionOf(getConfig().locations, id);
        return {
          en: `Location ${position} "${name}" added: ${describeLocation(saved)}. Add its device from the Discovery tab; "Show the locations" lists them all.`,
          fr: `Lieu ${position} « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l’onglet Découverte ; « Afficher les lieux » les liste tous.`,
        };
      },

      /**
       * List the watched locations, numbered.
       *
       * This is the whole "display" side of the integration: the Configuration
       * screen shows nothing else of what it holds, and these numbers are the
       * ones the delete dropdown offers — a `select` can only hold the static
       * options the manifest declares, never the location names.
       */
      async afficher_lieux() {
        const { locations } = getConfig();
        logger.info(`Action afficher_lieux -> ${locations.length} location(s)`);
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: 'Aucun lieu pour l’instant. Ajoutez-en un avec « Ajouter un lieu ».',
          };
        }
        // One location per line, the header on its own — see describeLocations
        // for what today's Configuration screen does with those newlines.
        const listing = describeLocations(locations);
        return {
          en: `${locations.length}/${MAX_LOCATIONS} location(s), one per line, as "number. name — address (latitude, longitude)":${LOCATION_LINE_SEPARATOR}${listing}`,
          fr: `${locations.length}/${MAX_LOCATIONS} lieu(x), un par ligne, au format « numéro. nom — adresse (latitude, longitude) » :${LOCATION_LINE_SEPARATOR}${listing}`,
        };
      },

      /**
       * Remove the location this action's dropdown names — by its POSITION in
       * the list, which is all a static `select` can offer.
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

        // Deleting the third of four locations moves the fourth up a rank, and
        // those numbers are what this very dropdown offers.
        const renumbered =
          positionOf(locations, location.id) < locations.length
            ? {
                en: ' The locations after it moved up one rank: run "Show the locations" before deleting another one.',
                fr: ' Les lieux suivants remontent d’un rang : lancez « Afficher les lieux » avant d’en supprimer un autre.',
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

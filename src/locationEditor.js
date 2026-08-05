// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES. The "Le lieu à surveiller" section carries its own
// `lieu` dropdown, which points the four fields below it — name, address,
// latitude, longitude — at one entry of the list. Those fields MIRROR the
// selected location: its information is displayed, editable, and written back
// by "Enregistrer la configuration". The delete action carries a SECOND,
// independent dropdown, so removing a location never depends on what the
// section above happens to be showing. Adding stays what it always was: type
// an address, the integration geocodes it.
//
// WHY THE DROPDOWNS OFFER POSITIONS AND NOT NAMES. A `select` in a manifest has
// STATIC options: `externalIntegration.validateConfigValue` reads the valid
// values straight from the manifest file, and the only dynamic source the core
// defines, `source: "devices"`, has no server-side implementation in any
// released Gladys — checked at the v4.84.4 tag, `getDynamicOptions` exists only
// on master. Every value such a dropdown offers is refused with a 422 before
// the command reaches this container, which is exactly how a previous attempt
// failed. So the options are POSITIONS, and the `lieux` field — written by this
// integration — is what maps a position to a name.
//
// WHY A SAVE CANNOT ANSWER. The Configuration screen displays NOTHING an
// integration says about a Save: `setConnectionStatus` is rendered on the
// Supervision page and inside an `oauth2` field, nowhere else, and only an
// ACTION's result message is shown under its button. A Save that could not do
// what was asked therefore carries its reason in the `lieux` field, which the
// next page load shows.
//
// THE STALE FORM, and why `staleFields` exists. When this integration rewrites
// the detail fields (on a selection, an add or a delete), the Configuration
// screen already open in the browser keeps showing what it loaded: the core
// pushes nothing back to an open form, and `POST /config` answers with the
// values read BEFORE our own write. Saving that form would then write the
// PREVIOUS location's address onto the newly selected one. So every rewrite
// remembers what the form was showing, and the next Save treats a field still
// equal to that snapshot as "not touched" — the stored value wins. A field the
// user did actually change is applied. The snapshot then follows the tab: a
// neutralized Save rewrites the mirror fields (the core has just stored what
// the form sent) and re-arms on what the tab now displays, so the second Save
// of an unreloaded page is as harmless as the first. It only stops once the
// form and the store agree, which is what a reload achieves.
//
// Everything the outside world provides is injected (`getConfig`, `saveConfig`,
// `resolveAddress`), so the whole set is testable without a Gladys server nor a
// network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatCoordinate, toCoordinate } from './coordinates.js';
import { describeAddress, resolveAddress as geocodeAddress } from './address.js';
import { DETAIL_FIELDS, readDetailFields } from './config.js';
import {
  clampPosition,
  describeLocation,
  describeLocations,
  findLocationById,
  LOCATIONS_KEY,
  locationAtPosition,
  MAX_LOCATIONS,
  newLocationId,
  positionOf,
  removeLocation,
  SELECTION_FIELD,
  serializeLocations,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

// Config field holding the one-line list of the watched locations, written by
// this module and read by nobody else. It is the only place a user can find
// out which location "Lieu 3" is in the dropdowns — and, when a Save could not
// do what was asked, the only place its reason can be shown (the Configuration
// screen renders no message of ours outside an action's result).
export const SUMMARY_FIELD = 'lieux';

/**
 * The detail fields as they must be STORED for a location: text, canonical.
 * @param {object | null} location
 * @returns {Record<string, string>}
 */
export function detailFieldsOf(location) {
  return {
    location_name: location?.name ?? '',
    address_label: location?.address_label ?? '',
    latitude:
      location && location.latitude !== null && location.latitude !== undefined
        ? formatCoordinate(location.latitude)
        : '',
    longitude:
      location && location.longitude !== null && location.longitude !== undefined
        ? formatCoordinate(location.longitude)
        : '',
  };
}

/**
 * The same fields in a form two snapshots can be compared in: a coordinate
 * typed "48,8566" and one stored "48.8566" are the same point, and must not
 * look like an edit on every single Save.
 * @param {Record<string, string>} fields
 */
function canonical(fields) {
  const latitude = toCoordinate(fields.latitude, 'latitude');
  const longitude = toCoordinate(fields.longitude, 'longitude');
  return {
    location_name: String(fields.location_name ?? '').trim(),
    address_label: String(fields.address_label ?? '').trim(),
    // An unusable coordinate keeps its raw text: it is what the user typed,
    // and telling them so beats blanking the field they got wrong.
    latitude: latitude === null ? String(fields.latitude ?? '') : formatCoordinate(latitude),
    longitude: longitude === null ? String(fields.longitude ?? '') : formatCoordinate(longitude),
  };
}

function sameFields(a, b) {
  return DETAIL_FIELDS.every((key) => a[key] === b[key]);
}

/**
 * The fields to actually apply, given what the form sent, what it was showing
 * before we rewrote it, and what is stored now.
 *
 * A field still equal to the snapshot was never touched by the user — the form
 * simply had not been reloaded — so the stored value wins. See the header.
 * @param {Record<string, string>} incoming
 * @param {Record<string, string>} stale
 * @param {Record<string, string>} stored
 */
export function mergeStaleFields(incoming, stale, stored) {
  const merged = {};
  for (const key of DETAIL_FIELDS) {
    merged[key] = incoming[key] === stale[key] ? stored[key] : incoming[key];
  }
  return merged;
}

/**
 * Build the location manager.
 * @param {object} deps
 * @param {() => object} deps.getConfig - the current normalized configuration
 * @param {(patch: Record<string, unknown>) => Promise<void>} deps.setConfig -
 *   persist a partial configuration and refresh the in-memory one
 * @param {() => Promise<void>} deps.onLocationsChanged - re-publish the catalog
 *   and restart the refresh timers on the new list
 * @param {typeof geocodeAddress} [deps.resolveAddress] - injected in tests
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  resolveAddress = geocodeAddress,
}) {
  // What the Configuration screen was showing when we last rewrote the detail
  // fields under it. In memory on purpose: it describes an open browser tab,
  // not the install — a restarted container has no open tab to protect.
  let staleFields = null;

  // The position the open tab was loaded with. A Save carrying a different one
  // is the user having moved the dropdown, which is the only way this
  // integration can tell: the core sends the new configuration, never the old.
  // Seeded from the store on connection, so a restart never reads as a change.
  let shownPosition = null;

  /**
   * Persist a new list and/or a new selection, and rewrite the detail fields
   * to whatever the selected location holds afterwards.
   * @param {object} params
   * @param {Array<object>} params.locations - the new list
   * @param {number} params.position - the entry to point the section at
   * @param {string} [params.warning] - shown at the head of the `lieux` field
   * @param {boolean} [params.republish] - false to only write the screen, when
   *   the caller is already about to publish the catalog itself (connection)
   */
  async function commit({ locations, position, warning = '', republish = true }) {
    const selectedPosition = clampPosition(locations, position);
    const selected = locationAtPosition(locations, selectedPosition);
    const fields = detailFieldsOf(selected);
    const showing = canonical(readDetailFields(getConfig()));

    // Only arm the guard when the screen would actually be lying: rewriting a
    // field with the value it already holds changes nothing to protect.
    if (!sameFields(canonical(fields), showing)) {
      staleFields = showing;
    }

    // The dropdown is rewritten too: a position the list no longer reaches
    // would leave the screen pointing past its own end.
    shownPosition = selectedPosition;
    const summary = describeLocations(locations, selectedPosition);
    await setConfig({
      [LOCATIONS_KEY]: serializeLocations(locations),
      [SELECTION_FIELD]: String(selectedPosition),
      [SUMMARY_FIELD]: warning ? `${warning}   |   ${summary}` : summary,
      ...fields,
    });
    if (republish) {
      await onLocationsChanged();
    }
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
   * What one Save of the mirror fields does to a location.
   *
   * Split out because the dropdown and the fields travel in the SAME Save: when
   * the user moves the selection and edits at once, the edits belong to the
   * location the screen was showing, and this is what applies them there.
   * @param {object} location - the location the fields describe
   * @param {Record<string, string>} fields - what to apply, guard already run
   * @param {Record<string, string>} stored - what that location holds now
   * @returns {Promise<{ patch: object, problem: object | null }>}
   */
  async function planEdits(location, fields, stored) {
    const patch = { id: location.id };
    // Collected rather than assigned: the name and the point are edited in the
    // same Save, and the first thing that went wrong is the one shown.
    const problems = [];

    // A renamed location keeps everything else; an emptied name is refused
    // rather than applied, a device called "Vigilance sécheresse — " helps
    // nobody.
    if (fields.location_name === '') {
      problems.push({
        en: 'A location needs a name. It kept its previous one.',
        fr: 'Un lieu a besoin d’un nom. Il a conservé le précédent.',
      });
    } else if (fields.location_name !== stored.location_name) {
      patch.name = fields.location_name;
    }

    const latitude = toCoordinate(fields.latitude, 'latitude');
    const longitude = toCoordinate(fields.longitude, 'longitude');
    const coordinatesEdited =
      fields.latitude !== stored.latitude || fields.longitude !== stored.longitude;
    const addressEdited = fields.address_label !== stored.address_label;

    if (coordinatesEdited && latitude !== null && longitude !== null) {
      // Typed by hand, and they win over the address: someone who edits both
      // means the point, and the label is theirs to describe it.
      patch.latitude = latitude;
      patch.longitude = longitude;
      patch.address_label = fields.address_label;
    } else if (coordinatesEdited) {
      problems.push({
        en: 'Latitude and longitude must BOTH be valid (-90/90 and -180/180). The location kept its previous point.',
        fr: 'La latitude ET la longitude doivent être valides (-90/90 et -180/180). Le lieu a conservé son point précédent.',
      });
    } else if (addressEdited && fields.address_label !== '') {
      // The address is the natural way to move a location: geocode it and let
      // the coordinates follow.
      const { point, problem: geocodingProblem } = await geocode(fields.address_label);
      if (point) {
        Object.assign(patch, point);
      } else {
        problems.push(geocodingProblem);
      }
    } else if (addressEdited) {
      // Cleared on purpose: the point stays, it just loses its description.
      patch.address_label = '';
    }

    return { patch, problem: problems[0] ?? null };
  }

  /**
   * The one thing a Save cannot say on screen: the section now points at
   * another location, and the fields will keep showing the previous one until
   * the page is reloaded. It travels in the `lieux` field instead.
   */
  function reloadNotice(locations, position) {
    const location = locationAtPosition(locations, position);
    return `▶ Lieu ${position} « ${location?.name ?? ''} » sélectionné — rechargez la page (F5) pour voir ses informations.`;
  }

  function selectionMessage(locations, position) {
    const location = locationAtPosition(locations, position);
    return {
      en: `Location ${position} selected: ${describeLocation(location)}. Reload the page (F5) to see it in the fields.`,
      fr: `Lieu ${position} sélectionné : ${describeLocation(location)}. Rechargez la page (F5) pour le voir dans les champs.`,
    };
  }

  /** "No location yet", the answer every action owes an empty list. */
  function noLocationMessage() {
    return {
      en: 'No location yet. Add one with "Add a location".',
      fr: 'Aucun lieu pour l’instant. Ajoutez-en un avec « Ajouter un lieu ».',
    };
  }

  return {
    /** Exposed for the tests; the guard is otherwise entirely internal. */
    _staleFields: () => staleFields,

    /**
     * Write the screen from the stored state, without touching the list.
     *
     * Called once per connection: it publishes the `lieux` summary and the
     * detail fields of the selected location, which is what makes an install
     * upgraded from <= 1.2.0 — where the list has just been rebuilt from those
     * very fields — open on something coherent. The caller publishes the
     * catalog itself right after, hence `republish: false`.
     */
    async sync() {
      const { locations, selectedPosition } = getConfig();
      await commit({ locations, position: selectedPosition, republish: false });
    },

    /**
     * Apply the "Le lieu à surveiller" section: the dropdown, and what the user
     * typed in the four fields that mirror the location it points at. Called on
     * every `config-updated`.
     *
     * Resolves to a message describing what happened, or null when nothing
     * changed. Nobody can display it — the Configuration screen shows nothing
     * an integration says about a Save — so it is logged, and anything the user
     * has to know is carried into the `lieux` field, which the next page load
     * shows.
     * @returns {Promise<{ en: string, fr: string } | null>}
     */
    async applyFormEdits() {
      const config = getConfig();
      const { locations, selectedPosition } = config;
      const incoming = canonical(readDetailFields(config));

      if (locations.length === 0) {
        // Nothing to mirror. The fields are then just an empty form: adding a
        // location is what the search action is for, and creating one from here
        // would resurrect the location the user has just deleted, whose values
        // the open form is still showing.
        staleFields = null;
        shownPosition = selectedPosition;
        return null;
      }

      // The dropdown moved: the mirror fields the same Save carries describe
      // the location the screen was showing BEFORE it moved, so the edits are
      // applied there — dropping them would silently lose work — and the
      // section then switches to the newly chosen one.
      const movedFrom =
        shownPosition !== null && shownPosition !== selectedPosition
          ? locationAtPosition(locations, shownPosition)
          : null;
      const edited = movedFrom ?? locationAtPosition(locations, selectedPosition);
      const stored = canonical(detailFieldsOf(edited));

      let fields = incoming;
      if (staleFields) {
        fields = mergeStaleFields(incoming, staleFields, stored);
        staleFields = null;
      }

      if (sameFields(fields, stored)) {
        // Nothing of the user's to apply. The screen still has to be rewritten
        // when it is out of step with the store — either because the dropdown
        // moved, or because the core has just stored what a stale form sent and
        // the tab would send exactly the same thing again.
        // A dropdown pointing past the end of the list is put back too: it
        // always offers ten entries, the manifest being a file, so "Lieu 7" is
        // one click away even with two locations configured.
        const outOfRange = String(config[SELECTION_FIELD] ?? '') !== String(selectedPosition);
        if (movedFrom || outOfRange || !sameFields(incoming, stored)) {
          await commit({
            locations,
            position: selectedPosition,
            warning: movedFrom ? reloadNotice(locations, selectedPosition) : '',
            republish: false,
          });
        }
        return movedFrom ? selectionMessage(locations, selectedPosition) : null;
      }

      const { patch, problem } = await planEdits(edited, fields, stored);
      const changed = Object.keys(patch).length > 1;
      // Committed even when nothing is stored: the core has already written
      // what the form sent into the mirror fields, and leaving a refused name
      // or an impossible latitude there would show them back on the next page
      // load as if they had been accepted.
      const warnings = [
        problem ? `⚠ ${problem.fr}` : '',
        movedFrom ? reloadNotice(locations, selectedPosition) : '',
      ]
        .filter(Boolean)
        .join(' ');
      await commit({
        locations: changed ? upsertLocation(locations, patch) : locations,
        position: selectedPosition,
        warning: warnings,
      });

      const saved = findLocationById(getConfig().locations, edited.id);
      logger.info(
        `Section "Le lieu à surveiller" applied to "${saved.name}": ${describeLocation(saved)}`,
      );
      if (movedFrom) {
        return selectionMessage(locations, selectedPosition);
      }
      return (
        problem ?? {
          en: `Location updated: ${describeLocation(saved)}. Its device keeps its history.`,
          fr: `Lieu mis à jour : ${describeLocation(saved)}. Son appareil conserve son historique.`,
        }
      );
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
        // "Vigilance sécheresse — Montauban" beats an empty device name, and
        // the name is editable right after.
        const name = String(fields.nom ?? '').trim() || match.city || match.label;
        const id = newLocationId(locations);
        const next = upsertLocation(locations, { id, name, ...point });
        // Selected right away: the location you have just added is the one you
        // want to look at, and the section above now shows it — after a reload.
        await commit({ locations: next, position: positionOf(next, id) });

        const saved = findLocationById(getConfig().locations, id);
        const position = positionOf(getConfig().locations, id);
        return {
          en: `Location ${position} "${name}" added and selected: ${describeLocation(saved)}. Add its device from the Discovery tab, and reload this page (F5) to see it in "The location to watch".`,
          fr: `Lieu ${position} « ${name} » ajouté et sélectionné : ${describeLocation(saved)}. Ajoutez son appareil depuis l’onglet Découverte, et rechargez cette page (F5) pour le voir dans « Le lieu à surveiller ».`,
        };
      },

      /**
       * Remove the location picked in THIS action's own dropdown.
       *
       * Deliberately independent of the section above: deleting is not "get rid
       * of whatever I happen to be looking at", and making the two share a
       * selection is how a user ends up deleting the wrong location.
       */
      async supprimer_lieu(fields = {}) {
        logger.info(
          `Action supprimer_lieu <- ${fields.lieu ?? ''} confirmation=${fields.confirmation ?? false}`,
        );
        const { locations, selectedPosition } = getConfig();
        if (locations.length === 0) {
          return noLocationMessage();
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

        // The section above keeps looking at the SAME location, wherever the
        // deletion pushed it: positions shift, and a selection that silently
        // slid onto its neighbour would be edited by mistake.
        const stillShown = locationAtPosition(locations, selectedPosition);
        const remaining = removeLocation(locations, location.id);
        const position =
          stillShown && stillShown.id !== location.id ? positionOf(remaining, stillShown.id) : 1;
        await commit({ locations: remaining, position });

        // An integration can only stop OFFERING a device; deleting it is the
        // user's move, and saying so beats leaving a sensor that never updates.
        const reload =
          stillShown?.id === location.id && remaining.length
            ? {
                en: ` "${remaining[0].name}" is now shown in "The location to watch" — reload this page (F5).`,
                fr: ` « ${remaining[0].name} » est maintenant affiché dans « Le lieu à surveiller » — rechargez cette page (F5).`,
              }
            : { en: '', fr: '' };
        return {
          en: `Location "${location.name}" removed. Delete its device in Gladys too: an integration cannot delete it for you.${reload.en}`,
          fr: `Lieu « ${location.name} » supprimé. Supprimez aussi son appareil dans Gladys : une intégration ne peut pas le faire à votre place.${reload.fr}`,
        };
      },
    },
  };
}

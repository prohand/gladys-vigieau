// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys >= 5.1.0, manifest `widgets`).
//
// Two cards, declared in the manifest and produced here in the core's
// declarative vocabulary — no HTML, the core renders, themes and translates:
//
//   - `vigilance_lieu`  : ONE location, picked in the widget's settings among
//     the integration's devices (`source: "devices"`). Its level per water
//     type, the decree, the restricted usages one tap away.
//   - `vigilance_lieux` : every watched location on one card, one colored row
//     each — the list the Configuration screen cannot show (see CLAUDE.md).
//
// The content is built from the readings MEMORY (src/readings.js), never from a
// fresh VigiEau call per dashboard mount: the refresh cycle nudges both widgets
// once it has read, so the card follows the cycle, and the dashboard stays off
// a free public API. The only live call left is the fallback of a location the
// memory knows nothing about yet.
//
// Every text is a `{ en, fr }` pair — the core picks the user's language — and
// every text is clipped HERE to the vocabulary's bounds, so what the core
// renders is exactly what we sent (the SDK's validateWidgetContent checks it in
// the tests).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatDate, formatDateTime } from './datetime.js';
import { hasCoordinates, usableLocations } from './locations.js';
import { ZONE_TYPES, severityLabel } from './vigieau.js';

const logger = createLogger({ name: 'widgets' });

// The widget keys declared in the manifest. Keys are forever: a dashboard
// stores them.
export const WIDGET = {
  LOCATION: 'vigilance_lieu',
  OVERVIEW: 'vigilance_lieux',
};

// The only button action both widgets carry.
export const WIDGET_ACTION = { REFRESH: 'actualiser' };

// The content moves when the refresh cycle reads, and the cycle NUDGES the
// widgets then: the TTL is only the safety net, at the longest the core takes.
export const WIDGET_TTL_SECONDS = 3600;
// An error state is retried sooner: VigiEau may well be back in five minutes.
export const ERROR_TTL_SECONDS = 300;

// VigiEau paints its levels yellow, orange, red and dark red; the vocabulary
// has six semantic colors. `crise` shares `danger` with `alerte renforcée` —
// the wording next to the dot tells them apart.
const LEVEL_COLORS = ['success', 'info', 'warning', 'danger', 'danger'];

// From `alerte` on, usages ARE restricted; `vigilance` only asks for care.
const RESTRICTION_LEVEL = 2;

const TYPE_LABELS = {
  SUP: { en: 'Surface water', fr: 'Eau superficielle' },
  SOU: { en: 'Groundwater', fr: 'Eau souterraine' },
  AEP: { en: 'Drinking water', fr: 'Eau potable' },
};

// The list display of a card-list holds 8 rows at most.
const MAX_USAGE_ITEMS = 8;

/** The semantic color of a level, `neutral` when it is unknown. */
export function levelColor(level) {
  return LEVEL_COLORS[level] ?? 'neutral';
}

/** A text cut to `max` characters, the cut marked. */
export function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** The `{ en, fr }` pair of a level's wording. */
function levelText(level) {
  return { en: severityLabel(level, 'en'), fr: severityLabel(level, 'fr') };
}

/** An https URL, or null: the vocabulary refuses any other scheme. */
function httpsUrl(url) {
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

function heading(text) {
  return { type: 'text', variant: 'heading', text };
}

function refreshButton() {
  return {
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTION.REFRESH },
  };
}

/**
 * The card of a location that is no longer watched: its device outlived it
 * (an integration cannot delete a device), so the widget still points at it.
 */
export function notWatchedContent() {
  return {
    ttl_seconds: WIDGET_TTL_SECONDS,
    components: [
      heading('VigiEau'),
      {
        type: 'text',
        variant: 'body',
        text: {
          en: 'This location is no longer watched. Pick another one in the settings of this widget.',
          fr: "Ce lieu n'est plus surveillé. Choisissez-en un autre dans les réglages de ce widget.",
        },
      },
    ],
  };
}

/**
 * The card of a location VigiEau could not be read for, and that the memory
 * knows nothing about yet.
 * @param {{ name: string }} location
 * @param {unknown} err
 */
export function errorContent(location, err) {
  const reason = clip(err?.message ?? err, 200);
  return {
    ttl_seconds: ERROR_TTL_SECONDS,
    components: [
      heading(clip(location.name, 40)),
      {
        type: 'text',
        variant: 'body',
        text: {
          en: clip(`VigiEau could not be read: ${reason}`, 300),
          fr: clip(`Lecture VigiEau impossible : ${reason}`, 300),
        },
      },
      refreshButton(),
    ],
  };
}

/**
 * The card of ONE location. Pure.
 * @param {{ name: string }} location
 * @param {{ summary: ReturnType<typeof import('./vigieau.js').summarize>, readAt: Date }} reading
 */
export function locationContent(location, { summary, readAt }) {
  const { level, levelsByType, restrictedUsages, arrete } = summary;
  const decreeUrl = httpsUrl(arrete?.cheminFichier);
  const since = formatDate(arrete?.dateDebutValidite);
  const components = [heading(clip(location.name, 40))];

  if (restrictedUsages.length > MAX_USAGE_ITEMS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: `The first ${MAX_USAGE_ITEMS} of ${restrictedUsages.length} restricted uses: the decree lists them all.`,
        fr: `Les ${MAX_USAGE_ITEMS} premiers des ${restrictedUsages.length} usages restreints : l'arrêté les liste tous.`,
      },
    });
  }

  components.push(
    {
      type: 'status',
      items: [
        {
          label: { en: 'Overall level', fr: 'Niveau global' },
          value: levelText(level),
          color: levelColor(level),
        },
        ...ZONE_TYPES.map((type) => ({
          label: TYPE_LABELS[type],
          value: levelText(levelsByType[type]),
          color: levelColor(levelsByType[type]),
        })),
        {
          label: { en: 'Decree in force since', fr: 'Arrêté en vigueur depuis' },
          value: since ?? { en: 'No decree', fr: 'Aucun arrêté' },
          color: 'neutral',
        },
        {
          label: { en: 'Last read', fr: 'Dernier relevé' },
          value: formatDateTime(readAt),
          color: 'neutral',
        },
      ],
    },
    {
      type: 'value',
      value: restrictedUsages.length,
      label: { en: 'Restricted uses', fr: 'Usages restreints' },
      icon: 'slash',
      color: restrictedUsages.length > 0 ? 'warning' : 'success',
    },
  );

  if (restrictedUsages.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: restrictedUsages.slice(0, MAX_USAGE_ITEMS).map((usage) => ({
        title: clip(usage.nom, 60),
        ...(usage.thematique ? { subtitle: clip(usage.thematique, 60) } : {}),
        ...(usage.description ? { description: clip(usage.description, 2000) } : {}),
        ...(decreeUrl
          ? {
              links: [
                { url: decreeUrl, label: { en: 'Prefectoral decree', fr: 'Arrêté préfectoral' } },
              ],
            }
          : {}),
      })),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'body',
      text: {
        en: 'No water use is restricted at this location.',
        fr: "Aucun usage de l'eau n'est restreint à ce lieu.",
      },
    });
  }

  if (decreeUrl) {
    components.push({
      type: 'button',
      label: { en: 'View the decree', fr: "Voir l'arrêté" },
      icon: 'file-text',
      style: 'secondary',
      link: { url: decreeUrl },
    });
  }
  components.push(refreshButton());
  return { ttl_seconds: WIDGET_TTL_SECONDS, components };
}

/**
 * The card of EVERY watched location, one row each — at most MAX_LOCATIONS
 * (10), which is exactly what a status list holds. Pure.
 * @param {Array<{ id: string, name: string }>} locations - the usable ones
 * @param {(locationId: string) => { summary: object, readAt: Date } | null} readingOf
 */
export function overviewContent(locations, readingOf) {
  const title = heading({ en: 'Drought watch', fr: 'Vigilance sécheresse' });
  if (locations.length === 0) {
    return {
      ttl_seconds: WIDGET_TTL_SECONDS,
      components: [
        title,
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'No location watched yet: add one from the VigiEau integration page.',
            fr: "Aucun lieu surveillé pour l'instant : ajoutez-en un depuis la page de l'intégration VigiEau.",
          },
        },
      ],
    };
  }

  const readings = locations.map((location) => ({ location, reading: readingOf(location.id) }));
  const read = readings.filter(({ reading }) => reading !== null);
  const components = [title];

  if (read.length > 0) {
    const newest = new Date(Math.max(...read.map(({ reading }) => reading.readAt.getTime())));
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: `Last read: ${formatDateTime(newest)}`,
        fr: `Dernier relevé : ${formatDateTime(newest)}`,
      },
    });
  }

  components.push(
    {
      type: 'value',
      value: read.filter(({ reading }) => (reading.summary.level ?? -1) >= RESTRICTION_LEVEL)
        .length,
      label: { en: 'Under restriction', fr: 'Lieux en restriction' },
      icon: 'alert-triangle',
      color: 'neutral',
    },
    {
      type: 'status',
      items: readings.slice(0, 10).map(({ location, reading }) => ({
        label: clip(location.name, 40),
        value: reading ? levelText(reading.summary.level) : { en: 'Waiting', fr: 'En attente' },
        color: reading ? levelColor(reading.summary.level) : 'neutral',
      })),
    },
    refreshButton(),
  );
  return { ttl_seconds: WIDGET_TTL_SECONDS, components };
}

/**
 * The two widgets, their content and their button. Every dependency is
 * injected, so the whole module runs offline in the tests.
 * @param {object} deps
 * @param {() => object} deps.getConfig - the current normalized configuration
 * @param {(config: object, deviceExternalId: unknown) => object | undefined} deps.resolveLocation
 * @param {(locationId: string) => { summary: object, readAt: Date } | null} deps.readingOf
 * @param {(config: object, location: object) => Promise<object>} deps.readNow -
 *   a live read with no side effect, for a location the memory does not know
 * @param {(config: object, location: object) => Promise<object>} deps.refreshLocation -
 *   a full refresh of one location, states and scene events included
 * @param {(config: object) => Promise<{ total: number, failed: number }>} deps.refreshAll
 */
export function createWidgets({
  getConfig,
  resolveLocation,
  readingOf,
  readNow,
  refreshLocation,
  refreshAll,
}) {
  function watchedLocation(config, settings) {
    const location = resolveLocation(config, settings?.lieu);
    return location && hasCoordinates(location) ? location : null;
  }

  function checkAction(actionKey) {
    if (actionKey !== WIDGET_ACTION.REFRESH) {
      throw new Error(`Unknown widget action "${actionKey}"`);
    }
  }

  return {
    [WIDGET.LOCATION]: {
      async get({ settings } = {}) {
        const config = getConfig();
        const location = watchedLocation(config, settings);
        if (!location) {
          return notWatchedContent();
        }
        const reading = readingOf(location.id);
        if (reading) {
          return locationContent(location, reading);
        }
        try {
          return locationContent(location, {
            summary: await readNow(config, location),
            readAt: new Date(),
          });
        } catch (err) {
          logger.warn(`Widget: VigiEau could not be read for ${location.name}`, err);
          return errorContent(location, err);
        }
      },

      async action(actionKey, _params, { settings } = {}) {
        checkAction(actionKey);
        const config = getConfig();
        const location = watchedLocation(config, settings);
        if (!location) {
          throw new Error("Ce lieu n'est plus surveillé.");
        }
        const { level } = await refreshLocation(config, location);
        const name = clip(location.name, 60);
        return {
          en: `${name}: ${severityLabel(level, 'en')}`,
          fr: `${name} : ${severityLabel(level, 'fr')}`,
        };
      },
    },

    [WIDGET.OVERVIEW]: {
      async get() {
        return overviewContent(usableLocations(getConfig().locations), readingOf);
      },

      async action(actionKey) {
        checkAction(actionKey);
        const { total, failed } = await refreshAll(getConfig());
        if (failed > 0) {
          return {
            en: `${total - failed} of ${total} location(s) refreshed, ${failed} failing.`,
            fr: `${total - failed} lieu(x) actualisé(s) sur ${total}, ${failed} en échec.`,
          };
        }
        return { en: `${total} location(s) refreshed.`, fr: `${total} lieu(x) actualisé(s).` };
      },
    },
  };
}

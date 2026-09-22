import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  ERROR_TTL_SECONDS,
  WIDGET,
  WIDGET_ACTION,
  WIDGET_TTL_SECONDS,
  clip,
  createWidgets,
  errorContent,
  levelColor,
  locationContent,
  notWatchedContent,
  overviewContent,
} from '../src/widgets.js';
import { normalizeConfig } from '../src/config.js';
import { summarize } from '../src/vigieau.js';
import { zonesFixture } from './helpers/fakeGladys.js';

const MAISON = { id: 'loc-maison', name: 'Maison', latitude: '48.8566', longitude: '2.3522' };
const JARDIN = { id: 'loc-jardin', name: 'Jardin', latitude: '45.764', longitude: '4.8357' };
const config = normalizeConfig({ locations: [MAISON, JARDIN] });
const [maison, jardin] = config.locations;
const READ_AT = new Date('2026-06-15T07:26:00Z');

const reading = { summary: summarize(zonesFixture()), readAt: READ_AT };

/** Every component of a type. */
function ofType(content, type) {
  return content.components.filter((component) => component.type === type);
}

/** The content as the core would render it: nothing dropped, nothing cut. */
function assertRenderedAsSent(content) {
  assert.deepEqual(validateWidgetContent(content), []);
}

test('the location card: level per water type, decree, restricted uses', () => {
  const content = locationContent(maison, reading);
  assertRenderedAsSent(content);
  assert.equal(content.ttl_seconds, WIDGET_TTL_SECONDS);

  const [title] = ofType(content, 'text');
  assert.equal(title.variant, 'heading');
  assert.equal(title.text, 'Maison');

  const [{ items }] = ofType(content, 'status');
  assert.deepEqual(
    items.map((item) => [item.label.fr, item.value.fr ?? item.value, item.color]),
    [
      ['Niveau global', 'Alerte renforcée', 'danger'],
      ['Eau superficielle', 'Alerte', 'warning'],
      ['Eau souterraine', 'Alerte renforcée', 'danger'],
      ['Eau potable', 'Vigilance', 'info'],
      ['Arrêté en vigueur depuis', '15/06/2026', 'neutral'],
      ['Dernier relevé', '15/06/2026 09:26', 'neutral'],
    ],
  );

  const [tile] = ofType(content, 'value');
  assert.equal(tile.value, 3, 'three distinct restricted usages in the fixture');

  const [list] = ofType(content, 'card-list');
  assert.deepEqual(
    list.items.map((item) => item.title),
    ['Arrosage des pelouses', 'Lavage des vehicules', 'Remplissage des piscines'],
  );
  assert.equal(list.items[0].links[0].url, 'https://vigieau.gouv.fr/arrete/4502.pdf');

  const buttons = ofType(content, 'button');
  assert.deepEqual(buttons[0].link, { url: 'https://vigieau.gouv.fr/arrete/4502.pdf' });
  assert.deepEqual(buttons[1].action, { key: WIDGET_ACTION.REFRESH });
});

test('a location with nothing restricted says so instead of an empty list', () => {
  const content = locationContent(maison, { summary: summarize([]), readAt: READ_AT });
  assertRenderedAsSent(content);
  assert.equal(ofType(content, 'card-list').length, 0);
  const body = ofType(content, 'text').find((component) => component.variant === 'body');
  assert.match(body.text.fr, /Aucun usage/);
  assert.equal(ofType(content, 'value')[0].color, 'success');
  // No decree: no link to one.
  assert.ok(ofType(content, 'button').every((button) => !button.link));
});

test('more restricted uses than a list holds: the first 8, and a caption saying so', () => {
  const usages = Array.from({ length: 12 }, (unused, index) => ({
    nom: `Usage numéro ${index + 1}`,
    thematique: 'Divers',
    description: 'x'.repeat(3000),
  }));
  const content = locationContent(maison, {
    summary: summarize([{ type: 'SUP', niveauGravite: 'crise', usages }]),
    readAt: READ_AT,
  });
  assertRenderedAsSent(content);
  assert.equal(ofType(content, 'card-list')[0].items.length, 8);
  assert.equal(ofType(content, 'value')[0].value, 12, 'the tile keeps the real count');
  assert.match(ofType(content, 'text')[1].text.fr, /8 premiers des 12/);
});

test('a decree that is not served in https gets no link', () => {
  const zones = zonesFixture().map((zone) =>
    zone.arrete ? { ...zone, arrete: { ...zone.arrete, cheminFichier: 'http://x/y.pdf' } } : zone,
  );
  const content = locationContent(maison, { summary: summarize(zones), readAt: READ_AT });
  assertRenderedAsSent(content);
  assert.ok(ofType(content, 'button').every((button) => !button.link));
});

test('a long location name is clipped to the heading bound', () => {
  const content = locationContent({ ...maison, name: 'M'.repeat(80) }, reading);
  assertRenderedAsSent(content);
  assert.equal(ofType(content, 'text')[0].text.length, 40);
  assert.equal(clip('abc', 2), 'a…');
});

test('an unknown level is neutral, never green', () => {
  assert.equal(levelColor(null), 'neutral');
  assert.equal(levelColor(0), 'success');
  assert.equal(levelColor(4), 'danger');
});

test('the error and not-watched cards fit the vocabulary', () => {
  const error = errorContent(maison, new Error('VigiEau HTTP 503'));
  assertRenderedAsSent(error);
  assert.equal(error.ttl_seconds, ERROR_TTL_SECONDS, 'retried sooner');
  assert.match(error.components[1].text.fr, /HTTP 503/);
  assertRenderedAsSent(notWatchedContent());
});

test('the overview: one row per location, waiting until read', () => {
  const content = overviewContent([maison, jardin], (id) => (id === maison.id ? reading : null));
  assertRenderedAsSent(content);
  const [{ items }] = ofType(content, 'status');
  assert.deepEqual(
    items.map((item) => [item.label, item.value.fr, item.color]),
    [
      ['Maison', 'Alerte renforcée', 'danger'],
      ['Jardin', 'En attente', 'neutral'],
    ],
  );
  assert.equal(ofType(content, 'value')[0].value, 1, 'one location under restriction');
  assert.match(ofType(content, 'text')[1].text.fr, /15\/06\/2026 09:26/);
});

test('the overview holds the ten locations the list can hold', () => {
  const ten = normalizeConfig({
    locations: Array.from({ length: 10 }, (unused, index) => ({
      id: `loc-${index}`,
      name: `Lieu ${index}`,
      latitude: '48.8',
      longitude: `2.${index}`,
    })),
  }).locations;
  const content = overviewContent(ten, () => reading);
  assertRenderedAsSent(content);
  assert.equal(ofType(content, 'status')[0].items.length, 10);
});

test('the overview with no location points at the integration page', () => {
  const content = overviewContent([], () => null);
  assertRenderedAsSent(content);
  assert.match(content.components[1].text.fr, /Aucun lieu/);
});

/** The widgets wired on fakes, recording what they were asked. */
function widgetsWith(overrides = {}) {
  const calls = { readNow: [], refreshLocation: [], refreshAll: 0 };
  const widgets = createWidgets({
    getConfig: () => config,
    resolveLocation: (currentConfig, deviceId) =>
      currentConfig.locations.find((location) => `device:${location.id}` === deviceId),
    readingOf: () => null,
    async readNow(currentConfig, location) {
      calls.readNow.push(location.id);
      return summarize(zonesFixture());
    },
    async refreshLocation(currentConfig, location) {
      calls.refreshLocation.push(location.id);
      return summarize([]);
    },
    async refreshAll() {
      calls.refreshAll += 1;
      return { total: 2, failed: 0 };
    },
    ...overrides,
  });
  return { widgets, calls };
}

test('the location widget answers from memory when it can', async () => {
  const { widgets, calls } = widgetsWith({ readingOf: () => reading });
  const content = await widgets[WIDGET.LOCATION].get({ settings: { lieu: 'device:loc-maison' } });
  assertRenderedAsSent(content);
  assert.deepEqual(calls.readNow, [], 'no VigiEau call per dashboard mount');
});

test('the location widget reads live, once, when the memory knows nothing yet', async () => {
  const { widgets, calls } = widgetsWith();
  const content = await widgets[WIDGET.LOCATION].get({
    settings: { lieu: 'device:loc-jardin' },
    language: 'fr',
  });
  assertRenderedAsSent(content);
  assert.deepEqual(calls.readNow, ['loc-jardin']);
  assert.equal(ofType(content, 'text')[0].text, 'Jardin');
});

test('a live read that fails becomes an error card, not a failed widget', async () => {
  const { widgets } = widgetsWith({
    async readNow() {
      throw new Error('VigiEau HTTP 500');
    },
  });
  const content = await widgets[WIDGET.LOCATION].get({ settings: { lieu: 'device:loc-maison' } });
  assert.equal(content.ttl_seconds, ERROR_TTL_SECONDS);
});

test('a device whose location was deleted gets the not-watched card', async () => {
  const { widgets } = widgetsWith();
  const content = await widgets[WIDGET.LOCATION].get({ settings: { lieu: 'device:loc-gone' } });
  assert.deepEqual(content, notWatchedContent());
});

test('"Actualiser" on the location widget refreshes that location and says its level', async () => {
  const { widgets, calls } = widgetsWith();
  const message = await widgets[WIDGET.LOCATION].action(
    WIDGET_ACTION.REFRESH,
    {},
    { settings: { lieu: 'device:loc-maison' } },
  );
  assert.deepEqual(calls.refreshLocation, ['loc-maison']);
  assert.equal(message.fr, 'Maison : Pas de restriction');
  for (const text of Object.values(message)) {
    assert.ok(text.length <= 200, 'a toast holds 200 characters');
  }
  await assert.rejects(
    widgets[WIDGET.LOCATION].action(WIDGET_ACTION.REFRESH, {}, { settings: { lieu: 'x' } }),
    /plus surveillé/,
  );
});

test('"Actualiser" on the overview refreshes every location and counts failures', async () => {
  const { widgets, calls } = widgetsWith({
    refreshAll: async () => ({ total: 3, failed: 1 }),
  });
  const message = await widgets[WIDGET.OVERVIEW].action(WIDGET_ACTION.REFRESH, {}, {});
  assert.equal(message.fr, '2 lieu(x) actualisé(s) sur 3, 1 en échec.');
  assert.equal(calls.refreshAll, 0, 'the override answered');
  await assert.rejects(widgets[WIDGET.OVERVIEW].action('autre', {}, {}), /Unknown widget action/);
});

test('the overview widget lists the configured locations', async () => {
  const { widgets } = widgetsWith({ readingOf: () => reading });
  const content = await widgets[WIDGET.OVERVIEW].get({ settings: {} });
  assertRenderedAsSent(content);
  assert.equal(ofType(content, 'status')[0].items.length, 2);
});

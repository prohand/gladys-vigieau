import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DIRECTION,
  SCENE_TRIGGER,
  baselineOf,
  forgetReadings,
  latestReading,
  recordReading,
  sceneEvents,
  seedBaselines,
  serializeBaselines,
} from '../src/readings.js';
import { summarize } from '../src/vigieau.js';
import { zonesFixture } from './helpers/fakeGladys.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const MAISON = { id: 'loc-maison', name: 'Maison' };
const DEVICE = 'ext:vigieau:drought-zone:loc-maison';

beforeEach(() => {
  forgetReadings();
});

/** A summary at the given overall level, every water type at that level. */
function summaryAt(level, decrees = []) {
  const codes = ['pas_restriction', 'vigilance', 'alerte', 'alerte_renforcee', 'crise'];
  return summarize(
    ['SUP', 'SOU', 'AEP'].map((type, index) => ({
      type,
      niveauGravite: codes[level],
      arrete: decrees[index] ?? null,
      usages: level >= 2 ? [{ nom: 'Arrosage des pelouses' }] : [],
    })),
  );
}

const DECREE_A = {
  id: 11,
  dateDebutValidite: '2026-06-01',
  dateFinValidite: '2026-10-31',
  cheminFichier: 'https://vigieau.gouv.fr/arrete/11.pdf',
};
const DECREE_B = {
  id: 12,
  dateDebutValidite: '2026-07-15',
  dateFinValidite: '2026-09-30',
  cheminFichier: 'https://vigieau.gouv.fr/arrete/12.pdf',
};

test('the first read of a location sets its baseline and fires NOTHING', () => {
  // An install, a location just added, the upgrade to this version: none of
  // them is something that happened to the water.
  const summary = summaryAt(3, [DECREE_A]);
  const { previous, changed } = recordReading(MAISON.id, summary);
  assert.equal(previous, null);
  assert.equal(changed, true, 'the new baseline has to be persisted');
  assert.deepEqual(sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary }), []);
  assert.deepEqual(baselineOf(MAISON.id), { level: 3, decrees: ['11'] });
});

test('a level that rises fires niveau_change, with the VigiEau code and the direction', () => {
  recordReading(MAISON.id, summaryAt(1));
  const summary = summaryAt(4);
  const { previous } = recordReading(MAISON.id, summary);
  const [event] = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.equal(event.key, SCENE_TRIGGER.LEVEL_CHANGED);
  assert.deepEqual(event.data, {
    lieu: DEVICE,
    nom_lieu: 'Maison',
    niveau: 'crise',
    sens: DIRECTION.UP,
    niveau_texte: 'Crise',
    niveau_precedent_texte: 'Vigilance',
    niveau_code: 4,
    nb_usages_restreints: 1,
    url_arrete: null,
  });
});

test('crise vs alerte renforcée IS a change, although the risk feature reads 3 for both', () => {
  recordReading(MAISON.id, summaryAt(3));
  const summary = summaryAt(4);
  const { previous } = recordReading(MAISON.id, summary);
  const events = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGER.LEVEL_CHANGED],
  );
});

test('a level that falls says so', () => {
  recordReading(MAISON.id, summaryAt(2));
  const summary = summaryAt(0);
  const { previous } = recordReading(MAISON.id, summary);
  const [event] = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.equal(event.data.sens, DIRECTION.DOWN);
  assert.equal(event.data.niveau, 'pas_restriction');
});

test('the same level and the same decrees fire nothing, and need no write', () => {
  recordReading(MAISON.id, summaryAt(2, [DECREE_A]));
  const summary = summaryAt(2, [DECREE_A]);
  const { previous, changed } = recordReading(MAISON.id, summary);
  assert.equal(changed, false);
  assert.deepEqual(sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary }), []);
});

test('a new decree fires nouvel_arrete, even at an unchanged level', () => {
  recordReading(MAISON.id, summaryAt(2, [DECREE_A]));
  const summary = summaryAt(2, [DECREE_A, DECREE_B]);
  const { previous, changed } = recordReading(MAISON.id, summary);
  assert.equal(changed, true);
  const events = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.deepEqual(
    events.map((event) => event.key),
    [SCENE_TRIGGER.NEW_DECREE],
  );
  assert.deepEqual(events[0].data, {
    lieu: DEVICE,
    nom_lieu: 'Maison',
    niveau_texte: 'Alerte',
    niveau_code: 2,
    nb_usages_restreints: 1,
    date_debut: '15/07/2026',
    date_fin: '30/09/2026',
    url_arrete: 'https://vigieau.gouv.fr/arrete/12.pdf',
  });
});

test('several new decrees at once fire ONE event', () => {
  recordReading(MAISON.id, summaryAt(0));
  const summary = summaryAt(2, [DECREE_A, DECREE_B]);
  const { previous } = recordReading(MAISON.id, summary);
  const events = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.equal(events.filter((event) => event.key === SCENE_TRIGGER.NEW_DECREE).length, 1);
  assert.equal(events.filter((event) => event.key === SCENE_TRIGGER.LEVEL_CHANGED).length, 1);
});

test('a decree that is lifted is not a new decree', () => {
  recordReading(MAISON.id, summaryAt(2, [DECREE_A, DECREE_B]));
  const summary = summaryAt(2, [DECREE_A]);
  const { previous, changed } = recordReading(MAISON.id, summary);
  assert.equal(changed, true, 'the baseline forgets it');
  assert.deepEqual(sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary }), []);
});

test('an unknown level neither fires nor moves the baseline', () => {
  recordReading(MAISON.id, summaryAt(1));
  const unreadable = summarize([{ type: 'SUP', niveauGravite: 'niveau_martien' }]);
  const { previous, changed } = recordReading(MAISON.id, unreadable);
  assert.equal(changed, false);
  assert.deepEqual(
    sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary: unreadable }),
    [],
  );
  assert.deepEqual(baselineOf(MAISON.id), { level: 1, decrees: [] });
  // ...but the widgets still see what was read, and when.
  assert.equal(latestReading(MAISON.id).summary, unreadable);
});

test('the baselines survive a restart through the config', () => {
  recordReading(MAISON.id, summaryAt(2, [DECREE_A]));
  recordReading('loc-jardin', summaryAt(1));
  const stored = serializeBaselines([{ id: MAISON.id }]);
  assert.deepEqual(stored, { [MAISON.id]: { level: 2, decrees: ['11'] } }, 'deleted ones dropped');

  forgetReadings();
  seedBaselines(JSON.parse(JSON.stringify(stored)));
  const summary = summaryAt(3, [DECREE_A]);
  const { previous } = recordReading(MAISON.id, summary);
  const [event] = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.equal(event.key, SCENE_TRIGGER.LEVEL_CHANGED, 'a change made while down still fires');
  assert.equal(event.data.niveau_precedent_texte, 'Alerte');
});

test('seeding never overwrites a fresher memory, and ignores garbage', () => {
  recordReading(MAISON.id, summaryAt(3));
  seedBaselines({
    [MAISON.id]: { level: 0, decrees: [] },
    'loc-a': { level: 9 },
    'loc-b': 'nope',
    'loc-c': { level: 1 },
  });
  assert.equal(baselineOf(MAISON.id).level, 3);
  assert.equal(baselineOf('loc-a'), null, 'a level off the scale never existed');
  assert.equal(baselineOf('loc-b'), null);
  assert.deepEqual(baselineOf('loc-c'), { level: 1, decrees: [] });
  seedBaselines(null);
  seedBaselines([1, 2]);
});

test('every event carries every key its trigger declares — filters and variables', () => {
  // The core fills an absent declared key with null: a filter set on it would
  // then never match, and a variable would print nothing.
  recordReading(MAISON.id, summaryAt(0, []));
  const summary = summaryAt(3, [DECREE_A]);
  const { previous } = recordReading(MAISON.id, summary);
  const events = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary });
  assert.equal(events.length, 2);
  for (const { key, data } of events) {
    const declared = manifest.scene_triggers.find((trigger) => trigger.key === key);
    for (const entry of [...declared.fields, ...declared.variables]) {
      assert.ok(entry.key in data, `${key} misses "${entry.key}"`);
      if (entry.type === 'number') {
        assert.equal(typeof data[entry.key], 'number', `${key}.${entry.key}`);
      }
    }
    // Flat, scalars only — what the SDK checks before sending.
    for (const value of Object.values(data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('the fixture reads the worst zone decree as the one to name', () => {
  recordReading(MAISON.id, summarize([]));
  const summary = summarize(zonesFixture());
  const { previous } = recordReading(MAISON.id, summary);
  const decree = sceneEvents({ location: MAISON, deviceId: DEVICE, previous, summary }).find(
    (event) => event.key === SCENE_TRIGGER.NEW_DECREE,
  );
  assert.equal(decree.data.url_arrete, 'https://vigieau.gouv.fr/arrete/4502.pdf');
  assert.equal(decree.data.date_debut, '15/06/2026');
});

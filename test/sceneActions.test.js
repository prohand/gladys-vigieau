import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SCENE_ACTION,
  createSceneActions,
  foldText,
  levelOutputs,
  usageOutputs,
} from '../src/sceneActions.js';
import { normalizeConfig } from '../src/config.js';
import { summarize } from '../src/vigieau.js';
import { zonesFixture } from './helpers/fakeGladys.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const config = normalizeConfig({
  locations: [{ id: 'loc-maison', name: 'Maison', latitude: '48.8566', longitude: '2.3522' }],
});
const [maison] = config.locations;
const summary = summarize(zonesFixture());

/** The declared outputs of a scene action. */
function declaredOutputs(key) {
  return manifest.scene_actions.find((declared) => declared.key === key).outputs;
}

/** Outputs must match their declared type, or the core drops them. */
function assertMatchesDeclaration(key, outputs) {
  const declared = declaredOutputs(key);
  assert.deepEqual(Object.keys(outputs).sort(), declared.map((output) => output.key).sort());
  for (const output of declared) {
    const value = outputs[output.key];
    assert.ok(
      value === null || typeof value === output.type,
      `${key}.${output.key} is ${typeof value}, declared ${output.type}`,
    );
  }
}

test('lire_niveau hands the level on, on VigiEau scale (crise = 4)', () => {
  const outputs = levelOutputs(maison, summary);
  assertMatchesDeclaration(SCENE_ACTION.READ_LEVEL, outputs);
  assert.deepEqual(outputs, {
    nom_lieu: 'Maison',
    niveau_texte: 'Alerte renforcée',
    niveau_code: 3,
    eau_superficielle: 'Alerte',
    eau_souterraine: 'Alerte renforcée',
    eau_potable: 'Vigilance',
    nb_usages_restreints: 3,
    usages_restreints: 'Arrosage des pelouses, Lavage des vehicules, Remplissage des piscines',
    arrete_depuis: '15/06/2026',
    url_arrete: 'https://vigieau.gouv.fr/arrete/4502.pdf',
  });
  assert.equal(
    levelOutputs(maison, summarize([{ type: 'SUP', niveauGravite: 'crise' }])).niveau_code,
    4,
  );
});

test('an unknown level is left out of niveau_code, never reported as 0', () => {
  const outputs = levelOutputs(maison, summarize([{ type: 'SUP', niveauGravite: 'martien' }]));
  assert.equal(outputs.niveau_code, null, 'null is dropped by the core');
  assert.equal(outputs.niveau_texte, 'Inconnu');
});

test('verifier_usage finds a use by a word of its name, accents and case aside', () => {
  const outputs = usageOutputs(summary, 'ARROSAGE');
  assertMatchesDeclaration(SCENE_ACTION.CHECK_USAGE, outputs);
  assert.equal(outputs.restreint, true);
  assert.equal(outputs.nb_usages, 1);
  assert.equal(outputs.usages, 'Arrosage des pelouses');
  assert.match(outputs.details, /^Arrosage des pelouses : Interdit/);
  assert.equal(usageOutputs(summary, 'véhicules').usages, 'Lavage des vehicules');
  assert.equal(usageOutputs(summary, 'piscine').restreint, true, 'the theme counts too');
});

test('verifier_usage: every word must match, and the description does not count', () => {
  assert.equal(usageOutputs(summary, 'arrosage piscines').restreint, false);
  // "Interdit sauf premiere mise en eau." is prose, not the use itself.
  assert.equal(usageOutputs(summary, 'premiere').restreint, false);
  const nothing = usageOutputs(summarize([]), 'arrosage');
  assert.deepEqual(
    [nothing.restreint, nothing.nb_usages, nothing.usages],
    [false, 0, ''],
    'no restriction is an answer, not an error',
  );
});

test('foldText folds accents, case and punctuation', () => {
  assert.equal(foldText('  Arrosé, des PELOUSES !'), 'arrose des pelouses');
});

/** The handlers on fakes, recording the live reads. */
function actionsWith() {
  const reads = [];
  const actions = createSceneActions({
    getConfig: () => config,
    resolveLocation: (currentConfig, deviceId) =>
      currentConfig.locations.find((location) => `device:${location.id}` === deviceId),
    async read(currentConfig, location) {
      reads.push(location.id);
      return summary;
    },
  });
  return { actions, reads };
}

test('the handlers read the location their device designates', async () => {
  const { actions, reads } = actionsWith();
  const level = await actions[SCENE_ACTION.READ_LEVEL]({ lieu: 'device:loc-maison' });
  assert.equal(level.niveau_texte, 'Alerte renforcée');
  const usage = await actions[SCENE_ACTION.CHECK_USAGE]({
    lieu: 'device:loc-maison',
    usage: 'lavage',
  });
  assert.equal(usage.restreint, true);
  assert.deepEqual(reads, ['loc-maison', 'loc-maison']);
});

test('a deleted location or an empty search fails the action with what to fix', async () => {
  const { actions, reads } = actionsWith();
  await assert.rejects(actions[SCENE_ACTION.READ_LEVEL]({ lieu: 'device:gone' }), /plus surveillé/);
  await assert.rejects(
    actions[SCENE_ACTION.CHECK_USAGE]({ lieu: 'device:loc-maison', usage: ' ! ' }),
    /arrosage/,
  );
  assert.deepEqual(reads, [], 'nothing asked of VigiEau for a question that cannot be answered');
});

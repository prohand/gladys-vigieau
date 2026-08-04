import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZonesUrl,
  collectUsages,
  fetchZones,
  severityLabel,
  summarize,
  toSeverityLevel,
} from '../src/vigieau.js';
import { normalizeConfig } from '../src/config.js';
import { zonesFixture } from './helpers/fakeGladys.js';

const PARIS = normalizeConfig({ commune: '75056' });

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- Severity mapping --------------------------------------------------------

test('toSeverityLevel maps the five official levels', () => {
  assert.equal(toSeverityLevel('pas_restriction'), 0);
  assert.equal(toSeverityLevel('vigilance'), 1);
  assert.equal(toSeverityLevel('alerte'), 2);
  assert.equal(toSeverityLevel('alerte_renforcee'), 3);
  assert.equal(toSeverityLevel('crise'), 4);
});

test('toSeverityLevel tolerates accents, spaces and capitals', () => {
  assert.equal(toSeverityLevel('Alerte renforcée'), 3);
  assert.equal(toSeverityLevel('ALERTE-RENFORCEE'), 3);
  assert.equal(toSeverityLevel('Pas de restriction'), 0);
});

test('toSeverityLevel returns null for an unknown or missing value', () => {
  assert.equal(toSeverityLevel('niveau_inconnu'), null);
  assert.equal(toSeverityLevel(undefined), null);
  assert.equal(toSeverityLevel(null), null);
});

test('severityLabel gives the official French wording', () => {
  assert.equal(severityLabel(3), 'Alerte renforcée');
  assert.equal(severityLabel(0), 'Pas de restriction');
  assert.equal(severityLabel(null), 'Inconnu');
  assert.equal(severityLabel(null, 'en'), 'Unknown');
  assert.equal(severityLabel(4, 'en'), 'Crisis');
});

// --- URL building ------------------------------------------------------------

test('buildZonesUrl queries the commune, the mandatory input', () => {
  const url = buildZonesUrl(normalizeConfig({ commune: '69123' }));
  assert.match(url, /\/api\/zones\?/);
  assert.match(url, /commune=69123/);
  assert.match(url, /profil=particulier/);
  assert.doesNotMatch(url, /lat=/);
});

test('buildZonesUrl prefers the optional coordinates when both are filled in', () => {
  // A large commune can span several restriction zones: an exact point wins.
  const url = buildZonesUrl(
    normalizeConfig({ commune: '69123', latitude: 45.764, longitude: 4.8 }),
  );
  assert.match(url, /lat=45\.764/);
  assert.match(url, /lon=4\.8/);
  assert.doesNotMatch(url, /commune=/, 'the API takes one or the other, never both');
});

test('buildZonesUrl ignores a half-filled coordinate pair', () => {
  const url = buildZonesUrl(normalizeConfig({ commune: '69123', latitude: 45.764 }));
  assert.match(url, /commune=69123/);
  assert.doesNotMatch(url, /lat=/);
});

test('buildZonesUrl forwards the configured profile', () => {
  const url = buildZonesUrl(normalizeConfig({ commune: '75056', profil: 'exploitation' }));
  assert.match(url, /profil=exploitation/);
});

test('buildZonesUrl refuses to guess when no location is configured', () => {
  assert.throws(() => buildZonesUrl(normalizeConfig()), /INSEE commune code/);
});

// --- HTTP --------------------------------------------------------------------

test('fetchZones returns the zones of a 200 response', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => zonesFixture() });
  const zones = await fetchZones(PARIS);
  assert.equal(zones.length, 3);
  assert.equal(zones[1].type, 'SOU');
});

test('fetchZones treats a 404 as "no zone covers this location"', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  assert.deepEqual(await fetchZones(PARIS), []);
});

test('fetchZones throws on any other non-2xx response', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502 });
  await assert.rejects(() => fetchZones(PARIS), /VigiEau HTTP 502/);
});

test('fetchZones wraps a single object answer into a list', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ type: 'SUP', niveauGravite: 'crise' }),
  });
  const zones = await fetchZones(PARIS);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].niveauGravite, 'crise');
});

// --- Aggregation -------------------------------------------------------------

test('summarize reports the worst level across the water types', () => {
  const { level, levelsByType } = summarize(zonesFixture());
  assert.equal(levelsByType.SUP, 2);
  assert.equal(levelsByType.SOU, 3);
  assert.equal(levelsByType.AEP, 1);
  assert.equal(level, 3, 'the overall level is the worst of the three');
});

test('summarize reports level 0 everywhere when no zone covers the location', () => {
  const { level, levelsByType } = summarize([]);
  assert.equal(level, 0);
  assert.deepEqual(levelsByType, { SUP: 0, SOU: 0, AEP: 0 });
});

test('summarize returns null rather than a false "no restriction"', () => {
  const { level, levelsByType } = summarize([{ type: 'SOU', niveauGravite: 'niveau_martien' }]);
  assert.equal(levelsByType.SOU, null, 'an unreadable zone is not level 0');
  assert.equal(level, null, 'one unknown water type makes the overall level unknown');
});

test('summarize points at the decree of the worst zone', () => {
  const { worstZone, arrete } = summarize(zonesFixture());
  assert.equal(worstZone.type, 'SOU');
  assert.equal(arrete.cheminFichier, 'https://vigieau.gouv.fr/arrete/4502.pdf');
});

test('summarize exposes the name of each zone', () => {
  const { zoneNames } = summarize(zonesFixture());
  assert.equal(zoneNames.SOU, 'Nappe de la Beauce');
  assert.equal(zoneNames.AEP, 'Eau potable Paris');
});

test('collectUsages de-duplicates the usages shared by several zones', () => {
  const usages = collectUsages(zonesFixture());
  const names = usages.map((usage) => usage.nom);
  assert.equal(new Set(names).size, names.length, 'no usage is listed twice');
  assert.deepEqual(names.sort(), [
    'Arrosage des pelouses',
    'Lavage des vehicules',
    'Remplissage des piscines',
  ]);
});

test('collectUsages copes with zones carrying no usage at all', () => {
  assert.deepEqual(collectUsages([{ type: 'SUP' }, { type: 'SOU', usages: null }]), []);
});

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_COMMUNE,
  SEVERITY_LEVELS,
  buildZonesUrl,
  collectUsages,
  fetchZones,
  severityLabel,
  summarize,
  toGladysRisk,
  toSeverityLevel,
  zoneSeverity,
} from '../src/vigieau.js';
import { locationQuery } from '../src/locations.js';
import { zonesFixture } from './helpers/fakeGladys.js';

// What the driver is handed: ONE watched location plus the global profile,
// exactly as `locationQuery()` assembles it — never a whole configuration.
const PARIS = locationQuery({ profil: 'particulier' }, { latitude: 48.8566, longitude: 2.3522 });

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

// --- The Gladys 0-3 risk scale -----------------------------------------------

test('toGladysRisk squeezes the VigiEau scale onto the one Gladys can label', () => {
  // Gladys' BADGE_VALUE_CONVERTERS only maps 0-3; anything else, `4` included,
  // is rendered as "Inconnu". "Crise" therefore joins "Alerte renforcée".
  assert.equal(toGladysRisk(0), 0);
  assert.equal(toGladysRisk(1), 1);
  assert.equal(toGladysRisk(2), 2);
  assert.equal(toGladysRisk(3), 3);
  assert.equal(toGladysRisk(4), 3, 'crise must not fall through to "Inconnu"');
});

test('toGladysRisk never invents a value for an unknown level', () => {
  assert.equal(toGladysRisk(null), null);
  assert.equal(toGladysRisk(undefined), null);
});

test('every VigiEau level maps inside the range the feature declares', () => {
  for (const level of Object.values(SEVERITY_LEVELS)) {
    const mapped = toGladysRisk(level);
    assert.ok(mapped >= 0 && mapped <= 3, `level ${level} maps outside 0-3`);
  }
});

// --- URL building ------------------------------------------------------------

test('buildZonesUrl always queries by point, never by commune', () => {
  // The commune path answers 409 as soon as it spans several zones of one
  // water type, and no retry can fix that.
  const url = buildZonesUrl({ latitude: 45.764, longitude: 4.8, profil: 'particulier' });
  assert.match(url, /\/api\/zones\?/);
  assert.match(url, /lat=45\.764/);
  assert.match(url, /lon=4\.8/);
  assert.match(url, /profil=particulier/);
  assert.doesNotMatch(url, /commune=/);
});

test('buildZonesUrl forwards the configured profile', () => {
  const url = buildZonesUrl({ ...PARIS, profil: 'exploitation' });
  assert.match(url, /profil=exploitation/);
});

test('buildZonesUrl refuses to guess when no location is configured', () => {
  assert.throws(() => buildZonesUrl({ profil: 'particulier' }), /search for your address/);
  // Half a point is none — and an absent longitude must not reach the query
  // string as the literal "undefined".
  assert.throws(
    () => buildZonesUrl({ latitude: 45.7, profil: 'particulier' }),
    /search for your address/,
  );
});

// --- Severity of one zone ----------------------------------------------------

test('zoneSeverity reads the current niveauGravite field', () => {
  assert.equal(zoneSeverity({ type: 'AEP', niveauGravite: 'crise' }), 4);
});

test('zoneSeverity falls back to the older niveauAlerte field', () => {
  // The previous generation of the API named it differently and spelled the
  // levels out in French; the normalizer copes with both.
  assert.equal(zoneSeverity({ type: 'SUP', niveauAlerte: 'Alerte renforcée' }), 3);
});

test('a zone published without any severity means "no restriction"', () => {
  // VigiEau pads the water types it has no real zone for with placeholders
  // carrying only `type` and the municipal decree URL. Reading those as
  // "unknown" reported "Inconnu" for a whole commune with nothing in force.
  assert.equal(zoneSeverity({ type: 'AEP', arreteMunicipalCheminFichier: 'x.pdf' }), 0);
  assert.equal(zoneSeverity({ type: 'AEP', niveauGravite: null }), 0);
  assert.equal(zoneSeverity({ type: 'AEP', niveauGravite: '  ' }), 0);
});

test('zoneSeverity still refuses a wording it does not know', () => {
  assert.equal(zoneSeverity({ type: 'AEP', niveauGravite: 'niveau_martien' }), null);
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

test('fetchZones tags the 409 that means "this commune is ambiguous"', async () => {
  // "La commune comporte plusieurs zones d'alerte de même type." Retrying will
  // never help — only coordinates can settle it — so the caller must be able
  // to tell this apart from an outage.
  globalThis.fetch = async () => ({ ok: false, status: 409 });
  await assert.rejects(
    () => fetchZones(PARIS),
    (err) => {
      assert.equal(err.code, AMBIGUOUS_COMMUNE);
      assert.match(err.message, /single zone/);
      return true;
    },
  );
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

test('summarize reports "no restriction" for a commune padded with placeholders', () => {
  // The shape VigiEau returns for a commune under a municipal decree only.
  const { level, levelsByType } = summarize([
    { id: null, type: 'AEP', arreteMunicipalCheminFichier: 'https://x/am.pdf' },
    { id: null, type: 'SUP', arreteMunicipalCheminFichier: 'https://x/am.pdf' },
    { id: null, type: 'SOU', arreteMunicipalCheminFichier: 'https://x/am.pdf' },
  ]);
  assert.equal(level, 0, 'nothing in force must read "Pas de restriction", not "Inconnu"');
  assert.deepEqual(levelsByType, { SUP: 0, SOU: 0, AEP: 0 });
});

test('a real level still wins over a placeholder zone of another type', () => {
  const { level, levelsByType } = summarize([
    { type: 'AEP', niveauGravite: 'alerte' },
    { id: null, type: 'SUP', arreteMunicipalCheminFichier: 'https://x/am.pdf' },
  ]);
  assert.equal(levelsByType.AEP, 2);
  assert.equal(levelsByType.SUP, 0);
  assert.equal(level, 2);
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

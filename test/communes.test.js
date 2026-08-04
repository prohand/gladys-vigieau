import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCommune,
  normalizeName,
  pickCommune,
  resolveCommune,
  searchCommunes,
} from '../src/communes.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the API Géo with a fixed payload, and record the URL called. */
function stubGeoApi(payload, status = 200) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
  return calls;
}

const BORDEAUX = {
  nom: 'Bordeaux',
  code: '33063',
  codesPostaux: ['33000', '33100', '33200', '33300', '33800'],
  departement: { code: '33', nom: 'Gironde' },
};

const SAINTE_MARIE = [
  { nom: 'Sainte-Marie', code: '08383', codesPostaux: ['08390'], departement: { nom: 'Ardennes' } },
  { nom: 'Sainte-Marie', code: '15187', codesPostaux: ['15190'], departement: { nom: 'Cantal' } },
  { nom: 'Sainte-Marie', code: '25523', codesPostaux: ['25113'], departement: { nom: 'Doubs' } },
];

// --- Name normalization ------------------------------------------------------

test('normalizeName makes accents, case and punctuation irrelevant', () => {
  assert.equal(normalizeName('Saint-Étienne'), 'saint etienne');
  assert.equal(normalizeName('SAINT ETIENNE'), 'saint etienne');
  assert.equal(normalizeName("L'Isle-sur-la-Sorgue"), 'l isle sur la sorgue');
  assert.equal(normalizeName(undefined), '');
});

// --- Search ------------------------------------------------------------------

test('searchCommunes queries by name and boosts the populated communes', async () => {
  const calls = stubGeoApi([BORDEAUX]);
  const communes = await searchCommunes({ nom: 'Bordeaux' });

  assert.match(calls[0], /\/communes\?/);
  assert.match(calls[0], /nom=Bordeaux/);
  assert.match(calls[0], /boost=population/, 'typing "Paris" must not surface a hamlet');
  assert.deepEqual(communes, [
    {
      code: '33063',
      nom: 'Bordeaux',
      departement: 'Gironde',
      codesPostaux: ['33000', '33100', '33200', '33300', '33800'],
    },
  ]);
});

test('searchCommunes queries by postal code when one is given', async () => {
  const calls = stubGeoApi([BORDEAUX]);
  await searchCommunes({ codePostal: '33000' });
  assert.match(calls[0], /codePostal=33000/);
  assert.doesNotMatch(calls[0], /nom=/, 'the postal code is the more selective criterion');
});

test('searchCommunes narrows a postal-code answer down with the name', async () => {
  stubGeoApi([
    { nom: 'Cenon', code: '33119', departement: { nom: 'Gironde' } },
    { nom: 'Bordeaux', code: '33063', departement: { nom: 'Gironde' } },
  ]);
  const communes = await searchCommunes({ nom: 'Bordeaux', codePostal: '33100' });
  assert.equal(communes.length, 1);
  assert.equal(communes[0].code, '33063');
});

test('searchCommunes keeps the whole postal-code answer when the name matches nothing', async () => {
  stubGeoApi([{ nom: 'Cenon', code: '33119', departement: { nom: 'Gironde' } }]);
  const communes = await searchCommunes({ nom: 'Bordoo', codePostal: '33150' });
  assert.equal(communes.length, 1, 'a typo must not silently empty the result');
});

test('searchCommunes falls back to the department code when it has no name', async () => {
  stubGeoApi([{ nom: 'Ajaccio', code: '2A004', departement: { code: '2A' } }]);
  const [commune] = await searchCommunes({ nom: 'Ajaccio' });
  assert.equal(commune.departement, '2A');
  assert.equal(commune.code, '2A004');
});

test('searchCommunes refuses an empty query', async () => {
  await assert.rejects(() => searchCommunes({}), /at least a commune name or a postal code/);
});

test('searchCommunes rejects something that is not a postal code', async () => {
  // The most likely paste here is an INSEE code or a department number.
  await assert.rejects(() => searchCommunes({ codePostal: '33' }), /not a 5-digit postal code/);
});

test('searchCommunes surfaces an API outage', async () => {
  stubGeoApi(null, 503);
  await assert.rejects(() => searchCommunes({ nom: 'Bordeaux' }), /API Géo HTTP 503/);
});

test('searchCommunes tolerates a payload that is not a list', async () => {
  stubGeoApi({ message: 'oops' });
  assert.deepEqual(await searchCommunes({ nom: 'Bordeaux' }), []);
});

// --- Disambiguation ----------------------------------------------------------

test('pickCommune accepts a single result', () => {
  assert.equal(pickCommune([{ code: '33063', nom: 'Bordeaux' }], { nom: 'bordo' }).code, '33063');
});

test('pickCommune picks the single exact name match among several results', () => {
  const communes = [
    { code: '33063', nom: 'Bordeaux' },
    { code: '33065', nom: 'Bordeaux-Nord' },
  ];
  assert.equal(pickCommune(communes, { nom: 'Bordeaux' }).code, '33063');
});

test('pickCommune refuses to guess between homonyms', () => {
  // Twelve "Sainte-Marie" exist: choosing one at random would silently watch
  // the drought level of another town.
  assert.equal(pickCommune(SAINTE_MARIE, { nom: 'Sainte-Marie' }), null);
  assert.equal(pickCommune(SAINTE_MARIE, { nom: '' }), null);
});

test('pickCommune returns null on an empty result', () => {
  assert.equal(pickCommune([], { nom: 'Bordeaux' }), null);
});

// --- Presentation ------------------------------------------------------------

test('describeCommune shows the department and the INSEE code', () => {
  const line = describeCommune({
    code: '33063',
    nom: 'Bordeaux',
    departement: 'Gironde',
    codesPostaux: ['33000'],
  });
  assert.match(line, /Bordeaux/);
  assert.match(line, /Gironde/);
  assert.match(line, /33000/);
  assert.match(line, /33063/);
});

test('describeCommune copes with a commune missing its optional fields', () => {
  assert.equal(describeCommune({ code: '33063', nom: 'Bordeaux' }), 'Bordeaux : 33063');
});

// --- Orchestration -----------------------------------------------------------

test('resolveCommune resolves an unambiguous name to one commune', async () => {
  stubGeoApi([BORDEAUX]);
  const { commune, candidates } = await resolveCommune({ nom: 'Bordeaux' });
  assert.equal(commune.code, '33063');
  assert.equal(candidates.length, 1);
});

test('resolveCommune hands the candidates back when it cannot decide', async () => {
  stubGeoApi(SAINTE_MARIE);
  const { commune, candidates } = await resolveCommune({ nom: 'Sainte-Marie' });
  assert.equal(commune, null);
  assert.equal(candidates.length, 3);
});

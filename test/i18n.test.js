import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, inEveryLanguage, quote } from '../src/i18n.js';

test('every message speaks the four languages of the Gladys interface, English first', () => {
  assert.deepEqual(LANGUAGES, ['en', 'fr', 'de', 'es']);
});

test('inEveryLanguage builds one text per language', () => {
  assert.deepEqual(
    inEveryLanguage((language) => `[${language}]`),
    { en: '[en]', fr: '[fr]', de: '[de]', es: '[es]' },
  );
});

test('quote follows the typography of each language', () => {
  assert.equal(quote('Maison', 'en'), '"Maison"');
  assert.equal(quote('Maison', 'fr'), '« Maison »');
  assert.equal(quote('Maison', 'de'), '„Maison“');
  assert.equal(quote('Maison', 'es'), '«Maison»');
  assert.equal(quote('Maison', 'it'), '"Maison"', 'English quotes for any other language');
});

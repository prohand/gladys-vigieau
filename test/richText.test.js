// -----------------------------------------------------------------------------
// The only emphasis the Configuration screen can render.
//
// What these tests pin: bold is bold CHARACTERS (markup is escaped by
// ActionsCard.jsx, so `<b>` would reach the user as three characters), and a
// label the block cannot spell — anything with an accent — stays plain instead
// of rendering half in one typeface and half in another.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boldLabel } from '../src/richText.js';
import { plain } from './helpers/text.js';

test('letters and digits become their bold twins', () => {
  assert.equal(boldLabel('A'), '\u{1D400}');
  assert.equal(boldLabel('a'), '\u{1D41A}');
  assert.equal(boldLabel('0'), '\u{1D7CE}');
  assert.equal(
    boldLabel('12. Maison'),
    '\u{1D7CF}\u{1D7D0}. \u{1D40C}\u{1D41A}\u{1D422}\u{1D42C}\u{1D428}\u{1D427}',
  );
});

test('punctuation and spaces are copied as they are', () => {
  // They carry no weight of their own: nothing looks mixed, and the dot after
  // the number stays the dot the delete dropdown's numbers are read with.
  assert.match(boldLabel('3. Saint-Jean (2)'), /^[^A-Za-z0-9]*\u{1D7D1}\. /u);
  assert.ok(boldLabel('3. Saint-Jean (2)').includes('-'));
  assert.ok(boldLabel('3. Saint-Jean (2)').includes(' ('));
});

test('a label holding a letter with no bold twin stays entirely plain', () => {
  // There is no bold "é" in the Mathematical Alphanumeric Symbols block, and
  // French town names are full of them. Bolding the rest would render the word
  // in two typefaces mid-word — a rendering bug, not emphasis.
  assert.equal(boldLabel('2. Chalet d’été'), '2. Chalet d’été');
  assert.equal(boldLabel('4. Besançon'), '4. Besançon');
});

test('what is bolded still reads as itself once the bold is undone', () => {
  // The label is a device name and a position, not decoration: the test helper
  // reading it back is what keeps the assertions of the other files honest.
  assert.equal(plain(boldLabel('7. Jardin')), '7. Jardin');
});

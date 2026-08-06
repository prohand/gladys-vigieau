// -----------------------------------------------------------------------------
// Emphasis in a message the Configuration screen displays.
//
// WHY THIS IS UNICODE AND NOT MARKUP. An action's result message is the only
// thing that screen shows of what an integration has to say, and it is rendered
// as the TEXT CHILD of a plain `<div class="alert">` (ActionsCard.jsx, checked
// on master as well as at v4.84.4): React escapes it, so `<b>` reaches the user
// as the four characters `<b>`. There is no Markdown pass either. The only bold
// that survives is bold CHARACTERS — the Mathematical Alphanumeric Symbols
// block, which carries a bold twin of every ASCII letter and digit.
//
// WHAT IT COSTS, and why it is used on labels only. Those code points are not
// letters to anything but a font: a screen reader announces them one by one or
// skips them, a browser's find-in-page will not match them, and copying the text
// out yields characters no search engine folds back. So they go on the SHORT
// label that opens a list entry — the number and the name, which the eye uses to
// find its way between ten lines — and never on the address, the level wording
// or the restriction names, which are the content the user actually reads,
// searches and copies.
//
// The block stops at ASCII: there is no bold "é", and none of the accented
// letters French town names are full of. A label mixing bold ASCII and plain
// accents renders in two different typefaces mid-word, which looks like a
// rendering bug rather than emphasis — so a label holding one of them stays
// entirely plain. Emphasis is a hint; it degrades quietly.
// -----------------------------------------------------------------------------

// First code point of each bold run: 𝐀 (U+1D400), 𝐚 (U+1D41A), 𝟎 (U+1D7CE).
const BOLD_UPPER_A = 0x1d400;
const BOLD_LOWER_A = 0x1d41a;
const BOLD_ZERO = 0x1d7ce;

/**
 * The bold twin of one character, or null when it has none.
 * @param {string} char - a single code point
 * @returns {string | null}
 */
function boldChar(char) {
  const code = char.codePointAt(0);
  if (code >= 0x41 && code <= 0x5a) {
    return String.fromCodePoint(BOLD_UPPER_A + code - 0x41);
  }
  if (code >= 0x61 && code <= 0x7a) {
    return String.fromCodePoint(BOLD_LOWER_A + code - 0x61);
  }
  if (code >= 0x30 && code <= 0x39) {
    return String.fromCodePoint(BOLD_ZERO + code - 0x30);
  }
  return null;
}

/**
 * A short label in bold, or unchanged when it cannot be bold as a whole.
 *
 * Punctuation, spaces and separators are copied as they are — they carry no
 * weight of their own, so nothing looks mixed. A LETTER or a DIGIT with no bold
 * twin (an accent, a non-Latin script) gives up on the whole label: see the
 * header for why half a bold word is worse than no bold at all.
 * @param {unknown} label
 * @returns {string}
 */
export function boldLabel(label) {
  const text = String(label ?? '');
  let bold = '';
  for (const char of text) {
    const twin = boldChar(char);
    if (twin !== null) {
      bold += twin;
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      return text;
    } else {
      bold += char;
    }
  }
  return bold;
}

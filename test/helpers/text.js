// -----------------------------------------------------------------------------
// Reading an action's message back as plain text, for the assertions.
//
// The label opening a list entry is emphasized with the Unicode bold letters
// (see src/richText.js — markup is escaped by the Configuration screen, so those
// characters are the only emphasis that survives). They are not the letters they
// look like: /Maison/ does not match "𝐌𝐚𝐢𝐬𝐨𝐧". A test that cares about the
// WORDING asserts on `plain(message)`; a test that cares about the FORMAT
// asserts on the raw message, with `boldLabel` to spell out what it expects.
// -----------------------------------------------------------------------------

const BOLD_UPPER_A = 0x1d400;
const BOLD_LOWER_A = 0x1d41a;
const BOLD_ZERO = 0x1d7ce;

/** The ASCII behind the bold code points. */
export function plain(text) {
  return String(text).replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => {
    const code = char.codePointAt(0);
    if (code >= BOLD_UPPER_A && code < BOLD_UPPER_A + 26) {
      return String.fromCharCode(0x41 + code - BOLD_UPPER_A);
    }
    if (code >= BOLD_LOWER_A && code < BOLD_LOWER_A + 26) {
      return String.fromCharCode(0x61 + code - BOLD_LOWER_A);
    }
    if (code >= BOLD_ZERO && code < BOLD_ZERO + 10) {
      return String.fromCharCode(0x30 + code - BOLD_ZERO);
    }
    return char;
  });
}

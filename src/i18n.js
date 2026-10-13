// -----------------------------------------------------------------------------
// The languages every user-facing message is written in.
//
// The core renders a multi-language object in the reader's language and falls
// back on `en` for any other: every message the integration RETURNS (action
// answers, connection status, widget texts) therefore carries all four of the
// languages the Gladys interface speaks. Device and feature names, and the text
// states, are not concerned: they are plain strings stored once, and stay
// French like the VigiEau decrees they quote (see CLAUDE.md).
// -----------------------------------------------------------------------------

/** The languages of a multi-language message, `en` first: the core's fallback. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * One message, built language by language.
 * @param {(language: string) => string} build
 * @returns {Record<string, string>}
 */
export function inEveryLanguage(build) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));
}

/**
 * A name quoted the way each language quotes — a location or a house is named
 * by the user, and the quotes are what set it apart from the sentence around it.
 * @param {string} text
 * @param {string} language
 */
export function quote(text, language) {
  switch (language) {
    case 'fr':
      return `« ${text} »`;
    case 'de':
      return `„${text}“`;
    case 'es':
      return `«${text}»`;
    default:
      return `"${text}"`;
  }
}

// Pure language-resolution helper for the engine's i18n support. Kept free of
// browser globals so it can be unit-tested headlessly (engine.js passes in
// navigator.languages).

/**
 * Picks the active language from the languages a game ships and the user's
 * preference list. Preference tags are matched case-insensitively against the
 * available codes, first as the exact tag (e.g. "pt-BR"), then by base code
 * (e.g. "pt").
 *
 * @param {string[]} [available] - Language codes the game has a locale file for
 *   (the manifest's `locales` keys).
 * @param {readonly string[]} [preferred] - User preference list, most preferred
 *   first (typically `navigator.languages`).
 * @param {string} [fallback='en'] - Language used when no preference matches.
 * @returns {string} The resolved language code: the first preference with an
 *   available match, else the fallback, else the first available language.
 */
/**
 * Locale-aware list joining ("A, B, and C" in English, with each language's
 * own separators and conjunction) — list grammar never lives in code.
 *
 * @param {string|undefined} language - The active language code (engine.language).
 * @param {string[]} items - The list entries.
 * @returns {string}
 */
export function formatList(language, items) {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
}

/**
 * Whether a count is grammatically singular in the given language —
 * message keys split into One-variants use this to pick the right one.
 *
 * @param {string|undefined} language - The active language code (engine.language).
 * @param {number} count
 * @returns {boolean}
 */
export function isOne(language, count) {
  return new Intl.PluralRules(language).select(count) === 'one';
}

export function resolveLanguage(available = [], preferred = [], fallback = 'en') {
  const norm = (tag) => String(tag).toLowerCase();
  for (const tag of preferred) {
    const exact = available.find(lang => norm(lang) === norm(tag));
    if (exact) return exact;
    const base = norm(tag).split('-')[0];
    const baseMatch = available.find(lang => norm(lang) === base);
    if (baseMatch) return baseMatch;
  }
  if (available.length === 0 || available.includes(fallback)) return fallback;
  return available[0];
}

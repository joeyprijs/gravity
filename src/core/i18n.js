// Pure translation helpers; the engine passes navigator.languages in.

// "A, B, and C" in the language's own grammar.
export function formatList(language, items) {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
}

// Picks the …One variant of a message key.
export function isOne(language, count) {
  return new Intl.PluralRules(language).select(count) === 'one';
}

// t(key, params), or fallback when the locale has no entry (t echoes the key).
export function translateOr(t, key, fallback, params) {
  const text = t(key, params);
  return text !== key ? text : fallback;
}

// The first preferred tag matching an available code, exact ("pt-BR") then
// base ("pt"), case-insensitively; else the fallback; else the first available.
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

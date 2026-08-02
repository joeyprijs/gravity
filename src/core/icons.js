// The engine's icon set: solid single-color glyphs that mark what a label
// says — beside it on the tab nav and the sheet's rows, in place of it in the
// scene top bar, where there is no room for the word. One glyph per concept
// across all three surfaces, so a heart means hit points wherever it appears.
// Each is drawn on a 24×24 grid and filled with `currentColor`, so a host's
// `font-size` and `color` size and tint it; nothing here loads a file or font.
//
// Icon names are an author-facing vocabulary: `rules.tabs[].icon`,
// `rules.headerResources[].icon`, and `rules.customAttributes[].icon` pick
// from ICON_NAMES, and validate.js rejects a name this module doesn't know.

// Glyphs whose inner detail is cut out of the silhouette (a page's text
// lines, an eye's pupil) need `fill-rule: evenodd` to punch the holes;
// glyphs built from separate solid parts must not have it, or overlapping
// parts would cancel out.
const ICONS = {
  sheet: {
    evenodd: true,
    d: 'M13.4 2H6.5A2.5 2.5 0 004 4.5v15A2.5 2.5 0 006.5 22h11a2.5 2.5 0 002.5-2.5V8.6L13.4 2z'
     + 'M7.6 8.6h3.6v1.6H7.6z M7.6 12.4h8.8v1.6H7.6z M7.6 16.2h8.8v1.6H7.6z',
  },
  backpack: {
    evenodd: true,
    d: 'M8 6h8a5 5 0 015 5v8a3 3 0 01-3 3H6a3 3 0 01-3-3v-8a5 5 0 015-5z'
     + 'M8.4 6a3.6 3.6 0 017.2 0h-2.4a1.2 1.2 0 00-2.4 0H8.4z'
     + 'M7.4 6v16H9V6H7.4z M15 6v16h1.6V6H15z M10.4 15.4h3.2v2.6h-3.2z',
  },
  trophy: {
    d: 'M6.5 2.5h11v4.7a5.5 5.5 0 01-11 0V2.5z'
     + 'M6.5 4.2H3.5v2.3c0 2 1.2 3.8 3 4.6V8.7c-.6-.5-1-1.3-1-2.2v-.8h1V4.2z'
     + 'M17.5 4.2h3v2.3c0 2-1.2 3.8-3 4.6V8.7c.6-.5 1-1.3 1-2.2v-.8h-1V4.2z'
     + 'M10.9 12.4h2.2v5.1h-2.2z M8 17.5h8v2.4H8z M6.8 19.9h10.4v2.1H6.8z',
  },
  // Drawn pointing north. The eight compass points are one glyph turned in
  // 45° steps by CSS, so a direction never needs its own art.
  arrow: {
    d: 'M12 2.6l5.6 8.4h-11.2z'
     + 'M10.2 9.8h3.6v11.6h-3.6z',
  },
  map: {
    d: 'M9 2.6L3 4.9v16.5l6-2.3V2.6z'
     + 'M10.6 2.6v16.5l6 2.3V4.9l-6-2.3z'
     + 'M18.2 4.9v16.5l3.8-1.5V3.4l-3.8 1.5z',
  },
  cog: {
    evenodd: true,
    d: 'M18.5 9.5L22.1 10.3L22.1 13.7L18.5 14.5L18.4 14.9L20.3 17.9L17.9 20.3L14.9 18.4'
     + 'L14.5 18.5L13.7 22.1L10.3 22.1L9.5 18.5L9.1 18.4L6.1 20.3L3.7 17.9L5.6 14.9'
     + 'L5.5 14.5L1.9 13.7L1.9 10.3L5.5 9.5L5.6 9.1L3.7 6.1L6.1 3.7L9.1 5.6L9.5 5.5'
     + 'L10.3 1.9L13.7 1.9L14.5 5.5L14.9 5.6L17.9 3.7L20.3 6.1L18.4 9.1Z'
     + 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
  },
  heart: {
    d: 'M12 21.1l-1.3-1.2C5.6 15.4 2.2 12.3 2.2 8.5 2.2 5.4 4.6 3 7.7 3c1.8 0 3.4.8 4.3 2.1'
     + 'C13 3.8 14.6 3 16.3 3c3.1 0 5.5 2.4 5.5 5.5 0 3.8-3.4 6.9-8.5 11.4L12 21.1z',
  },
  shield: {
    d: 'M12 2.2l8.3 3v6.1c0 5.1-3.5 9.6-8.3 11.4-4.8-1.8-8.3-6.3-8.3-11.4V5.2l8.3-3z',
  },
  sword: {
    d: 'M12 1.2L14.8 6.2v7.2h-5.6V6.2z M6.6 13.4h10.8v2.4H6.6z'
     + 'M10.6 15.8h2.8v3.6h-2.8z M8.8 19.4h6.4v2.6H8.8z',
  },
  star: {
    d: 'M12 2L14.5 8.6L21.5 8.9L16 13.3L17.9 20.1L12 16.2L6.1 20.1L8 13.3L2.5 8.9L9.5 8.6Z',
  },
  coin: {
    evenodd: true,
    d: 'M12 2.2a9.8 9.8 0 100 19.6 9.8 9.8 0 000-19.6z'
     + 'M12 4.6a7.4 7.4 0 100 14.8 7.4 7.4 0 000-14.8z'
     + 'M12 6.4a5.6 5.6 0 100 11.2 5.6 5.6 0 000-11.2z',
  },
  person: {
    d: 'M12 3.4a4 4 0 100 8 4 4 0 000-8z'
     + 'M12 13.6c-4.2 0-7.6 2.6-7.6 5.9v1.5h15.2v-1.5c0-3.3-3.4-5.9-7.6-5.9z',
  },
  level: {
    d: 'M3.6 15h4.2v6.4H3.6z M9.9 10.2h4.2v11.2H9.9z M16.2 5.2h4.2v16.2h-4.2z',
  },
  bolt: {
    d: 'M13.8 1.8L5.2 13.8h5.2L9.4 22.2 18.8 9.6h-5.6l.6-7.8z',
  },
  thumbs_up: {
    d: 'M3.6 10.6h1.8a1.4 1.4 0 011.4 1.4v8.2a1.4 1.4 0 01-1.4 1.4H3.6a1.4 1.4 0 01-1.4-1.4V12'
     + 'a1.4 1.4 0 011.4-1.4z'
     + 'M8.4 11.3c1.4-.7 2.2-1.7 2.8-3l2-4.4c.4-1 1.5-1.5 2.5-1.1 1.3.5 2 1.9 1.7 3.2l-.8 3.4h4'
     + 'c1.4 0 2.4 1.3 2.1 2.6l-1.6 6.9c-.3 1.3-1.5 2.3-2.9 2.3H8.4V11.3z',
  },
  dumbbell: {
    d: 'M1.6 7.8h3v8.4h-3z M4.8 5.6h3.4v12.8H4.8z M8.2 9.8h7.6v4.4H8.2z'
     + 'M15.8 5.6h3.4v12.8h-3.4z M19.4 7.8h3v8.4h-3z',
  },
  bulb: {
    d: 'M12 2a7 7 0 00-4.3 12.5c.9.7 1.4 1.6 1.5 2.5h5.6c.1-.9.6-1.8 1.5-2.5A7 7 0 0012 2z'
     + 'M9.2 18.4h5.6v1.8H9.2z M10.2 21.2h3.6v1.4h-3.6z',
  },
  eye: {
    evenodd: true,
    d: 'M12 4.8C6.9 4.8 2.6 8.2 1.2 12c1.4 3.8 5.7 7.2 10.8 7.2S21.4 15.8 22.8 12'
     + 'C21.4 8.2 17.1 4.8 12 4.8z'
     + 'M12 8.6a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8z',
  },
  moon: {
    d: 'M14.8 2.4A9.8 9.8 0 1021.4 15 7.8 7.8 0 0114.8 2.4z',
  },
  speech: {
    d: 'M12 3.4c-5.4 0-9.8 3.3-9.8 7.4 0 2.4 1.5 4.5 3.8 5.9-.3 1.4-1 2.7-2 3.7'
     + ' 2.2-.3 4.2-1.2 5.7-2.4.7.1 1.5.2 2.3.2 5.4 0 9.8-3.3 9.8-7.4S17.4 3.4 12 3.4z',
  },
};

// The icon names game data may reference. Exported for validate.js, which
// runs under node:test — this module stays DOM-free for that reason.
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/**
 * Renders one icon as an `<svg>` element for an engine-authored innerHTML
 * template. The glyph is hidden from assistive tech: every caller pairs it
 * with a text label (visible on a tab, screen-reader-only in the top bar).
 *
 * @param {string} name - An ICON_NAMES entry.
 * @returns {string} The `<svg>` markup, or '' for an unknown name.
 */
export function iconHtml(name) {
  const icon = ICONS[name];
  if (!icon) {
    console.warn(`[Gravity] icons: no icon named "${name}" — rendering nothing`);
    return '';
  }
  const rule = icon.evenodd ? ' fill-rule="evenodd"' : '';
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"${rule}><path d="${icon.d}"/></svg>`;
}

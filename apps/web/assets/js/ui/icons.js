/**
 * icons.js — inline SVG icon set.
 *
 * Why inline instead of an icon font or sprite: no extra request, no FOUT,
 * works offline, inherits `currentColor`, and keeps the "no runtime CDN" rule.
 *
 * All icons share one geometry contract: 24x24 viewBox, stroke-based,
 * stroke-width 1.75, round caps/joins, no fill. `icon(name)` returns markup.
 */

const P = {
  /* --- files & formats --- */
  'file-pdf': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5h1.2a1.3 1.3 0 0 0 0-2.6H8.5v4.6"/><path d="M13 18.5v-4.6h1.4a1.5 1.5 0 0 1 1.5 1.5v1.6a1.5 1.5 0 0 1-1.5 1.5z"/>',
  'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  files: '<path d="M15 3H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6z"/><path d="M15 3v5h3"/><path d="M7 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-4.5 4.5L9 13l-6 6"/>',
  images: '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M4 8v10a2 2 0 0 0 2 2h10"/><circle cx="12.5" cy="7.5" r="1.2"/><path d="M21 13l-3.6-3.6L13 13.8"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  download: '<path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 18.5h16"/>',
  upload: '<path d="M12 16V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/><path d="M4 18.5h16"/>',
  'cloud-up': '<path d="M7 17.5A4.5 4.5 0 0 1 7.4 8.6a5.5 5.5 0 0 1 10.5 1.2A4.2 4.2 0 0 1 17.5 17.5"/><path d="M12 20.5V12"/><path d="M9 15l3-3 3 3"/>',

  /* --- tool glyphs --- */
  stack: '<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.5 12 21l8.5-4.5"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2.6"/><circle cx="6.5" cy="17.5" r="2.6"/><path d="M8.6 8.4 20 19.5M8.6 15.6 20 4.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/><path d="M12 14.5v2.5"/>',
  'lock-open': '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.6a4 4 0 0 1 7.5-1.9"/><path d="M12 14.5v2.5"/>',
  gauge: '<path d="M20.5 17.5a9 9 0 1 0-17 0"/><path d="M12 17.5 16 9"/><circle cx="12" cy="17.5" r="1.4"/>',
  hash: '<path d="M9 3.5 7.5 20.5M16.5 3.5 15 20.5M3.8 9h16.4M3 15h16.4"/>',
  shuffle: '<path d="M17 3.5 21 7l-4 3.5"/><path d="M17 13.5 21 17l-4 3.5"/><path d="M3 7h4.2c1.6 0 3 .8 3.8 2.2l2 3.6c.8 1.4 2.2 2.2 3.8 2.2H21"/><path d="M3 17h4.2c1.6 0 3-.8 3.8-2.2"/><path d="M21 7h-3.2c-1.4 0-2.7.6-3.6 1.7"/>',
  magnifier: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/><path d="M8.5 10.5h4M10.5 8.5v4"/>',
  'text-t': '<path d="M4 6.5V4.5h16v2"/><path d="M12 4.5v15"/><path d="M8.5 19.5h7"/>',
  shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  scan: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M20 8.5V6a2 2 0 0 0-2-2h-2.5M4 15.5V18a2 2 0 0 0 2 2h2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5"/><path d="M4 12h16"/>',
  layers: '<path d="M12 3 3 7.5 12 12l9-4.5z"/><path d="m3 12.5 9 4.5 9-4.5"/>',

  /* --- actions & states --- */
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.7 2.7L16 9.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.8 11.3A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.7L17.5 7"/><path d="M10.5 11v5M13.5 11v5"/>',
  'arrow-clockwise': '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 3.5V8h-4.5"/>',
  'arrow-right': '<path d="M4 12h15"/><path d="m13.5 6.5 5.5 5.5-5.5 5.5"/>',
  'arrow-left': '<path d="M20 12H5"/><path d="M10.5 6.5 5 12l5.5 5.5"/>',
  'caret-down': '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  'caret-up': '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',
  'dots-six': '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  'arrows-out': '<path d="M8 3.5H3.5V8M16 3.5h4.5V8M8 20.5H3.5V16M16 20.5h4.5V16"/><path d="M3.5 3.5 9 9M20.5 3.5 15 9M3.5 20.5 9 15M20.5 20.5 15 15"/>',

  /* --- chrome --- */
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M18.8 5.2l-1.5 1.5M6.7 17.3l-1.5 1.5"/>',
  moon: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  house: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M9.5 20.5v-6h5v6"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r="1"/>',
  warning: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4.2"/><circle cx="12" cy="17" r="1"/>',
  sparkle: '<path d="M12 3.5 13.7 9l5.3 1.8-5.3 1.8L12 18l-1.7-5.4L5 10.8 10.3 9z"/><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  rocket: '<path d="M12 3s4.5 1.6 4.5 8.2c0 2.4-1.2 4.6-2.3 5.9h-4.4C8.7 15.8 7.5 13.6 7.5 11.2 7.5 4.6 12 3 12 3z"/><circle cx="12" cy="10" r="1.7"/><path d="M9.8 17.1 8 20.5l2.6-.9M14.2 17.1l1.8 3.4-2.6-.9"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 7.5 3C19.5 15.4 12 20 12 20z"/>',
  code: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/>',
};

/**
 * @param {string} name key from the set above
 * @param {{size?: number|string, cls?: string, title?: string}} [opts]
 * @returns {string} SVG markup (safe: built only from the literals above)
 */
export function icon(name, opts = {}) {
  const body = P[name];
  if (!body) {
    if (typeof console !== 'undefined') console.warn(`[toolseer] unknown icon "${name}"`);
    return '';
  }
  const size = opts.size == null ? 24 : opts.size;
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  const a11y = opts.title
    ? ` role="img" aria-label="${String(opts.title).replace(/"/g, '&quot;')}"`
    : ' aria-hidden="true"';
  return (
    `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${a11y}>${body}</svg>`
  );
}

export const ICON_NAMES = Object.keys(P);
export default icon;

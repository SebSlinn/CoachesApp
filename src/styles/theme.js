// src/styles/theme.js
// THE place SwimZone's interface colours live (contracts/ZONES.md § "Colour roles").
//
// PURE — zero imports. Safe for pages, canvas charts, print and tests.
//
// Colour roles — one meaning each:
//   ZONE      a training type (A1 … HVO). From the coach's scheme (zones/schemes.js), never here.
//   ENERGY    the three energy systems, on the heat spectrum (aerobic green → glycolytic yellow → ATP-CP red).
//             Shown on their own tab with labels; they share hues with some zones, and that is accepted.
//   STATUS    warn / danger banners only, always with ⚠ or ✗ text beside the colour.
//   NEUTRAL   everything else: surfaces, borders, text, buttons, selection, group headers.
//
// Screens use the CSS variables through T (below), e.g. style={{ color: T.text2 }}, so a
// theme switch is one call to applyTheme() and no screen edits. Canvas charts and print
// need real values: themeColors().
//
// Light mode: add THEMES.light with the same keys. Nothing else changes.

const THEMES = Object.freeze({
  dark: Object.freeze({
    // surfaces, back to front
    bg:            '#1a1a2e',                 // page
    well:          '#12121f',                 // chart backgrounds (sunk below the page)
    surface:       'rgba(255,255,255,0.03)',  // cards and panels
    raised:        'rgba(255,255,255,0.06)',  // inputs, tiles, idle buttons
    active:        'rgba(255,255,255,0.12)',  // selected button / tab
    // lines
    border:        'rgba(255,255,255,0.08)',
    borderStrong:  'rgba(255,255,255,0.22)',
    // text, strongest to faintest
    text:          '#ffffff',
    text2:         'rgba(255,255,255,0.68)',  // body copy
    text3:         'rgba(255,255,255,0.48)',  // secondary details
    text4:         'rgba(255,255,255,0.32)',  // micro labels, axis text, unmet criteria
    // status (banners only)
    warn:          '#FF9F0A',
    warnBg:        'rgba(255,159,10,0.10)',
    warnLine:      'rgba(255,159,10,0.40)',
    warnText:      '#FFD9A0',
    danger:        '#FF453A',
    dangerBg:      'rgba(255,69,58,0.12)',
    dangerLine:    'rgba(255,69,58,0.45)',
    dangerText:    '#FFB8B2',
    // energy systems: the usual heat spectrum — cool = aerobic, warm = anaerobic (Al, 2026-11-17;
    // the original SwimZone colours). No universal standard exists; Garmin/Polar/Myzone use the same idea.
    energyAtpcp:      '#FF2D55',   // red / magenta  — maximal, 0–10 s
    energyGlycolytic: '#FFCC00',   // yellow / amber — 10 s – ~2 min
    energyAerobic:    '#34C759',   // green          — 2 min +
  }),
});

const THEME_KEYS = Object.freeze(Object.keys(THEMES.dark));
const DEFAULT_THEME = 'dark';

/** CSS variable name for a key: 'text2' → '--sz-text2'. */
function cssVarName(pKey) { return `--sz-${pKey}`; }

/** var(--sz-…) strings for inline styles: T.text2, T.border, T.energyAerobic … */
const T = Object.freeze(Object.fromEntries(THEME_KEYS.map(k => [k, `var(${cssVarName(k)})`])));

/** Raw colour values for a theme (canvas, print, tests). Unknown name → dark. */
function themeColors(pName = DEFAULT_THEME) { return THEMES[pName] || THEMES[DEFAULT_THEME]; }

/** { '--sz-bg': '#1a1a2e', … } for a theme. */
function themeCssVars(pName = DEFAULT_THEME) {
  const mTheme = themeColors(pName);
  return Object.fromEntries(THEME_KEYS.map(k => [cssVarName(k), mTheme[k]]));
}

/** Energy-system colour by ENERGY_SYSTEMS id ('atpcp' | 'glycolytic' | 'aerobic'). */
const ENERGY_KEY = Object.freeze({ atpcp: 'energyAtpcp', glycolytic: 'energyGlycolytic', aerobic: 'energyAerobic' });
function energyColor(pId, pName = DEFAULT_THEME) { return themeColors(pName)[ENERGY_KEY[pId]] || themeColors(pName).text3; }
/** The same as a CSS variable, for inline styles. */
function energyVar(pId) { return T[ENERGY_KEY[pId]] || T.text3; }

/** Shared type scale (monospace UI). */
const FONT = Object.freeze({ mono: 'monospace' });

export { THEMES, THEME_KEYS, DEFAULT_THEME, T, FONT, themeColors, themeCssVars, energyColor, energyVar, cssVarName };

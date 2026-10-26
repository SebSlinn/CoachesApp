// src/zones/schemes.js
// Display schemes for training types: a label and a colour per code (contracts/ZONES.md).
//
// PURE — imports only ./types.js. Copied to public/poolside/ by scripts/copy-setformat.mjs.
//
// A scheme is applied at DISPLAY time only. Stored data holds codes, never labels/colours,
// so two coaches see the same set in their own scheme and switching never changes data.
//
// Shape:
//   { id, name, builtIn,
//     types:  { CODE: { label?, short?, color?, text? } },   // per-type overrides
//     groups: { 1..5: { color } } }                            // optional group fallback
//
// Colour fallback order: scheme.types[code].color → scheme.groups[group].color
//                        → GROUPS[group].color (types.js) → UNKNOWN_COLOR.
// Label fallback order:  scheme.types[code].label → TYPES[code].label → code.
//
// Rule: types in the same group share the group colour unless the scheme gives the
// type its own. Zone 3 (CS, MVO) shares one colour in every built-in scheme.

import { TYPES, GROUPS_BY_ZONE, isTypeCode } from './types.js';

const UNKNOWN_COLOR = '#8E8E93';
// The scheme everyone sees until they choose one (2026-10-26: Urbanchek; was Sweetenham).
const DEFAULT_SCHEME_ID = 'urbanchek';

// ── Built-in schemes ─────────────────────────────────────────────────────────

// Sweetenham = EXACTLY the colours SwimZone showed until 2026-10-26 ("SwimZone classic").
// Type colours from the old ZONE_COLORS / sbZoneColor; CS (and MVO, which shares
// Zone 3 with it) keep CS's teal. Group colours are the old ZONE_GROUPS header colours.
// Coaches who chose it keep it; the default is now Urbanchek (DEFAULT_SCHEME_ID).
const SWEETENHAM = {
  id: 'sweetenham', name: 'SwimZone classic', builtIn: true,
  types: {
    A1:  { color: '#007AFF' },
    A2:  { color: '#30B0C7' },
    A3:  { color: '#34C759' },
    AT:  { color: '#FFCC00', text: '#1a1a2e' },
    CS:  { color: '#30B0C7' },
    MVO: { color: '#30B0C7' },
    LP:  { color: '#FF9500' },
    LT:  { color: '#FF5500' },
    PL:  { color: '#CC2200' },   // the Classifier's existing "possible PL" banner colour
    HVO: { color: '#FF2D55' },
  },
  groups: {
    1: { color: '#30B0C7' }, 2: { color: '#FFCC00' }, 3: { color: '#FF9500' },
    4: { color: '#FF5500' }, 5: { color: '#FF2D55' },
  },
};

// Urbanchek colour system — mapping from the Training Zones Classifications chart.
const URBANCHEK = {
  id: 'urbanchek', name: 'Urbanchek colours', builtIn: true,
  types: {
    A1:  { label: 'White',  short: 'White',  color: '#F5F5F5', text: '#111' },
    A2:  { label: 'Pink',   short: 'Pink',   color: '#F4A6C8', text: '#111' },
    A3:  { label: 'Red',    short: 'Red',    color: '#E53935' },
    AT:  { label: 'Blue',   short: 'Blue',   color: '#1E88E5' },
    CS:  { label: 'Purple', short: 'Purple' },
    MVO: { label: 'Purple', short: 'Purple' },
    LT:  { label: 'Orange', short: 'Orange', color: '#FB8C00' },
    LP:  { label: 'Green',  short: 'Green',  color: '#43A047' },
    PL:  { label: 'Orange (peak)', short: 'Orange', color: '#FB8C00' },   // PL sits above LT → LT's colour
    HVO: { label: 'Gold',   short: 'Gold',   color: '#D4AF37', text: '#111' },
  },
  groups: { 3: { color: '#7E57C2' } },
};

// Maglischo EN/SP categories — colour follows the category.
const MAG = { EN1: '#30B0C7', EN2: '#34C759', EN3: '#AF52DE', SP1: '#FF5500', SP2: '#FF9500', SP3: '#FF2D55' };
const MAGLISCHO = {
  id: 'maglischo', name: 'Maglischo', builtIn: true,
  types: {
    A1:  { label: 'EN1', short: 'EN1', color: MAG.EN1 },
    A2:  { label: 'EN1', short: 'EN1', color: MAG.EN1 },
    A3:  { label: 'EN2', short: 'EN2', color: MAG.EN2 },
    AT:  { label: 'EN2', short: 'EN2', color: MAG.EN2 },
    CS:  { label: 'EN3', short: 'EN3', color: MAG.EN3 },
    MVO: { label: 'EN3', short: 'EN3', color: MAG.EN3 },
    LT:  { label: 'SP1', short: 'SP1', color: MAG.SP1 },
    LP:  { label: 'SP2', short: 'SP2', color: MAG.SP2 },
    PL:  { label: 'SP1 (peak)', short: 'SP1', color: MAG.SP1 },     // PL sits above LT → LT's category
    HVO: { label: 'SP3', short: 'SP3', color: MAG.SP3 },
  },
  groups: {},
};

const BUILT_IN_SCHEMES = Object.freeze({   // picker order: the default first
  urbanchek:  URBANCHEK,
  sweetenham: SWEETENHAM,
  maglischo:  MAGLISCHO,
});

// ── Resolver ─────────────────────────────────────────────────────────────────

/** '#111' or '#fff', whichever reads better on pHex. */
function contrastText(pHex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(pHex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? '#111' : '#fff';
}

function pickScheme(pScheme) {
  if (pScheme && typeof pScheme === 'object') return pScheme;
  return BUILT_IN_SCHEMES[pScheme] || BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID];
}

/**
 * How to show a type code under a scheme.
 * @param {string} pCode            type code, e.g. 'AT'. Unknown codes ('Drill', null) get a neutral grey.
 * @param {Object|string} [pScheme] scheme object or built-in id; default DEFAULT_SCHEME_ID.
 * @returns {{code, label, short, name, color, text, group:number|null, known:boolean}}
 *   name = the "CODE / Long name" line used in zone lists; the type's own name unless the
 *   scheme relabels the type, then "CODE / scheme label". Buttons and badges keep showing the code.
 */
function resolveZoneStyle(pCode, pScheme) {
  const mScheme = pickScheme(pScheme);
  if (!isTypeCode(pCode)) {
    return { code: pCode ?? null, label: pCode || '—', short: pCode || '—', name: pCode || '—',
             color: UNKNOWN_COLOR, text: '#fff', group: null, known: false };
  }
  const mType  = TYPES[pCode];
  const mOver  = mScheme.types?.[pCode] || {};
  const mColor = mOver.color
    || mScheme.groups?.[mType.group]?.color
    || GROUPS_BY_ZONE[mType.group]?.color
    || UNKNOWN_COLOR;
  return {
    code:  pCode,
    label: mOver.label || mType.label,
    short: mOver.short || mOver.label || mType.short,
    name:  mOver.label ? `${pCode} / ${mOver.label}` : mType.name,
    color: mColor,
    text:  mOver.text || contrastText(mColor),
    group: mType.group,
    known: true,
  };
}

/**
 * A scheme colour at an opacity, as an rgba() string — for tints of zone colours
 * where the old code wrote literal rgba(r,g,b,a). Non-hex input is returned unchanged.
 */
function withAlpha(pHex, pAlpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(pHex || ''));
  if (!m) return pHex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${pAlpha})`;
}

/** Shorthand: the colour only. */
function zoneColor(pCode, pScheme) { return resolveZoneStyle(pCode, pScheme).color; }

/** Colour for a zone group under a scheme (group headers, ZoneBar groupings). */
function groupColor(pZone, pScheme) {
  const mScheme = pickScheme(pScheme);
  return mScheme.groups?.[pZone]?.color || GROUPS_BY_ZONE[pZone]?.color || UNKNOWN_COLOR;
}

/**
 * Start a custom scheme from a built-in one (deep copy, editable).
 * @param {string} [pBaseId=DEFAULT_SCHEME_ID]
 * @param {Object} [pOpts] { id, name }
 */
function copyScheme(pBaseId = DEFAULT_SCHEME_ID, pOpts = {}) {
  const mBase = BUILT_IN_SCHEMES[pBaseId] || BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID];
  return {
    id: pOpts.id || 'custom',
    name: pOpts.name || `Custom (from ${mBase.name})`,
    builtIn: false,
    basedOn: mBase.id,
    types: JSON.parse(JSON.stringify(mBase.types || {})),
    groups: JSON.parse(JSON.stringify(mBase.groups || {})),
  };
}

/**
 * Clean a scheme loaded from storage: drops unknown codes and bad colours,
 * so a stale saved scheme can never break rendering. Returns a new object.
 */
function sanitiseScheme(pScheme) {
  if (!pScheme || typeof pScheme !== 'object') return BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID];
  if (pScheme.builtIn && BUILT_IN_SCHEMES[pScheme.id]) return BUILT_IN_SCHEMES[pScheme.id];
  const okColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const okText  = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 40;
  const mTypes = {};
  for (const [mCode, mV] of Object.entries(pScheme.types || {})) {
    if (!isTypeCode(mCode) || !mV || typeof mV !== 'object') continue;
    const o = {};
    if (okText(mV.label)) o.label = mV.label.trim();
    if (okText(mV.short)) o.short = mV.short.trim();
    if (okColor(mV.color)) o.color = mV.color;
    if (okColor(mV.text))  o.text  = mV.text;
    mTypes[mCode] = o;
  }
  const mGroups = {};
  for (const [mZ, mV] of Object.entries(pScheme.groups || {})) {
    if (GROUPS_BY_ZONE[mZ] && okColor(mV?.color)) mGroups[mZ] = { color: mV.color };
  }
  return {
    id: String(pScheme.id || 'custom'), name: okText(pScheme.name) ? pScheme.name : 'Custom',
    builtIn: false, basedOn: pScheme.basedOn || null, types: mTypes, groups: mGroups,
  };
}

export {
  BUILT_IN_SCHEMES, DEFAULT_SCHEME_ID, UNKNOWN_COLOR,
  resolveZoneStyle, zoneColor, groupColor, copyScheme, sanitiseScheme, contrastText, withAlpha,
};

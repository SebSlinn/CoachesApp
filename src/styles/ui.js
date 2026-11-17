// src/styles/ui.js
// Shared style objects built from the theme tokens (theme.js). Use these instead of
// writing rgba(…) literals in a screen: one change here restyles every card, label and banner.
//
//   <div style={ui.card}>…</div>
//   <div style={ui.accentCard(zoneColor('AT'), 'strong')}>…</div>
//   <div style={ui.banner('warn')}>…</div>
import { T, FONT } from './theme.js';
import { withAlpha } from '../zones/schemes.js';

const RADIUS = 8;

/** Plain panel. */
const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 };

/** Small upper-case caption above a value or a list. */
const caption = { fontSize: 9, color: T.text4, letterSpacing: '0.1em', textTransform: 'uppercase' };

/** Form field label. */
const label = { ...caption, fontSize: 10, letterSpacing: '0.08em', marginBottom: 2, display: 'block' };

/** Text input / select. */
const input = {
  background: T.raised, border: `1px solid ${T.border}`, borderRadius: 5, color: T.text,
  fontFamily: FONT.mono, fontSize: 13, outline: 'none', padding: '5px 6px',
};

/** Small stat tile (Speed, Work dur …). */
const tile = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS, padding: '9px 11px' };

/**
 * Neutral toggle button (rest type, pool, result tabs).
 * @param {boolean} pActive
 */
function toggle(pActive) {
  return {
    padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
    border: `1px solid ${pActive ? T.borderStrong : T.border}`,
    background: pActive ? T.active : 'transparent',
    color: pActive ? T.text : T.text3,
  };
}

/** Neutral action button (Add to set, Print, nav). */
const button = {
  padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
  letterSpacing: '0.04em', border: `1px solid ${T.borderStrong}`, background: T.raised, color: T.text,
};

/**
 * A button coloured by a zone (zone picker, IN/ON chips).
 * @param {string} pColor   zone colour (hex) from the coach's scheme
 * @param {boolean} pActive
 */
function zoneButton(pColor, pActive) {
  return {
    cursor: 'pointer', fontFamily: FONT.mono, fontWeight: 700, borderRadius: 5,
    border: `1px solid ${pActive ? pColor : withAlpha(pColor, 0.35)}`,
    background: withAlpha(pColor, pActive ? 0.2 : 0.05),
    color: pActive ? pColor : withAlpha(pColor, 0.7),
  };
}

/**
 * Card marked with one colour (a zone or an energy system): a left bar plus a faint tint.
 * @param {string} pColor   hex colour
 * @param {'strong'|'normal'|'faint'} [pWeight='normal']  strong = matched / primary, faint = not matched
 */
function accentCard(pColor, pWeight = 'normal') {
  const mA = { strong: [0.10, 0.45, 1], normal: [0.05, 0.25, 1], faint: [0.03, 0.15, 0.35] }[pWeight] || [0.05, 0.25, 1];
  const mTint = withAlpha(pColor, mA[0]);
  return {
    // the tint is laid over a card colour, so it stays clean on the light theme's tinted page
    background: `linear-gradient(${mTint}, ${mTint}), ${T.surface}`, border: `1px solid ${withAlpha(pColor, mA[1])}`,
    borderLeft: `4px solid ${withAlpha(pColor, mA[2])}`, borderRadius: RADIUS, padding: '10px 14px', marginBottom: 10,
  };
}

/** Neutral card with a left bar (group cards, notes). */
const markedCard = {
  background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.borderStrong}`,
  borderRadius: RADIUS, padding: '10px 14px', marginBottom: 10,
};

/**
 * Status banner.
 * @param {'warn'|'danger'|'note'} pKind
 */
function banner(pKind) {
  const mBase = { borderRadius: RADIUS, padding: '10px 14px', marginBottom: 12, fontSize: 11, lineHeight: 1.6 };
  if (pKind === 'danger') return { ...mBase, background: `linear-gradient(${T.dangerBg}, ${T.dangerBg}), ${T.surface}`, border: `1px solid ${T.dangerLine}`, borderLeft: `4px solid ${T.danger}`, color: T.dangerText };
  if (pKind === 'warn')   return { ...mBase, background: `linear-gradient(${T.warnBg}, ${T.warnBg}), ${T.surface}`, border: `1px solid ${T.warnLine}`, borderLeft: `4px solid ${T.warn}`, color: T.warnText };
  return { ...mBase, background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${T.borderStrong}`, color: T.text2 };
}

/**
 * One line of a bullet list with a coloured rule on the left.
 * @param {string} [pColor]  hex colour; omitted = neutral rule
 */
function bullet(pColor) {
  return {
    fontSize: 9, color: T.text2, marginBottom: 3, paddingLeft: 8, lineHeight: 1.5,
    borderLeft: `2px solid ${pColor ? withAlpha(pColor, 0.5) : T.border}`,
  };
}

/** A met / unmet criterion inside a banner. The tick or cross carries the meaning, not the colour. */
function criterion(pMet) { return { color: pMet ? T.text : T.text4 }; }

export const ui = { card, caption, label, input, tile, toggle, button, zoneButton, accentCard, markedCard, banner, bullet, criterion };

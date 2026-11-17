// src/services/themeService.js
// Light / dark display choice for this device (styles/theme.js). Never throws: anything odd
// falls back to the default, so the screens always render.
import { getThemeRepository } from '../repositories/RepositoryFactory.js';
import { THEMES, DEFAULT_THEME } from '../styles/theme.js';

/** What a person can choose. 'system' follows the device's own light/dark setting. */
export const THEME_CHOICES = Object.freeze([
  { v: 'dark',   l: 'Dark' },
  { v: 'light',  l: 'Light' },
  { v: 'system', l: 'Match device' },
]);
const isChoice = (c) => THEME_CHOICES.some(o => o.v === c);

/** @returns {{ data: string, error: Object|null }}  data = 'dark' | 'light' | 'system' */
export function loadThemeChoice() {
  try {
    const mStored = getThemeRepository().get();
    return { data: isChoice(mStored) ? mStored : DEFAULT_THEME, error: null };
  } catch (e) {
    return { data: DEFAULT_THEME, error: { message: e.message } };
  }
}

/** @param {string} pChoice @returns {{ data: string, error: Object|null }} data = the choice now in force */
export function saveThemeChoice(pChoice) {
  if (!isChoice(pChoice)) return { data: loadThemeChoice().data, error: { message: `Unknown theme "${pChoice}"` } };
  try {
    getThemeRepository().save(pChoice === DEFAULT_THEME ? null : pChoice);
    return { data: pChoice, error: null };
  } catch (e) {
    return { data: pChoice, error: { message: e.message } };
  }
}

/**
 * The theme to draw with.
 * @param {string} pChoice         'dark' | 'light' | 'system'
 * @param {boolean} pDevicePrefersLight  for 'system'
 * @returns {string} a THEMES key
 */
export function resolveTheme(pChoice, pDevicePrefersLight) {
  if (pChoice === 'system') return pDevicePrefersLight ? 'light' : 'dark';
  return THEMES[pChoice] ? pChoice : DEFAULT_THEME;
}

// src/services/themeService.js
// Light / dark display choice for this device (styles/theme.js). Never throws: anything odd
// falls back to the default, so the screens always render.
import { getThemeRepository } from '../repositories/RepositoryFactory.js';
import { THEMES, DEFAULT_THEME } from '../styles/theme.js';   // DEFAULT_THEME = what to draw if all else fails

/** What a person can choose. 'system' follows the device's own light/dark setting. */
export const THEME_CHOICES = Object.freeze([
  { v: 'system', l: 'Match this device' },
  { v: 'light',  l: 'Light' },
  { v: 'dark',   l: 'Dark' },
]);
/** Nothing chosen yet → follow the phone / computer (Al, 2026-11-17). */
export const DEFAULT_CHOICE = 'system';
const isChoice = (c) => THEME_CHOICES.some(o => o.v === c);

/** @returns {{ data: string, error: Object|null }}  data = 'dark' | 'light' | 'system' */
export function loadThemeChoice() {
  try {
    const mStored = getThemeRepository().get();
    return { data: isChoice(mStored) ? mStored : DEFAULT_CHOICE, error: null };
  } catch (e) {
    return { data: DEFAULT_CHOICE, error: { message: e.message } };
  }
}

/** @param {string} pChoice @returns {{ data: string, error: Object|null }} data = the choice now in force */
export function saveThemeChoice(pChoice) {
  if (!isChoice(pChoice)) return { data: loadThemeChoice().data, error: { message: `Unknown theme "${pChoice}"` } };
  try {
    getThemeRepository().save(pChoice === DEFAULT_CHOICE ? null : pChoice);
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

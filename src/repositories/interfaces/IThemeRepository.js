// repositories/interfaces/IThemeRepository.js
// Contract for the light / dark choice (styles/theme.js). Stored value: 'dark' | 'light' | 'system'.
// SYNCHRONOUS, like IZoneSchemeRepository: the theme is needed before the first paint.
export class IThemeRepository {
  /** @returns {string|null} the stored choice, or null if none saved */
  get() { throw new Error('IThemeRepository.get not implemented'); }
  /** @param {string|null} _choice  null clears it (back to the default) */
  save(_choice) { throw new Error('IThemeRepository.save not implemented'); }
}

// src/services/zoneSchemeService.js
// The coach's zone display scheme: which labels/colours every screen uses for type
// codes (contracts/ZONES.md). Stored data never changes — only how codes are shown.
// Synchronous (see IZoneSchemeRepository). Never throws: a missing or broken stored
// value falls back to the default scheme, so the screens always render.

import { getZoneSchemeRepository } from '../repositories/RepositoryFactory.js';
import { BUILT_IN_SCHEMES, DEFAULT_SCHEME_ID, sanitiseScheme } from '../zones/schemes.js';

const DEFAULT_SCHEME = BUILT_IN_SCHEMES[DEFAULT_SCHEME_ID];

function fromStored(pStored) {
  if (!pStored || typeof pStored !== 'object') return DEFAULT_SCHEME;
  // Built-in choices are stored as { id } only, so later fixes to a built-in reach everyone.
  if (BUILT_IN_SCHEMES[pStored.id] && (pStored.builtIn || !pStored.types)) return BUILT_IN_SCHEMES[pStored.id];
  return sanitiseScheme(pStored);
}

/**
 * The scheme to display with.
 * @returns {{ data: Object, error: Object|null }}  data is always a usable scheme
 */
export function loadZoneScheme() {
  try {
    return { data: fromStored(getZoneSchemeRepository().get()), error: null };
  } catch (e) {
    return { data: DEFAULT_SCHEME, error: { message: e.message } };
  }
}

/**
 * Choose a scheme.
 * @param {string|Object|null} pChoice  built-in id, a custom scheme object, or null for the default
 * @returns {{ data: Object, error: Object|null }}  data = the scheme now in force
 */
export function saveZoneScheme(pChoice) {
  try {
    if (!pChoice || pChoice === DEFAULT_SCHEME_ID) {
      getZoneSchemeRepository().save(null);
      return { data: DEFAULT_SCHEME, error: null };
    }
    if (typeof pChoice === 'string') {
      const mBuiltIn = BUILT_IN_SCHEMES[pChoice];
      if (!mBuiltIn) return { data: loadZoneScheme().data, error: { message: `Unknown scheme "${pChoice}"` } };
      getZoneSchemeRepository().save({ id: mBuiltIn.id });
      return { data: mBuiltIn, error: null };
    }
    const mScheme = fromStored(pChoice);
    getZoneSchemeRepository().save(mScheme.builtIn ? { id: mScheme.id } : mScheme);
    return { data: mScheme, error: null };
  } catch (e) {
    return { data: loadZoneScheme().data, error: { message: e.message } };
  }
}

/** Built-in schemes, for a picker. @returns {{ data: Object[], error: null }} */
export function listZoneSchemes() {
  return { data: Object.values(BUILT_IN_SCHEMES), error: null };
}

/**
 * Bring the scheme saved on the account to this device (at sign-in / app start).
 * @returns {Promise<{ data: Object, changed: boolean, error: Object|null }>}  data = the scheme now in force
 */
export async function syncZoneScheme() {
  const r = await getZoneSchemeRepository().sync();
  return { data: loadZoneScheme().data, changed: !!r?.data?.changed, error: r?.error || null };
}

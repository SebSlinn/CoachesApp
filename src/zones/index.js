//zones/index.js - Central export for all zones-related modules. This allows importing from 'zones' instead of individual files.
export * from './constants.js';
export * from './helpers.js';
export * from './validatePace.js';
export * from './energy.js';
export * from './classify.js';
export * from './suggest.js';
export * from './zoneCriteria.js';
// Named (not `export *`): speedChart.js has its own private STROKE_MULT
// (identical values, kept local to its split-time maths) which collides
// with constants.js's STROKE_MULT under `export *` — a duplicate-export
// error that breaks the whole bundle. constants.js's STROKE_MULT is the
// one already used everywhere else, so it stays the one the barrel exports.
export {
  getSpeedProfile, getSplitAtMarker, predictFinishFromSplit, toLCTime,
  POOL_TO_LC, COEFFS,
} from './speedChart.js';

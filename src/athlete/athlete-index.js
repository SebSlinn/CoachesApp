// src/athlete/index.js
// Central re-export for all athlete-related modules.
// Import from here rather than individual files.

export {
  STALE_MONTHS, VALID_DISTS, STROKE_NAMES,
  parseDateToAge, splitTimeToken, parseTimeToSec, deriveAthleteType,
} from './parse.js';

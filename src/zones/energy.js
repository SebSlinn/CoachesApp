//zones/energy.js - Core energy system modeling for classification and suggestions.
import { STROKE_MULT } from './constants.js';

function glycoCapacity(phvStatus) {
  if (phvStatus === "pre")        return 0.40;
  if (phvStatus === "developing") return 0.70;
  return 1.0;
}
function phvZoneCaps(phvStatus) {
  if (phvStatus === "pre")        return { ltCap: 0.0, lpCap: 0.0, atCap: 0.4 };
  if (phvStatus === "developing") return { ltCap: 0.3, lpCap: 0.5, atCap: 1.0 };
  return { ltCap: 1.0, lpCap: 1.0, atCap: 1.0 };
}

// ─── Per-rep energy system model ─────────────────────────────────────────────
function repEnergy(workSec, speedRatio, atpcpStore, lactateBuf, phvStatus = "post") {
  const atpcpFraction = 0.82 * Math.pow(Math.min(1, 15 / workSec), 1.5);
  const atpcpRaw      = atpcpFraction * atpcpStore;

  const glycoCap_phv = glycoCapacity(phvStatus);
  const glycoOnset   = Math.min(1, Math.max(0, (workSec - 13) / 22));
  const glycoDurFade = workSec < 120 ? 1.0 : Math.max(0.30, 1.0 - (workSec - 120) / 280);
  const glycoSpeed   = Math.max(0, Math.min(1, (1.32 - speedRatio) / 0.32));
  const glycoRaw     = glycoOnset * glycoDurFade * glycoSpeed * lactateBuf * glycoCap_phv;

  const aeroDurBase = Math.min(0.38, 0.08 + workSec / 380);
  const aeroDur     = Math.min(0.20, workSec / 900);
  const aeroSpeed   = Math.max(0.75, Math.min(1.5, 0.55 + speedRatio * 0.46));
  const aeroRaw     = (aeroDurBase + aeroDur) * aeroSpeed;

  const total = atpcpRaw + glycoRaw + aeroRaw;
  return {
    atpcp:      atpcpRaw / total,
    glycolytic: glycoRaw / total,
    aerobic:    aeroRaw  / total,
    raw: { atpcpRaw, glycoRaw, aeroRaw }
  };
}

// ─── Pace degradation model ──────────────────────────────────────────────────
// Research basis: ~1.5-3% pace loss per rep under high lactate (Sdec% literature).
// Degradation is proportional to residual lactate at start of each rep.
// Below critical speed (AT pace, ratio ~1.05) degradation is minimal.
// Returns achievable time multiplier for a given rep (1.0 = no degradation).
function paceImpairment(lactateBuf, speedRatio) {
  // No impairment below AT pace — aerobic sets are achievable regardless of lactate
  if (speedRatio > 1.05) return 1.0;
  const residualLactate = 1.0 - lactateBuf;      // 0 = fully cleared, 1 = fully saturated
  // Impairment scales with residual lactate and how fast the pace is
  // At PB pace (ratio 1.0) with full lactate (residual 1.0): ~3% per rep
  // At AT pace (ratio 1.05): tapers to ~0%
  const speedFactor   = Math.max(0, (1.05 - speedRatio) / 0.05); // 0 at AT, 1 at PB pace
  const maxImpairment = 0.03 * speedFactor;      // up to 3% per rep at PB pace
  return 1.0 + residualLactate * maxImpairment;  // >1.0 means time gets longer (slower)
}

// ─── Consistency warning ─────────────────────────────────────────────────────
// Returns null if achievable, or { rep, estimatedTime, degradationPct, suggestedRest, suggestedTime }
function consistencyCheck({ qty, targetTimeSec, restSec, pace200Sec, stroke,
                             phvStatus, lactateClearMult, distM }) {
  if (!qty || !targetTimeSec || restSec === null || restSec === undefined || isNaN(restSec) || !pace200Sec) return null;
  const mult       = STROKE_MULT[stroke] || 1.0;
  const base100Pace = (pace200Sec * mult) / 2;
  const repPace100  = (targetTimeSec / distM) * 100;
  const speedRatio  = repPace100 / base100Pace;

  // Only warn for sets at or faster than AT pace
  if (speedRatio > 1.05) return null;

  const atpcpRestoreRate   = 1 / 180;
  const lactateRestoreRate = (1 / 300) * lactateClearMult;

  let atpcpStore = 1.0, lactateBuf = 1.0;
  let firstProblematicRep = null;
  let worstTime = targetTimeSec;

  for (let r = 0; r < qty; r++) {
    const impairMult = paceImpairment(lactateBuf, speedRatio);
    const achievableTime = targetTimeSec * impairMult;

    if (r > 0 && impairMult > 1.015 && !firstProblematicRep) {
      // >1.5% slower than target = likely noticeable to coach
      firstProblematicRep = {
        rep: r + 1,
        estimatedTime: achievableTime,
        degradationPct: ((impairMult - 1) * 100),
      };
    }
    worstTime = Math.max(worstTime, achievableTime);

    // Deplete
    const atpcpUsed  = Math.min(atpcpStore, (Math.min(targetTimeSec, 15) / 15) * atpcpStore);
    atpcpStore       = Math.max(0, atpcpStore - atpcpUsed);
    const energy     = repEnergy(targetTimeSec, speedRatio, atpcpStore, lactateBuf, phvStatus);
    const lactateUsed = energy.glycolytic * 0.25 * (targetTimeSec / 60);
    lactateBuf       = Math.max(0, lactateBuf - lactateUsed);

    // Replenish
    atpcpStore = Math.min(1, atpcpStore + restSec * atpcpRestoreRate);
    lactateBuf = Math.min(1, lactateBuf + restSec * lactateRestoreRate);
  }

  if (!firstProblematicRep) return null;

  // Suggest a rest that would allow consistent performance
  // Find rest needed for lactateBuf to stay above 0.85 throughout
  const suggestedRest  = Math.ceil(targetTimeSec * 0.5 * (1 / lactateClearMult));
  const suggestedTime  = targetTimeSec * 1.025; // ~2.5% slower = more achievable

  return {
    ...firstProblematicRep,
    worstTime,
    suggestedRest,
    suggestedTime,
    lactateClearMult,
  };
}

// ─── Core multi-rep classifier ────────────────────────────────────────────────

export { glycoCapacity, phvZoneCaps, repEnergy, paceImpairment, consistencyCheck };

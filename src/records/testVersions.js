// src/records/testVersions.js
// When one test's versions can be shown as ONE history, and ladder levels.
//
// A used test is frozen, so adding a ladder level makes a new version (see
// 20261009120000_ladder_bands.sql). Runs are stored against a version, but a
// version that only ADDS levels changes nothing about the levels already swum:
// L2 in v1 is the same set as L2 in v2. Those versions are "compatible" and the
// results pages show their runs together. Anything else (a different set,
// measures, analyser, or a level whose reps/send-off changed) stays separate,
// because the runs would no longer be like-for-like.
//
// Pure — tested by testVersions.test.mjs.

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function levelParam(p) {
  const e = Object.entries(p?.params || {}).find(([, d]) => d && d.kind === 'level');
  return e ? { name: e[0], def: e[1] } : null;
}

// Is `older` safe to show alongside `newer`?
export function isCompatible(newer, older) {
  if (!newer || !older) return false;
  if (newer.id === older.id) return true;
  if (newer.key !== older.key || (newer.ownerOrgId || null) !== (older.ownerOrgId || null)) return false;
  if (newer.analyser !== older.analyser) return false;
  if (stable(newer.set) !== stable(older.set)) return false;
  if (stable([...(newer.measures || [])].sort()) !== stable([...(older.measures || [])].sort())) return false;
  const lnNew = levelParam(newer), lnOld = levelParam(older);
  const rest = (p, skip) => Object.fromEntries(Object.entries(p.params || {}).filter(([k]) => k !== skip));
  if (stable(rest(newer, lnNew?.name)) !== stable(rest(older, lnOld?.name))) return false;
  if (!lnNew && !lnOld) return true;
  if (!lnNew || !lnOld || lnNew.name !== lnOld.name) return false;
  // every level the older version had must mean exactly the same in the newer one
  const byValue = new Map((lnNew.def.options || []).map((o) => [o.value, o]));
  return (lnOld.def.options || []).every((o) => {
    const n = byValue.get(o.value);
    return n && Number(n.qty) === Number(o.qty) && String(n.onTime ?? '') === String(o.onTime ?? '') && String(n.restSec ?? '') === String(o.restSec ?? '');
  });
}

// From all versions of a test, the newest and every version compatible with it.
export function compatibleSet(pVersions) {
  const all = (pVersions || []).slice().sort((a, b) => b.version - a.version);
  const newest = all[0] || null;
  return { newest, versions: all.filter((p) => isCompatible(newest, p)) };
}

// Ladder levels: position in the options list = how high the level is.
export function levelRank(pProtocol, pValue) {
  const lp = levelParam(pProtocol);
  return lp ? (lp.def.options || []).findIndex((o) => o.value === pValue) : -1;
}

export function levelShortLabel(pProtocol, pValue) {
  const lp = levelParam(pProtocol);
  const o = lp && (lp.def.options || []).find((x) => x.value === pValue);
  return o ? String(o.label || o.value).split(' — ')[0] : (pValue || '');
}

// The highest level held across runs (views from buildRunView). null if none held.
export function highestHeld(pProtocol, pViews) {
  let best = null;
  for (const v of pViews || []) {
    if (!v.level || v.summary?.held !== true) continue;
    const r = levelRank(pProtocol, v.level);
    if (r < 0) continue;
    if (!best || r > best.rank || (r === best.rank && v.swumOn < best.swumOn)) best = { rank: r, value: v.level, swumOn: v.swumOn };
  }
  return best ? { ...best, label: levelShortLabel(pProtocol, best.value) } : null;
}

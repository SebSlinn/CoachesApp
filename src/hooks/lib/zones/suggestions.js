// zones/suggestions.js - Zone time suggestion logic

export function suggestTimes(zone, distM, stroke, pace200Sec, cssValue) {
  if (!pace200Sec || !distM || !zone) return null;
  const SMULT = { FS: 1.0, BK: 1.045, BR: 1.254, Fly: 1.051, IM: 1.082 };
  const mult = SMULT[stroke] || 1.0;
  const base100 = (pace200Sec * mult) / 2; // seconds per 100m at 200PB pace
  const dist = parseFloat(distM);

  // Zone speedRatio ranges → IN time range
  const mult2 = SMULT[stroke] || 1.0;
  const b100 = (pace200Sec * mult2) / 2;
  const cssSR = cssValue ? cssValue / b100 : null;
  const srRanges = {
    HVO: [0.82, 0.93],
    LT: [0.93, 0.97],
    LP: [0.97, 1.025],
    AT: [1.025, 1.1],
    CS: cssSR ? [cssSR * 0.95, cssSR * 1.05] : [1.025, 1.1],
    A3: [1.1, 1.22],
    A2: [1.22, 1.38],
    A1: [1.38, 1.65],
  };

  // Work:rest ratios by zone (rest/work)
  const restRatios = {
    HVO: [6.0, 10.0],
    LT: [3.0, 5.0],
    LP: [1.0, 1.2],
    AT: [0.3, 0.55], // 30-55s rest on 100m AT rep
    CS: [0.45, 0.7],
    A3: [0.0, 0.15], // 0-15s rest — can go straight on at A3
    A2: [0.0, 0.08], // straight-on to 5s rest
    A1: [0.0, 0.0], // continuous — ON = IN (straight-on)
  };

  const range = srRanges[zone];
  const restRange = restRatios[zone];
  if (!range) return null;

  // Calculate IN time range (round to nearest second)
  const inLow = Math.round((range[0] * base100 / 100) * dist);
  const inHigh = Math.round((range[1] * base100 / 100) * dist);
  const inHighFinal = inLow >= inHigh ? inLow + 2 : inHigh;

  // Helper functions
  function roundTo5(sec) {
    return Math.round(sec / 5) * 5;
  }

  function fmtSug(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? m + ":" + String(s).padStart(2, "0") : String(s);
  }

  const onLow = roundTo5(inLow + inLow * restRange[0]);
  const onHigh = roundTo5(inHighFinal + inHighFinal * restRange[1]);
  const onHighFinal = onLow === onHigh ? onLow + 5 : onHigh;

  return {
    inLow,
    inHigh: inHighFinal,
    onLow,
    onHigh: onHighFinal,
    inLowStr: fmtSug(inLow),
    inHighStr: fmtSug(inHighFinal),
    onLowStr: fmtSug(onLow),
    onHighStr: fmtSug(onHighFinal),
    inMidStr: fmtSug(Math.round((inLow + inHighFinal) / 2)),
    onMidStr: fmtSug(roundTo5((onLow + onHighFinal) / 2)),
  };
}

export function suggestAllZones(distM, stroke, pace200Sec, cssValue) {
  const zones = ["HVO", "LT", "LP", "AT", "CS", "A3", "A2", "A1"];
  const suggestions = {};
  zones.forEach((z) => {
    suggestions[z] = suggestTimes(z, distM, stroke, pace200Sec, cssValue);
  });
  return suggestions;
}

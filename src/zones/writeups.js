// src/zones/writeups.js
// Long-form write-ups per training type (British Swimming / Sweetenham model).
// PURE — zero imports. types.js attaches these to TYPES[code].writeup.
// The HR line is NOT stored here: types.js derives writeup.hr from the type's hrBand,
// so the band has one source.
// MVO and PL (added 2026-10-14) are DRAFTS for Al to check; LR is a placeholder awaiting his text.

const WRITEUPS = {
  A1: {
  la: "<2 mmol/L", rpe: "<9", domain: "Moderate",
  name: "Aerobic Low Intensity",
  description: "The foundational zone. Work relies almost entirely on fat metabolism and slow-twitch muscle fibre recruitment. Athletes can sustain this effort for extended periods with minimal physiological stress.",
  usedFor: ["Warm-up and warm-down","Technical and skill-focused training","Base conditioning and volume building","Active recovery between harder sessions","Replenishing glycogen stores between high-intensity bouts"],
  primary: ["Increased stroke volume and cardiac output","Increased blood volume","Improved blood shunting to working muscles","Increased capillarisation around slow-twitch fibres","Increased myoglobin and mitochondria in slow-twitch fibres","Enhanced lactate removal (MCT1/4 upregulation)"],
  setStructure: "2,000–4,000m or continuous · Rest: 5–30s depending on rep distance",
  },
  A2: {
  la: "2–4 mmol/L", rpe: "10–12", domain: "Moderate",
  name: "Aerobic Maintenance / Development",
  description: "The primary aerobic development zone. Slightly elevated above pure recovery, this zone stimulates aerobic adaptation while sitting comfortably within the aerobic domain. The majority of an endurance swimmer's volume is accumulated here.",
  usedFor: ["Building and maintaining aerobic base","High-volume aerobic training blocks","Improving cardio-respiratory efficiency","Developing lactate removal capacity","Fat metabolism training"],
  primary: ["Improved aerobic capacity and VO₂ efficiency","Enhanced lactate removal from trained fibres","Increased capillarisation around fast and slow-twitch fibres","Increased myoglobin and mitochondria in fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Increased blood volume","Progressive VO₂max improvements in fast-twitch fibres"],
  setStructure: "2,000–4,000m (~40 mins work) · Rest: 5–30s depending on rep distance",
  },
  A3: {
  la: "3–6 mmol/L", rpe: "14–15", domain: "Heavy / Approaching Threshold",
  name: "Aerobic Capacity (Threshold Approach)",
  description: "A transitional zone between pure aerobic work and the anaerobic threshold. Training here pushes athletes toward their lactate threshold without crossing it — highly effective for developing aerobic capacity. Sometimes combined with AT sets in a single session.",
  usedFor: ["Developing aerobic capacity and threshold approach","Bridging aerobic base and threshold training","Developing the aerobic system in fast-twitch fibres","Extended race-simulation sets (800m–1500m FS, 200m IM)"],
  primary: ["Increased percentage utilisation of VO₂max","Increased lactate removal from trained fibres","Increased capillarisation and mitochondria in fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Improved VO₂max, particularly in fast-twitch fibres"],
  setStructure: "1,200–2,000m (~30 mins work) · ~6 min sustained efforts · Rest: 5–120s",
  },
  AT: {
  la: "3–6 mmol/L", rpe: "14–15", domain: "Heavy / MLSS",
  name: "Anaerobic Threshold (LT2 / MLSS)",
  description: "The point at which lactate production equals lactate removal — the Maximal Lactate Steady State (MLSS). Considered the optimal intensity for developing aerobic capacity in competitive swimmers and the backbone of elite training programmes. Individual lactate testing is strongly recommended.",
  usedFor: ["Developing the anaerobic threshold and MLSS","Improving aerobic power and efficiency","Middle-distance event preparation (200m–800m)","Threshold sets at race pace for 400–1500m swimmers"],
  primary: ["Raising the threshold at which lactate production equals removal","Increased lactate removal from trained fibres","Increased capillarisation of fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Increased blood volume","Progressive VO₂max development in fast-twitch fibres"],
  setStructure: "1,200–2,000m · Rest: 5–30s (short), 10–30s (middle)",
  },
  CS: {
  la: "6–12 mmol/L", rpe: "17–19", domain: "Severe / Critical Speed",
  name: "Critical Speed (CSS)",
  description: "High-intensity training at approximately VO₂max intensity, defined by the Critical Speed boundary — the threshold above which oxygen consumption rises until VO₂max is reached. Includes Heart Rate-controlled sets and Critical Velocity sets. Corresponds to Aerobic Power in the Sweetenham model.",
  usedFor: ["Improving VO₂max","Developing aerobic power","Heart rate sets and Vcrit sets","Preparation for 100m–400m events","VO₂max-specific intervals (e.g. 8–12 × 100m at Vcrit pace)"],
  primary: ["Increased maximal oxygen consumption in all trained fibres including Type IIx","Increased capillarisation around all fibres including Type IIx","Increased myoglobin and mitochondria in all fibres including Type IIx","Increased rate of lactate removal from all fibres","Increased buffering capacity across all three fibre types"],
  setStructure: "300–1,200m total · ~6 mins at target intensity · Rest: 15–120s · Total work 27–33 min",
  },
  MVO: {
  la: "6–10 mmol/L", rpe: "17–19", domain: "Severe / VO₂max",
  name: "MVO₂ — Maximal Aerobic Overload",
  description: "Repeats at or just above the speed that drives oxygen uptake to its maximum. Rest is short enough that heart rate stays high between reps, so the cardiovascular system works at its ceiling for several minutes in total. Shares Zone 3 with Critical Speed; MVO₂ is the harder, shorter-rest end.",
  usedFor: ["Raising VO₂max","Aerobic power for 200m–400m events","Heart-rate controlled overload sets","Bridging threshold work and race-pace lactate work"],
  primary: ["Increased maximal oxygen consumption","Maximal stroke volume and cardiac output","Mitochondrial development in fast-twitch (Type IIa) fibres","Faster lactate removal at high intensity"],
  secondary: ["Increased buffering capacity","Pulmonary adaptations at maximal effort"],
  setStructure: "1,200–2,000m · 100–400m reps at ~200–400 race pace · Work:rest about 1:0.5–1:1 · 24–48 h recovery",
  },
  LP: {
  la: "8–15 mmol/L", rpe: "17–19", domain: "Extreme / Severe",
  name: "Lactate Production",
  description: "Training that drives maximal speed of lactate accumulation — the point at which anaerobic glycolysis is working at or near its peak. Includes race pace training for sprint events. The glycolytic energy system is the primary contributor.",
  usedFor: ["Race pace training for 100m and 200m events","Developing the rate of anaerobic energy production","Enhancing glycolytic capacity","Preparing athletes for the lactate demands of competition"],
  primary: ["Increased rate of anaerobic metabolism","Increased MCT-1 and MCT-4 lactate transporter density","Increased maximum sprinting speed"],
  secondary: ["Increased ATP/PC stores","Increased muscular power","Improved neuromuscular coordination at fast speeds","Increased buffering capacity"],
  setStructure: "300–600m total · 25–75m reps · Rest: 1–3 min (25m), 3–5 min (50–75m)",
  },
  LT: {
  la: "12–20 mmol/L", rpe: "19–20", domain: "Severe / Extreme",
  name: "Lactate Tolerance",
  description: "The most physiologically demanding zone. Athletes train to tolerate severe acidosis. Reps are swum at 200 race pace (the second 100 of the 200 — ½ × 200 goal or PB per 100) and sent off as the lactate from the previous rep is peaking (about 4 minutes from its start, Bowman), so each rep begins with blood lactate already high — forcing work under acidotic conditions.",
  usedFor: ["Building tolerance to severe acidosis","Increasing buffering capacity of all fibre types","Developing anaerobic muscular endurance","Event-specific preparation for 100m–200m sprint events","Maintaining technique under extreme fatigue"],
  primary: ["Increased muscle buffering capacity","Improved ability to maintain technique under severe acidosis","Increased MCT-1 and MCT-4 density","Improved pain tolerance and psychological resilience"],
  secondary: ["Increased ATP/PC and glycogen stores","Increased rate of blood lactate removal","Increased VO₂max","Increased rate of anaerobic metabolism"],
  setStructure: "600–2,000m (sprinters shorter, middle-distance longer) · 50–200m reps · ½ × 200 goal/PB per 100 · On 3:00–5:00 start-to-start",
  },
  HVO: {
  la: "N/A", rpe: "Maximal", domain: "Sprint / Alactic",
  name: "High Velocity Overload (ATP-PC Sprinting)",
  description: "Maximum effort, very short duration sprinting to develop the alactic (ATP-PC) energy system, neuromuscular coordination, and Type IIx fast-twitch recruitment. Work is short enough that significant lactate accumulation does not occur. Full recovery is required between reps.",
  usedFor: ["Developing maximum sprint speed and power","Improving neuromuscular coordination at and above race speeds","Fast-twitch (Type IIx) muscle fibre recruitment","Developing muscular strength and rate of force development","Training above race pace for 50m and 100m specialists"],
  primary: ["Increased muscular strength","Increased rate and pattern of CNS muscle fibre stimulation","Increased rate of force development"],
  secondary: ["Increased ATP/PC stores","Increased rate of ATP resynthesis","Increased muscular power","Improved neuromuscular coordination at maximum speed"],
  setStructure: "200–600m total (quality over volume) · 10–25m reps · Rest: 45s–2 min (full PC recovery required)",
  },
  PL: {
  la: ">15 mmol/L", rpe: "20 / maximal", domain: "Extreme",
  name: "Peak Lactate",
  description: "Near-maximal efforts long enough to drive blood lactate to its highest level, with long recovery so each rep can be swum flat out. Used sparingly; very high physiological and psychological cost.",
  usedFor: ["Raising the lactate production ceiling","Finishing speed for 100m–200m events","Late-season race sharpening"],
  primary: ["Maximal rate of anaerobic glycolysis","Highest achievable blood lactate","Fast-twitch fibre recruitment at maximal effort"],
  secondary: ["Increased buffering capacity","Psychological ceiling-raising"],
  setStructure: "200–600m total · 50–150m reps all-out · Rest 5–15 min (near-full recovery) · 48–72 h recovery",
  },
  LR: {
  la: "—", rpe: "—", domain: "Zone 3 / HPE",
  name: "Lactate Removal (Sweetenham)",
  description: "A training method devised by Bill Sweetenham and placed by him in Zone 3 (High Performance Endurance) alongside Critical Speed and MVO₂. Write-up, pace, rest and HR band to be supplied.",
  usedFor: ["To be confirmed"],
  primary: ["To be confirmed"],
  setStructure: "To be confirmed",
  },
};

export { WRITEUPS };

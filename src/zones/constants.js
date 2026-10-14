//zones/constants.js - Core data for zones and energy systems.
//
// Training types (codes, criteria, HR bands, write-ups) now live in types.js and
// display labels/colours in schemes.js (contracts/ZONES.md). ZONES, ZONE_COLORS and
// ZONE_WRITEUPS below are DERIVED from them and kept so existing callers keep working.
import { TYPES, TYPE_CODES, ENERGY_MODEL_CODES, GROUPS, typesInGroup, formatHrBand } from './types.js';
import { resolveZoneStyle, groupColor, DEFAULT_SCHEME_ID } from './schemes.js';
const STROKE_MULT = { FS: 1.0, BK: 1.045, BR: 1.254, Fly: 1.051, IM: 1.082 };

// ─── Rest type lactate clearance multipliers ────────────────────────────────
// Based on research: active A1 recovery clears lactate ~68% faster than passive.
// Active recovery that is too hard (A2+) actually impairs clearance.
// Stationary = baseline 1.0
// Active A1 (~60-70% max velocity) = 1.68x clearance
// Active A2+ (>75% max velocity) = 0.80x clearance (counterproductive)
const REST_TYPE_OPTS = [
  { v: "stationary", l: "Stationary",  sub: "Standing / sitting poolside", clearMult: 1.0  },
  { v: "a1",         l: "Active A1",   sub: "Easy swim — optimal clearance", clearMult: 1.68 },
  { v: "a2plus",     l: "Active A2+",  sub: "Too hard — impairs clearance",  clearMult: 0.80 },
];

// ─── Athlete type lactate clearance multipliers ──────────────────────────────
// Aerobic base determines how quickly lactate is oxidised and removed during rest.
// Distance swimmers have higher mitochondrial density, capillary density, and
// cardiac output — all of which accelerate lactate clearance.
// Sprinters produce more lactate per rep (fast-twitch dominant) and clear it more slowly.
// Phase 2 will derive this from 400m/800m freestyle times (aerobic index).
//
// These multiply the base lactate restore rate (1/300 per second):
//   Sprint-dominant  × 0.75  → clears ~25% slower than baseline
//   All-round        × 1.00  → baseline
//   Endurance        × 1.35  → clears ~35% faster than baseline
// ─── Athlete type lactate clearance multipliers ──────────────────────────────
// Aerobic base determines how quickly lactate is oxidised and removed during rest.
// Distance swimmers have higher mitochondrial density, capillary density, and
// cardiac output — all of which accelerate lactate clearance.
// Sprinters produce more lactate per rep (fast-twitch dominant) and clear it more slowly.
// Phase 2 will derive this from 400m/800m freestyle times (aerobic index).
//
// These multiply the base lactate restore rate (1/300 per second):
//   Sprint-dominant  × 0.75  → clears ~25% slower than baseline
//   All-round        × 1.00  → baseline
//   Endurance        × 1.35  → clears ~35% faster than baseline
const ATHLETE_TYPE_OPTS = [
  { v: "sprint",    l: "Sprint",    sub: "50–100m specialist",        clearMult: 0.75 },
  { v: "allround",  l: "All-Round", sub: "100–400m / balanced base",  clearMult: 1.00 },
  { v: "endurance", l: "Endurance", sub: "400m+ / strong aerobic base", clearMult: 1.35 },
];

// ─── Energy System data (Layer 1) ───────────────────────────────────────────
const ENERGY_SYSTEMS = [
  {
    id: "atpcp", label: "ATP-CP", subLabel: "Alactic / Phosphocreatine", color: "#FF2D55",
    mechanism: "Stored phosphocreatine regenerates ATP instantly — no oxygen, no lactate. Powers maximal efforts up to ~15 seconds.",
    specific: ["Increased phosphocreatine store size in fast twitch fibres","Faster ATP-CP resynthesis between efforts","Improved neural firing rate and motor unit recruitment","Creatine kinase enzyme activity increases"],
    general: ["Start and turn speed — the first 10–15m of any race","Technique at maximum velocity","Psychological confidence at full effort","Neuromuscular coordination and efficiency"],
    phvNote: "Trainable at all ages. Requires strict >6:1 rest:work — without adequate rest the set becomes glycolytic, which is inappropriate for younger athletes.",
  },
  {
    id: "glycolytic", label: "Glycolytic", subLabel: "Lactic / Anaerobic Glycolysis", color: "#FFCC00",
    mechanism: "Glucose is broken down without oxygen, producing ATP rapidly but generating lactate and hydrogen ions. Primary system for 50–200m racing.",
    specific: ["Increased glycolytic enzyme activity (PFK, LDH)","Elevated lactate buffering capacity — bicarbonate system develops","Greater tolerance of acidic muscle environment","Higher peak lactate production ceiling","Improved lactate clearance by the aerobic system"],
    general: ["Race-specific conditioning for 50–200m events","Mental toughness — working through the burn","Pacing mechanics under fatigue","Competitive hardness and race experience"],
    phvNote: "Underdeveloped before PHV. Pre-PHV athletes produce less lactate, recover faster, but gain little specific adaptation. Exhausting and takes days to recover from. Keep pre-PHV athletes below 1/5 of training in any glycolytic zone.",
  },
  {
    id: "aerobic", label: "Aerobic", subLabel: "Oxidative Phosphorylation", color: "#34C759",
    mechanism: "Oxygen is used to break down carbohydrates and fats, producing 18× more ATP per glucose than anaerobic pathways. Sustains effort indefinitely at appropriate intensities and clears lactate produced by the glycolytic system.",
    specific: ["Mitochondrial density — more mitochondria per muscle fibre","Capillary density — more oxygen delivery to muscles","Cardiac adaptations — increased stroke volume, lower resting HR","Aerobic enzyme development (citrate synthase, SDH)","Fat oxidation efficiency — spares glycogen for high intensity","VO2max ceiling raised with Zone 3 (MVO/CS) training","Lactate clearance — aerobic system oxidises lactate faster"],
    general: ["Recovery capacity — bigger engine recovers faster from all training","The aerobic base underpins every other zone","Fuel efficiency at race-relevant speeds","Technique opportunity — low pace allows full technical focus","Psychological resilience over distance"],
    phvNote: "Most trainable at all ages. Pre-PHV athletes have a highly responsive aerobic system. Time spent in A1–A2 as a child sets a ceiling on adult aerobic capacity that cannot be fully recovered if this window is missed — Sweetenham.",
  },
];

// ─── Training Zone data (Layer 2 + Layer 3) ──────────────────────────────────
const ZONE_GROUPS = [
  {
    zone: 1, label: GROUPS[0].label, color: groupColor(1, DEFAULT_SCHEME_ID),
    system: "Aerobic (Oxidative)", muscle: "Slow twitch (Type I) — mitochondrial density and cardiovascular base",
    members: typesInGroup(1),
    adaptations: {
      A1: {
        specific: ["Accelerates lactate clearance — optimal at ~60–70% max velocity","Blood flow to muscles promotes recovery","Maintains aerobic base without adding stress","Efficient stroke mechanics at low effort"],
        general: ["Recovery between hard efforts and sessions","Technique and drill opportunity — full focus on movement quality","Warm-up and cool-down","Mental reset between intense blocks"],
      },
      A2: {
        specific: ["Mitochondrial density in slow twitch fibres","Increased capillary density — more oxygen delivery","Cardiac stroke volume improvement at moderate intensity","Fat oxidation efficiency — trains body to use fat as primary fuel","Aerobic enzyme development"],
        general: ["The backbone of aerobic base — where most training volume accumulates","Drill and skills work — pace allows full technical focus","Develops the aerobic engine underpinning all other zones","Sweetenham: time here as a child determines adult engine size"],
      },
      A3: {
        specific: ["Upper mitochondrial development — pushing slow twitch toward maximum aerobic output","Increased lactate clearance at moderately high pace","Cardiac output development at sustained hard effort","Aerobic power — sustaining fast aerobic pace","Bridge to threshold training"],
        general: ["Challenging but sustainable — develops mental endurance","Race-pace familiarity for 400m, 800m, 1500m events","Foundation for AT and Zone 3 training","Volume training at meaningful intensity"],
      },
    },
    phvNote: "Essential for all ages. Pre-PHV athletes should spend the majority of training in Zone 1. A3 is the upper limit of emphasis before PHV.",
  },
  {
    zone: 2, label: GROUPS[1].label, color: groupColor(2, DEFAULT_SCHEME_ID),
    system: "Aerobic / Glycolytic crossover", muscle: "Intermediate (Type IIa) — mitochondrial development",
    members: typesInGroup(2),
    adaptations: {
      AT: {
        specific: ["Raises the anaerobic threshold — pace at which lactate begins to accumulate","Mitochondrial development in intermediate fibres — converting fast twitch toward aerobic","Increased lactate clearance rate at threshold pace","Improved fat/carbohydrate fuel utilisation","Increased capillary density in working muscles"],
        general: ["Race pace familiarity for 200m+ events","Psychological comfort at hard sustained effort","Foundation for CS and MVO training","Efficient technique at race-relevant speeds","Bridge between Zone 1 and Zone 3"],
      },
    },
    phvNote: "Accessible for all post-PHV athletes. Limited but appropriate for early post-PHV. Pre-PHV keep below 20% of total volume.",
  },
  {
    zone: 3, label: GROUPS[2].label, color: groupColor(3, DEFAULT_SCHEME_ID),
    system: "Aerobic ceiling / Cardiovascular", muscle: "Intermediate and slow twitch — cardiac and respiratory system",
    members: typesInGroup(3),
    adaptations: {
      CS: {
        specific: ["Raises Critical Speed threshold — pace sustainable indefinitely","Increased cardiac output at high sustained intensity","Improved lactate clearance at threshold pace","Mitochondrial development in intermediate fibres","Blood lactate steady state at progressively higher speeds"],
        general: ["Mental durability — 30 minutes of sustained hard work","Pacing discipline across many reps","Aerobic economy at race-relevant speeds","Foundation for all race distances 200m+"],
      },
      MVO: {
        specific: ["Increases absolute VO2max ceiling","Maximum cardiac stroke volume development","Maximal mitochondrial oxygen utilisation","Pulmonary adaptations at maximum effort","Maximum aerobic power output"],
        general: ["The hardest aerobic training — significant psychological demand","Simulates race breathing without full race stress","Sustaining output at the edge of aerobic capacity","Aerobic system working alongside high lactate"],
      },
    },
    phvNote: "Post-PHV primarily. Can be introduced carefully to well-trained early post-PHV athletes. Very demanding — 24–48 hours recovery for MVO.",
  },
  {
    zone: 4, label: GROUPS[3].label, color: groupColor(4, DEFAULT_SCHEME_ID),
    system: "Glycolytic (Lactic)", muscle: "Fast twitch Type IIa and IIx — lactate production and buffering",
    members: typesInGroup(4),
    adaptations: {
      LP: {
        specific: ["Increased glycolytic enzyme activity","Elevated peak lactate tolerance","Development of buffering capacity (bicarbonate system)","Sustaining output at high lactate concentrations"],
        general: ["Race-specific conditioning for 100–200m events","Mental toughness — working through the burn","Early season glycolytic base before LT work","Fast twitch muscle fibre recruitment patterns"],
      },
      LT: {
        specific: ["Tolerance of very high blood lactate (up to 20+ mmol/L)","Psychological adaptation to extreme discomfort","Improved lactate clearance during high-intensity work","Fast twitch fibre conditioning at race and above-race pace"],
        general: ["Late season race sharpening","Race pace confidence at and above target speed","Competitive hardness"],
      },
      PL: {
        specific: ["Maximum glycolytic output — absolute ceiling of lactate production","Conditions body to highest possible lactate stress","Short duration maximal efforts beyond race speed"],
        general: ["Finishing speed — accelerating at the end of a race","Maximal competitive effort conditioning","Psychological ceiling-raising"],
      },
    },
    phvNote: "Post-PHV only. LP early season, LT later season (Sweetenham). Never the foundation of a programme. PL used sparingly — 48–72 hours recovery.",
  },
  {
    zone: 5, label: GROUPS[4].label, color: groupColor(5, DEFAULT_SCHEME_ID),
    system: "ATP / ATP-CP (Alactic)", muscle: "Fast twitch Type IIx — neural recruitment and phosphocreatine",
    members: typesInGroup(5),
    adaptations: {
      HVO: {
        specific: ["Increased phosphocreatine store size","Faster rate of ATP-CP resynthesis between efforts","Improved neural firing rate and motor unit recruitment","Maximal velocity mechanics development"],
        general: ["Start and turn speed","Technique at maximum speed — stroke must work at race velocity","Psychological confidence at maximal effort","Neuromuscular coordination and efficiency"],
      },
    },
    phvNote: "Suitable for all ages. ATP-CP system is mature pre-PHV. Requires strict >6:1 rest:work — otherwise becomes glycolytic.",
  },
];

// ─── Maximum speed validation ────────────────────────────────────────────────

// ─── Derived (back-compat) ───────────────────────────────────────────────────

// Write-ups per code (now in writeups.js; .hr comes from the type's hrBand).
const ZONE_WRITEUPS = Object.fromEntries(
  TYPE_CODES.filter(c => TYPES[c].writeup).map(c => [c, TYPES[c].writeup]));

// DEPRECATED — default-scheme colour per code. Use resolveZoneStyle / zoneColor
// from schemes.js so the coach's scheme applies.
const ZONE_COLORS = Object.fromEntries(
  TYPE_CODES.map(c => [c, resolveZoneStyle(c, DEFAULT_SCHEME_ID).color]));

// The seven energy-model types, in classifySet()'s breakdown order. classifySet() and
// session/model.js map over this — keep it to energyModel types only. The order is the
// engine's own (it breaks ties between equal percentages), so it is fixed here rather
// than following the display order in types.js.
const ENGINE_ORDER = ['HVO', 'LT', 'LP', 'AT', 'A3', 'A2', 'A1'];   // the engine's original order
const ZONES = ENGINE_ORDER.filter(c => ENERGY_MODEL_CODES.includes(c)).map(c => {
  const t = TYPES[c];
  const st = resolveZoneStyle(c, DEFAULT_SCHEME_ID);
  return {
    id: c, name: t.name, rpe: t.rpe, bbm: formatHrBand(t.hrBand).replace(' bbm', ''),
    desc: t.desc, color: st.color, textColor: st.text, group: t.group,
  };
});

// ─── Drill Library ──────────────────────────────────────────────────────────

export {
  STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS,
  ENERGY_SYSTEMS, ZONE_GROUPS, ZONES, ZONE_WRITEUPS, ZONE_COLORS,
};

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
    zone: 1, label: "Zone 1 — Aerobic", color: "#30B0C7",
    system: "Aerobic (Oxidative)", muscle: "Slow twitch (Type I) — mitochondrial density and cardiovascular base",
    members: ["A1","A2","A3"],
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
    zone: 2, label: "Zone 2 — Threshold", color: "#FFCC00",
    system: "Aerobic / Glycolytic crossover", muscle: "Intermediate (Type IIa) — mitochondrial development",
    members: ["AT"],
    adaptations: {
      AT: {
        specific: ["Raises the anaerobic threshold — pace at which lactate begins to accumulate","Mitochondrial development in intermediate fibres — converting fast twitch toward aerobic","Increased lactate clearance rate at threshold pace","Improved fat/carbohydrate fuel utilisation","Increased capillary density in working muscles"],
        general: ["Race pace familiarity for 200m+ events","Psychological comfort at hard sustained effort","Foundation for CS and MVO training","Efficient technique at race-relevant speeds","Bridge between Zone 1 and Zone 3"],
      },
    },
    phvNote: "Accessible for all post-PHV athletes. Limited but appropriate for early post-PHV. Pre-PHV keep below 20% of total volume.",
  },
  {
    zone: 3, label: "Zone 3 — HPE", color: "#FF9500",
    system: "Aerobic ceiling / Cardiovascular", muscle: "Intermediate and slow twitch — cardiac and respiratory system",
    members: ["CS","MVO"],
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
    zone: 4, label: "Zone 4 — Lactate", color: "#FF5500",
    system: "Glycolytic (Lactic)", muscle: "Fast twitch Type IIa and IIx — lactate production and buffering",
    members: ["LP","LT","PL"],
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
    zone: 5, label: "Zone 5 — Speed", color: "#FF2D55",
    system: "ATP / ATP-CP (Alactic)", muscle: "Fast twitch Type IIx — neural recruitment and phosphocreatine",
    members: ["HVO"],
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

// Training zone writeups from British Swimming / Sweetenham model
const ZONE_WRITEUPS = {
  A1: {
  hr: ">50 bbm", la: "<2 mmol/L", rpe: "<9", domain: "Moderate",
  name: "Aerobic Low Intensity",
  description: "The foundational zone. Work relies almost entirely on fat metabolism and slow-twitch muscle fibre recruitment. Athletes can sustain this effort for extended periods with minimal physiological stress.",
  usedFor: ["Warm-up and warm-down","Technical and skill-focused training","Base conditioning and volume building","Active recovery between harder sessions","Replenishing glycogen stores between high-intensity bouts"],
  primary: ["Increased stroke volume and cardiac output","Increased blood volume","Improved blood shunting to working muscles","Increased capillarisation around slow-twitch fibres","Increased myoglobin and mitochondria in slow-twitch fibres","Enhanced lactate removal (MCT1/4 upregulation)"],
  setStructure: "2,000–4,000m or continuous · Rest: 5–30s depending on rep distance",
  },
  A2: {
  hr: "40–50 bbm", la: "2–4 mmol/L", rpe: "10–12", domain: "Moderate",
  name: "Aerobic Maintenance / Development",
  description: "The primary aerobic development zone. Slightly elevated above pure recovery, this zone stimulates aerobic adaptation while sitting comfortably within the aerobic domain. The majority of an endurance swimmer's volume is accumulated here.",
  usedFor: ["Building and maintaining aerobic base","High-volume aerobic training blocks","Improving cardio-respiratory efficiency","Developing lactate removal capacity","Fat metabolism training"],
  primary: ["Improved aerobic capacity and VO₂ efficiency","Enhanced lactate removal from trained fibres","Increased capillarisation around fast and slow-twitch fibres","Increased myoglobin and mitochondria in fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Increased blood volume","Progressive VO₂max improvements in fast-twitch fibres"],
  setStructure: "2,000–4,000m (~40 mins work) · Rest: 5–30s depending on rep distance",
  },
  A3: {
  hr: "30–40 bbm", la: "3–6 mmol/L", rpe: "14–15", domain: "Heavy / Approaching Threshold",
  name: "Aerobic Capacity (Threshold Approach)",
  description: "A transitional zone between pure aerobic work and the anaerobic threshold. Training here pushes athletes toward their lactate threshold without crossing it — highly effective for developing aerobic capacity. Sometimes combined with AT sets in a single session.",
  usedFor: ["Developing aerobic capacity and threshold approach","Bridging aerobic base and threshold training","Developing the aerobic system in fast-twitch fibres","Extended race-simulation sets (800m–1500m FS, 200m IM)"],
  primary: ["Increased percentage utilisation of VO₂max","Increased lactate removal from trained fibres","Increased capillarisation and mitochondria in fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Improved VO₂max, particularly in fast-twitch fibres"],
  setStructure: "1,200–2,000m (~30 mins work) · ~6 min sustained efforts · Rest: 5–120s",
  },
  AT: {
  hr: "20–30 bbm", la: "3–6 mmol/L", rpe: "14–15", domain: "Heavy / MLSS",
  name: "Anaerobic Threshold (LT2 / MLSS)",
  description: "The point at which lactate production equals lactate removal — the Maximal Lactate Steady State (MLSS). Considered the optimal intensity for developing aerobic capacity in competitive swimmers and the backbone of elite training programmes. Individual lactate testing is strongly recommended.",
  usedFor: ["Developing the anaerobic threshold and MLSS","Improving aerobic power and efficiency","Middle-distance event preparation (200m–800m)","Threshold sets at race pace for 400–1500m swimmers"],
  primary: ["Raising the threshold at which lactate production equals removal","Increased lactate removal from trained fibres","Increased capillarisation of fast and slow-twitch fibres"],
  secondary: ["Increased stroke volume and cardiac output","Increased blood volume","Progressive VO₂max development in fast-twitch fibres"],
  setStructure: "1,200–2,000m · Rest: 5–30s (short), 10–30s (middle)",
  },
  CS: {
  hr: "5–20 bbm", la: "6–12 mmol/L", rpe: "17–19", domain: "Severe / Critical Speed",
  name: "Critical Speed / VO₂max (MVO₂)",
  description: "High-intensity training at approximately VO₂max intensity, defined by the Critical Speed boundary — the threshold above which oxygen consumption rises until VO₂max is reached. Includes Heart Rate-controlled sets and Critical Velocity sets. Corresponds to Aerobic Power in the Sweetenham model.",
  usedFor: ["Improving VO₂max","Developing aerobic power","Heart rate sets and Vcrit sets","Preparation for 100m–400m events","VO₂max-specific intervals (e.g. 8–12 × 100m at Vcrit pace)"],
  primary: ["Increased maximal oxygen consumption in all trained fibres including Type IIx","Increased capillarisation around all fibres including Type IIx","Increased myoglobin and mitochondria in all fibres including Type IIx","Increased rate of lactate removal from all fibres","Increased buffering capacity across all three fibre types"],
  setStructure: "300–1,200m total · ~6 mins at target intensity · Rest: 15–120s · Total work 27–33 min",
  },
  LP: {
  hr: "5–15 bbm", la: "8–15 mmol/L", rpe: "17–19", domain: "Extreme / Severe",
  name: "Lactate Production",
  description: "Training that drives maximal speed of lactate accumulation — the point at which anaerobic glycolysis is working at or near its peak. Includes race pace training for sprint events. The glycolytic energy system is the primary contributor.",
  usedFor: ["Race pace training for 100m and 200m events","Developing the rate of anaerobic energy production","Enhancing glycolytic capacity","Preparing athletes for the lactate demands of competition"],
  primary: ["Increased rate of anaerobic metabolism","Increased MCT-1 and MCT-4 lactate transporter density","Increased maximum sprinting speed"],
  secondary: ["Increased ATP/PC stores","Increased muscular power","Improved neuromuscular coordination at fast speeds","Increased buffering capacity"],
  setStructure: "300–600m total · 25–75m reps · Rest: 1–3 min (25m), 3–5 min (50–75m)",
  },
  LT: {
  hr: "0–10 bbm", la: "12–20 mmol/L", rpe: "19–20", domain: "Severe / Extreme",
  name: "Lactate Tolerance",
  description: "The most physiologically demanding zone. Athletes train to tolerate severe acidosis. Medium rest allows partial recovery so each rep begins with elevated blood lactate already present — forcing work under acidotic conditions.",
  usedFor: ["Building tolerance to severe acidosis","Increasing buffering capacity of all fibre types","Developing anaerobic muscular endurance","Event-specific preparation for 100m–200m sprint events","Maintaining technique under extreme fatigue"],
  primary: ["Increased muscle buffering capacity","Improved ability to maintain technique under severe acidosis","Increased MCT-1 and MCT-4 density","Improved pain tolerance and psychological resilience"],
  secondary: ["Increased ATP/PC and glycogen stores","Increased rate of blood lactate removal","Increased VO₂max","Increased rate of anaerobic metabolism"],
  setStructure: "600–2,000m · 25–200m reps · Rest: 5–30s (broken), 15s–10min (max acidosis)",
  },
  HVO: {
  hr: "N/A", la: "N/A", rpe: "Maximal", domain: "Sprint / Alactic",
  name: "High Velocity Overload (ATP-PC Sprinting)",
  description: "Maximum effort, very short duration sprinting to develop the alactic (ATP-PC) energy system, neuromuscular coordination, and Type IIx fast-twitch recruitment. Work is short enough that significant lactate accumulation does not occur. Full recovery is required between reps.",
  usedFor: ["Developing maximum sprint speed and power","Improving neuromuscular coordination at and above race speeds","Fast-twitch (Type IIx) muscle fibre recruitment","Developing muscular strength and rate of force development","Training above race pace for 50m and 100m specialists"],
  primary: ["Increased muscular strength","Increased rate and pattern of CNS muscle fibre stimulation","Increased rate of force development"],
  secondary: ["Increased ATP/PC stores","Increased rate of ATP resynthesis","Increased muscular power","Improved neuromuscular coordination at maximum speed"],
  setStructure: "200–600m total (quality over volume) · 10–25m reps · Rest: 45s–2 min (full PC recovery required)",
  },
};

const ZONES = [
  { id: "HVO", name: "HVO / ATP-CP",            color: "#FF2D55", textColor: "#fff", rpe: "Max",   bbm: "N/A",   desc: "Alactic sprints. Pure phosphocreatine — exhausted in 10-15s. Needs 6:1+ rest to replenish." },
  { id: "LT",  name: "LT / Lactate Tolerance",  color: "#FF5500", textColor: "#fff", rpe: "18-20", bbm: "5-15",  desc: "High-speed glycolytic work with significant lactate accumulation. Post-PHV athletes." },
  { id: "LP",  name: "LP / Lactate Production", color: "#FF9500", textColor: "#fff", rpe: "17-19", bbm: "10-20", desc: "Glycolytic system building lactate. Hard sustained efforts. Early season focus." },
  { id: "AT",  name: "AT / Anaerobic Threshold",color: "#FFCC00", textColor: "#1a1a2e", rpe: "15-17", bbm: "20-30", desc: "Lactate/aerobic crossover. Key race-pace zone. Lactate produced ≈ lactate cleared." },
  { id: "A3",  name: "A3 / Hard Aerobic",        color: "#34C759", textColor: "#fff", rpe: "14-15", bbm: "30-40", desc: "Upper aerobic. Challenging but aerobically sustainable. Good for fitness base." },
  { id: "A2",  name: "A2 / Moderate Aerobic",    color: "#30B0C7", textColor: "#fff", rpe: "11-13", bbm: "40-50", desc: "Moderate aerobic. Cardiovascular development. Drill-compatible." },
  { id: "A1",  name: "A1 / Easy Aerobic",         color: "#007AFF", textColor: "#fff", rpe: "7-10",  bbm: "50-70", desc: "Recovery and technique. Aerobic base. Suitable all ages." },
];

// ─── Drill Library ──────────────────────────────────────────────────────────

export {
  STROKE_MULT, REST_TYPE_OPTS, ATHLETE_TYPE_OPTS,
  ENERGY_SYSTEMS, ZONE_GROUPS, ZONES, ZONE_WRITEUPS,
};

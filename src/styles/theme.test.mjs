// src/styles/theme.test.mjs — node src/styles/theme.test.mjs
// The colour rules (contracts/ZONES.md § "Colour roles") checked mechanically.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES, THEME_KEYS, T, themeColors, themeCssVars, energyColor, energyVar } from './theme.js';
import { DEFAULT_SCHEME_ID, BUILT_IN_SCHEMES, zoneColor, resolveZoneStyle, contrastRatio, LIGHT_SURFACE, LIGHT_MIN_CONTRAST } from '../zones/schemes.js';
import { TYPE_CODES } from '../zones/types.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
let mPass = 0, mFail = 0;
function test(pName, pFn) {
  try { pFn(); mPass++; console.log('  ✓ ' + pName); }
  catch (e) { mFail++; console.log('  ✗ ' + pName + '\n      ' + e.message); }
}

console.log('\nTheme tokens');
test('every theme has exactly the same keys', () => {
  for (const [mName, mTheme] of Object.entries(THEMES)) assert.deepEqual(Object.keys(mTheme).sort(), [...THEME_KEYS].sort(), mName);
});
test('T maps every key to its CSS variable', () => {
  assert.equal(T.text2, 'var(--sz-text2)');
  assert.equal(Object.keys(T).length, THEME_KEYS.length);
});
test('themeCssVars gives one --sz-* per key; unknown theme falls back to dark', () => {
  const mVars = themeCssVars('dark');
  assert.equal(mVars['--sz-bg'], THEMES.dark.bg);
  assert.equal(Object.keys(mVars).length, THEME_KEYS.length);
  assert.equal(themeColors('nope'), THEMES.dark);
});
test('energy colours resolve by ENERGY_SYSTEMS id', () => {
  assert.equal(energyColor('aerobic'), THEMES.dark.energyAerobic);
  assert.equal(energyVar('atpcp'), 'var(--sz-energyAtpcp)');
});

console.log('\nColour roles');
test('energy colours: three different colours, none the exact value of a zone in the default scheme', () => {
  // (SwimZone classic shares two of them on purpose: they are the original colours.)
  const mKeys = ['energyAtpcp', 'energyGlycolytic', 'energyAerobic'];
  const mEnergy = mKeys.map(k => THEMES.dark[k].toUpperCase());
  assert.equal(new Set(mEnergy).size, 3);
  const mZone = new Set(TYPE_CODES.map(c => zoneColor(c, DEFAULT_SCHEME_ID).toUpperCase()));
  mKeys.forEach((k, i) => assert.ok(!mZone.has(mEnergy[i]), k + ' is exactly a default-scheme zone colour'));
});
test('Urbanchek White (A1) is drawn blue-grey, not white', () => {
  assert.notEqual(zoneColor('A1', 'urbanchek').toUpperCase(), '#F5F5F5');
});

console.log('\nLight theme');
test('the light card colour in schemes.js matches THEMES.light.surface', () => {
  assert.equal(LIGHT_SURFACE.toUpperCase(), THEMES.light.surface.toUpperCase());
});
test('every zone colour in every built-in scheme shows on a white card (≥ 3:1)', () => {
  for (const mId of Object.keys(BUILT_IN_SCHEMES)) for (const c of TYPE_CODES) {
    const mCol = zoneColor(c, mId, 'light');
    assert.ok(contrastRatio(mCol, LIGHT_SURFACE) >= LIGHT_MIN_CONTRAST, `${mId} ${c} ${mCol}`);
  }
});
test('strong colours are unchanged on light; pale ones are darkened, same hue family', () => {
  assert.equal(zoneColor('A3', 'urbanchek', 'light'), zoneColor('A3', 'urbanchek'));   // red
  assert.notEqual(zoneColor('HVO', 'urbanchek', 'light'), zoneColor('HVO', 'urbanchek'));   // gold → deeper gold
  assert.equal(zoneColor('A1', 'urbanchek', 'light'), '#475569');   // White = dark blue-grey (Al)
});
test('dark is still the default and unchanged', () => {
  assert.equal(zoneColor('A1', 'urbanchek'), '#C5D0DE');
  assert.equal(resolveZoneStyle('AT', 'urbanchek', 'dark').color, '#1E88E5');
});
test('light energy colours show on a white card (≥ 3:1)', () => {
  for (const k of ['energyAtpcp', 'energyGlycolytic', 'energyAerobic'])
    assert.ok(contrastRatio(THEMES.light[k], LIGHT_SURFACE) >= 3, k);
});

console.log('\nNo colour literals in the Classifier screen');
const CLASSIFIER_FILES = [
  ...readdirSync(join(SRC, 'screens/classifier')).map(f => 'screens/classifier/' + f),
  'pages/Classifier.jsx',
  'components/EnergyGraph.jsx', 'components/RepChart.jsx', 'components/ZoneBar.jsx',
  'components/ResultWarnings.jsx', 'components/ZoneWriteupCard.jsx',
];
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
for (const f of CLASSIFIER_FILES) {
  test(f, () => {
    const mHits = readFileSync(join(SRC, f), 'utf8').split('\n')
      .map((l, i) => [i + 1, l]).filter(([, l]) => LITERAL.test(l) && !l.trim().startsWith('//'));
    assert.equal(mHits.length, 0, mHits.map(([n, l]) => `line ${n}: ${l.trim()}`).join('\n      '));
  });
}

console.log(`\n${mPass} passed, ${mFail} failed`);
if (mFail) process.exit(1);

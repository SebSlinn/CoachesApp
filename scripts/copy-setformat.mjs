// scripts/copy-setformat.mjs
// Keeps ONE source of truth for the shared modules: copies them from
// src/session/ into public/poolside/ so the static (no-build) Poolside page can
// `import` them directly in the browser. protocolFormat.js imports
// './setFormat.js', so the two must travel together.
// Runs automatically before `npm run dev` and `npm run build`; safe to run by hand.
import { copyFileSync, mkdirSync } from 'node:fs';

// Live heart rate (src/hr/) travels the same way — Poolside imports both.
const FILES = ['session/setFormat.js', 'session/protocolFormat.js', 'hr/hrMonitor.js', 'hr/hrMetrics.js'];
const destDir = 'public/poolside';

try {
  mkdirSync(destDir, { recursive: true });
  for (const f of FILES) {
    const name = f.split('/').pop();
    copyFileSync(`src/${f}`, `${destDir}/${name}`);
    console.log(`copied src/${f} → ${destDir}/${name}`);
  }
} catch (e) {
  console.error(`failed to copy shared modules: ${e.message}`);
  process.exit(1);
}

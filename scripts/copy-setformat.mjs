// scripts/copy-setformat.mjs
// Keeps ONE source of truth for the shared set format: copies
// src/session/setFormat.js into public/poolside/ so the static (no-build)
// Poolside page can `import` it directly in the browser. Run automatically by
// the "prebuild" npm script; safe to run by hand.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const src = 'src/session/setFormat.js';
const dest = 'public/poolside/setFormat.js';

try {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copied ${src} → ${dest}`);
} catch (e) {
  console.error(`failed to copy set format: ${e.message}`);
  process.exit(1);
}

// src/lib/staleBuild.js
// After a deploy, the code chunks get new file names. A page opened BEFORE the
// deploy still asks for the old names (e.g. the Excel exporter, loaded on click),
// and those no longer exist. The fix is simply to load the new version: reload,
// once — guarded so a genuinely broken chunk can't cause a reload loop.

const KEY = 'swimzone-stale-reload-at';

export function isStaleBuildError(pErr) {
  const m = String((pErr && (pErr.message || pErr)) || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk|ChunkLoadError/i.test(m);
}

// Reload unless we already did in the last 30 s. Returns true if reloading.
export function reloadForNewVersion() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 30000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

// src/records/athleteLink.js
// Which athlete a Records page is about. Router state (how Athlete Setup has
// always opened Records) still works, but the drill-down pages also carry the
// athlete in the URL (?a=<id>&n=<name>) so a page can be bookmarked, reloaded
// or shared with another coach — who still only sees it if the database's
// log-sharing rules let them read that athlete's log.
import { useLocation } from 'react-router-dom';

export function useAthleteContext() {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  return {
    athleteId: loc.state?.athleteId || q.get('a') || null,
    name: loc.state?.name || q.get('n') || 'Athlete',
  };
}

export function recordsHref(pPath, pAthleteId, pName) {
  const q = new URLSearchParams();
  if (pAthleteId) q.set('a', pAthleteId);
  if (pName) q.set('n', pName);
  return `${pPath}?${q.toString()}`;
}

export const recordsPaths = {
  overview: '/athlete-records',
  event: (pSlug) => `/athlete-records/event/${encodeURIComponent(pSlug)}`,
  swim: (pId) => `/athlete-records/swim/${encodeURIComponent(pId)}`,
};

// In-memory stand-ins for the repositories the services use.
export const store = { protocols: [], efforts: [], reps: [], bests: {}, profiles: {}, activeAthlete: null };
let n = 0; const id = () => 'id-' + (++n);
export function getProtocolsRepository() {
  return {
    async list({ key } = {}) { return { data: store.protocols.filter((p) => !key || p.key === key), error: null }; },
    async get(i) { const p = store.protocols.find((x) => x.id === i); return p ? { data: p, error: null } : { data: null, error: { message: 'not found' } }; },
    async maxVersion(o, k) { return { data: Math.max(0, ...store.protocols.filter((p) => p.key === k && (p.ownerOrgId || null) === (o || null)).map((p) => p.version)), error: null }; },
    async create(p) {
      if (store.protocols.some((x) => x.key === p.key && x.version === p.version && (x.ownerOrgId || null) === (p.ownerOrgId || null)))
        return { data: null, error: { message: 'duplicate' } };
      const r = { ...p, id: id(), locked: false }; store.protocols.push(r); return { data: r, error: null };
    },
    async update(i, c) { const p = store.protocols.find((x) => x.id === i); Object.assign(p, c); return { data: p, error: null }; },
    async remove() { return { data: null, error: null }; },
  };
}
export function getResultsRepository() {
  return {
    async listHistory(a) { return { data: (store.bests[a] || []).map(([stroke, distM, timeSec]) => ({ stroke, distM, timeSec, effort: 'maximal', swumOn: '2026-09-01' })), error: null }; },
    async addSetResult(a, sr) {
      if (sr.id && store.efforts.some((e) => e.clientUuid === sr.id)) return { data: { effortId: null, reps: 0, alreadyPresent: true }, error: null };
      const e = { id: id(), athleteId: a, clientUuid: sr.id, swumOn: sr.swumOn, protocolId: sr.protocolId, set: sr.set, conditions: sr.conditions, summary: sr.summary };
      store.efforts.push(e);
      for (const r of sr.reps) store.reps.push({ ...r, effortId: e.id, targetTime: undefined });  // DB doesn't keep targetTime on the rep
      if (sr.protocolId) { const p = store.protocols.find((x) => x.id === sr.protocolId); if (p) p.locked = true; }
      return { data: { effortId: e.id, reps: sr.reps.length, alreadyPresent: false }, error: null };
    },
    async listSetEffortsByProtocol(pid, a) {
      return { data: store.efforts.filter((e) => e.protocolId === pid && e.athleteId === a)
        .map((e) => ({ ...e, reps: store.reps.filter((r) => r.effortId === e.id) })), error: null };
    },
    async updateSetEffortSummary(eid, s) { const e = store.efforts.find((x) => x.id === eid); e.summary = s; return { data: { updated: 1 }, error: null }; },
  };
}
export function getAthleteRepository() {
  return {
    async get() { return store.activeAthlete; },
    async save(a) { store.activeAthlete = a; },
  };
}
export function getAthleteProfileRepository() {
  return {
    async get(a) { return { data: store.profiles[a] || null, error: null }; },
    async upsert(a, p) { store.profiles[a] = { ...(store.profiles[a] || {}), ...p, athleteId: a, updatedAt: new Date().toISOString() }; return { data: store.profiles[a], error: null }; },
  };
}
